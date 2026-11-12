import { chromium, type BrowserContext, type Page } from "playwright";
import { homedir } from "node:os";
import { join } from "node:path";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

export const BASE_URL = "https://awardfares.com";

const CHALLENGE_TITLE = /just a moment/i;
const USER_AGENT =
  process.env.AWARDFARES_USER_AGENT ??
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";
const AUTH_TTL_MS = 10 * 60 * 1000;

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export interface ApiResponse {
  status: number;
  url: string;
  text: string;
}

function log(...args: unknown[]) {
  // stdout is the MCP transport; always log to stderr.
  console.error("[awardfares]", ...args);
}
function debug(...args: unknown[]) {
  if (process.env.AWARDFARES_DEBUG === "1") console.error("[awardfares:debug]", ...args);
}

export interface SessionOptions {
  email?: string;
  password?: string;
  profileDir?: string;
  headed?: boolean;
  executablePath?: string;
}

/**
 * Owns one persistent Chromium context and one page on awardfares.com.
 * All API calls are run inside the page with `fetch`, so Cloudflare clearance
 * and the `sid` session cookie are handled by the real browser.
 */
export class Session {
  private context?: BrowserContext;
  private page?: Page;
  private headed: boolean;
  private authOkAt = 0;
  private chain: Promise<unknown> = Promise.resolve();
  readonly profileDir: string;
  private readonly email?: string;
  private readonly password?: string;
  private readonly executablePath?: string;

  constructor(opts: SessionOptions = {}) {
    this.email = opts.email ?? process.env.AWARDFARES_EMAIL;
    this.password = opts.password ?? process.env.AWARDFARES_PASSWORD;
    this.headed = opts.headed ?? process.env.AWARDFARES_HEADED === "1";
    this.executablePath = opts.executablePath ?? process.env.AWARDFARES_BROWSER_PATH;
    this.profileDir =
      opts.profileDir ??
      process.env.AWARDFARES_PROFILE_DIR ??
      join(homedir(), ".local", "share", "awardfares-mcp", "profile");
  }

  /** Serialize work on the single page. */
  private run<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.chain.then(fn, fn);
    this.chain = next.catch(() => undefined);
    return next;
  }

  get isHeaded() {
    return this.headed;
  }

  get isOpen() {
    return !!this.context;
  }

  private async launch(headed: boolean): Promise<Page> {
    if (this.context) {
      await this.context.close().catch(() => undefined);
      this.context = undefined;
      this.page = undefined;
    }
    mkdirSync(this.profileDir, { recursive: true });
    this.headed = headed;
    log(`launching chromium (${headed ? "headed" : "headless"}) profile=${this.profileDir}`);
    // Use the full Chromium build in "new headless" mode (not the headless shell) and pin the
    // user agent so Cloudflare's clearance cookie stays valid across headed/headless relaunches.
    this.context = await chromium.launchPersistentContext(this.profileDir, {
      headless: !headed,
      channel: this.executablePath ? undefined : "chromium",
      executablePath: this.executablePath,
      userAgent: USER_AGENT,
      viewport: { width: 1280, height: 900 },
      locale: "en-US",
      timezoneId: "Europe/Oslo",
      args: ["--disable-blink-features=AutomationControlled"],
      ignoreDefaultArgs: ["--enable-automation"],
    });
    this.context.on("close", () => {
      this.context = undefined;
      this.page = undefined;
      this.authOkAt = 0;
    });
    await this.restoreCookies(this.context);
    const page = this.context.pages()[0] ?? (await this.context.newPage());
    this.page = page;
    return page;
  }

  private get cookieFile() {
    return join(this.profileDir, "awardfares-cookies.json");
  }

  /** The `sid` login cookie is a session cookie, which Chromium drops on exit; keep our own copy. */
  private async restoreCookies(ctx: BrowserContext) {
    try {
      const saved = JSON.parse(readFileSync(this.cookieFile, "utf8")) as Array<Record<string, unknown>>;
      const existing = new Set((await ctx.cookies(BASE_URL)).map((c) => c.name));
      const toAdd = saved.filter((c) => !existing.has(String(c.name)));
      if (toAdd.length) {
        // Give session cookies an explicit expiry so they are accepted.
        const exp = Math.floor(Date.now() / 1000) + 30 * 24 * 3600;
        await ctx.addCookies(
          toAdd.map((c) => ({ ...c, expires: typeof c.expires === "number" && c.expires > 0 ? c.expires : exp })) as never,
        );
        debug("restored cookies:", toAdd.map((c) => c.name).join(","));
      }
    } catch {
      /* no saved cookies */
    }
  }

  private async saveCookies() {
    try {
      const cookies = (await this.context?.cookies(BASE_URL)) ?? [];
      writeFileSync(this.cookieFile, JSON.stringify(cookies), { mode: 0o600 });
    } catch (e) {
      debug("could not save cookies", e);
    }
  }

  private async getPage(): Promise<Page> {
    if (this.page && !this.page.isClosed()) return this.page;
    return this.launch(this.headed);
  }

  private async isChallenge(page: Page): Promise<boolean> {
    try {
      const title = await page.title();
      return CHALLENGE_TITLE.test(title) || page.url().includes("/challenge");
    } catch {
      return false;
    }
  }

  /** Wait for a Cloudflare challenge to clear; escalate to a headed window if needed. */
  private async passChallenge(page: Page, timeoutMs: number): Promise<Page> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (!(await this.isChallenge(page))) return page;
      await page.waitForTimeout(1000);
    }
    if (!this.headed) {
      log("challenge did not clear headless; relaunching headed so it can be solved manually");
      const url = page.url();
      const headedPage = await this.launch(true);
      await headedPage.goto(url, { waitUntil: "domcontentloaded" });
      const deadline2 = Date.now() + 120_000;
      while (Date.now() < deadline2) {
        if (!(await this.isChallenge(headedPage))) return headedPage;
        await headedPage.waitForTimeout(1000);
      }
    }
    throw new ApiError(
      "Cloudflare challenge is blocking awardfares.com. A browser window has been opened; solve the challenge there and retry. Set AWARDFARES_HEADED=1 to always run with a visible window.",
      403,
    );
  }

  private async goto(path: string): Promise<Page> {
    let page = await this.getPage();
    debug("goto", path);
    await page.goto(`${BASE_URL}${path}`, { waitUntil: "domcontentloaded", timeout: 60_000 });
    page = await this.passChallenge(page, 20_000);
    debug("arrived at", page.url(), "title:", await page.title().catch(() => "?"));
    return page;
  }

  private async rawFetch(
    page: Page,
    method: string,
    path: string,
    body?: unknown,
    query?: Record<string, string | number | boolean | undefined>,
  ): Promise<ApiResponse> {
    let url = path;
    if (query) {
      const qs = new URLSearchParams();
      for (const [k, v] of Object.entries(query)) if (v !== undefined) qs.set(k, String(v));
      const s = qs.toString();
      if (s) url += (url.includes("?") ? "&" : "?") + s;
    }
    debug("fetch", method, url);
    const out: ApiResponse = await page.evaluate(
      async ({ method, url, body }) => {
        const r = await fetch(url, {
          method,
          headers: {
            "Content-Type": "application/json",
            accept: "application/json",
            "x-af-language": "en",
          },
          body: body === undefined ? undefined : JSON.stringify(body),
          credentials: "same-origin",
        });
        return { status: r.status, url: r.url, text: await r.text() };
      },
      { method, url, body },
    );
    debug("  ->", out.status, out.text.length, "bytes", out.text.slice(0, 80).replace(/\s+/g, " "));
    return out;
  }

  private async ensureOnSite(): Promise<Page> {
    const page = await this.getPage();
    if (!page.url().startsWith(BASE_URL)) return this.goto("/search");
    if (await this.isChallenge(page)) return this.passChallenge(page, 20_000);
    return page;
  }

  /** Check `/api/usage/status.json`; log in if the session is anonymous. */
  async ensureAuth(force = false): Promise<void> {
    return this.run(async () => {
      if (!force && Date.now() - this.authOkAt < AUTH_TTL_MS) return;
      const page = await this.ensureOnSite();
      const res = await this.rawFetch(page, "GET", "/api/usage/status.json");
      if (res.status === 200) {
        try {
          const j = JSON.parse(res.text);
          if (j.authenticated) {
            this.authOkAt = Date.now();
            await this.saveCookies();
            return;
          }
        } catch {
          /* fall through to login */
        }
      }
      await this.loginInternal();
    });
  }

  private async loginInternal(): Promise<void> {
    if (!this.email || !this.password) {
      throw new ApiError(
        "Not logged in and AWARDFARES_EMAIL / AWARDFARES_PASSWORD are not set. Set them in the MCP server env, or run awardfares_login with headed=true and log in manually.",
        401,
      );
    }
    log("logging in as", this.email);
    const page = await this.goto("/login");
    if (!page.url().includes("/login")) {
      // Already logged in (server redirected away from /login).
    } else {
      const emailInput = page.locator('input[name="email"], input[type="email"]').first();
      const passInput = page.locator('input[name="password"], input[type="password"]').first();
      await emailInput.waitFor({ state: "visible", timeout: 30_000 });
      await emailInput.fill(this.email);
      await passInput.fill(this.password);
      await Promise.all([
        page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 60_000 }).catch(() => undefined),
        passInput.press("Enter"),
      ]);
      await this.passChallenge(page, 20_000);
      if (page.url().includes("/login")) {
        const err = await page
          .locator(".error, .alert, [role=alert]")
          .first()
          .textContent({ timeout: 2000 })
          .catch(() => null);
        throw new ApiError(`Login failed${err ? `: ${err.trim()}` : ""}`, 401);
      }
    }
    const check = await this.rawFetch(page, "GET", "/api/usage/status.json");
    const j = check.status === 200 ? JSON.parse(check.text) : {};
    if (!j.authenticated) throw new ApiError("Login did not produce an authenticated session", 401);
    this.authOkAt = Date.now();
    await this.saveCookies();
    log("login ok, tier =", j.tier);
  }

  /** Force a fresh login, optionally with a visible window. */
  async login(headed?: boolean): Promise<void> {
    if (headed !== undefined && headed !== this.headed) {
      await this.run(async () => {
        await this.launch(headed);
      });
    }
    this.authOkAt = 0;
    await this.ensureAuth(true);
  }

  /**
   * JSON API call executed inside the page. Retries once after re-auth on 401/403,
   * and handles a Cloudflare challenge served to the fetch itself.
   */
  async api<T = unknown>(
    method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
    path: string,
    body?: unknown,
    query?: Record<string, string | number | boolean | undefined>,
  ): Promise<T> {
    await this.ensureAuth();
    return this.run(async () => {
      let page = await this.ensureOnSite();
      let res = await this.rawFetch(page, method, path, body, query);
      if (res.status === 403 && CHALLENGE_TITLE.test(res.text)) {
        log("api call hit a challenge; renavigating");
        page = await this.goto("/search");
        res = await this.rawFetch(page, method, path, body, query);
      }
      if (res.status === 401 || (res.status === 403 && !CHALLENGE_TITLE.test(res.text))) {
        // Session may have expired: re-login once.
        this.authOkAt = 0;
        await this.loginInternal();
        res = await this.rawFetch(page, method, path, body, query);
      }
      if (res.status >= 200 && res.status < 300) {
        if (res.status === 204 || res.text.trim() === "") return undefined as T;
        try {
          return JSON.parse(res.text) as T;
        } catch {
          throw new ApiError(`Non-JSON response from ${path}: ${res.text.slice(0, 200)}`, res.status);
        }
      }
      let message = `HTTP ${res.status} from ${method} ${path}`;
      let details: unknown;
      try {
        const j = JSON.parse(res.text);
        if (j?.errorMessage) message = `${j.errorMessage} (${res.status})`;
        details = j?.details ?? j;
      } catch {
        if (res.text) message += `: ${res.text.slice(0, 200)}`;
      }
      throw new ApiError(message, res.status, details);
    });
  }

  async close(): Promise<void> {
    const ctx = this.context;
    this.context = undefined;
    this.page = undefined;
    if (ctx) await ctx.close().catch(() => undefined);
  }
}
