import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AwardFaresApi } from "../api.js";
import type { Session } from "../session.js";
import { CABIN_LABEL, PROGRAMS } from "../programs.js";
import { tool } from "./util.js";

export function registerMetaTools(server: McpServer, api: AwardFaresApi, session: Session) {
  tool(
    server,
    "awardfares_status",
    "Account tier, login state and remaining quotas (live searches today, live/flex alerts, seat-map lookups this month).",
    {},
    async () => {
      const u = await api.usage();
      return {
        tier: u.tier,
        authenticated: u.authenticated,
        liveSearches: { usedToday: u.search.used, limit: u.search.limit, pending: u.search.pending, maxPending: u.search.maxPending, resetsAt: u.search.reset },
        alerts: { liveUsed: u.alerts.liveUsed, liveLimit: u.alerts.liveLimit, flexUsed: u.alerts.flexUsed, flexLimit: u.alerts.flexLimit, resetsAt: u.alerts.reset },
        seatMaps: { used: u.seatMap.used, limit: u.seatMap.limit, resetsAt: u.seatMap.reset },
        browser: { open: session.isOpen, headed: session.isHeaded, profileDir: session.profileDir },
      };
    },
  );

  tool(
    server,
    "awardfares_locations",
    "Look up airports, metro areas, countries and continents by name or code. Returns the exact location values (airport:CDG, area:PAR, country:FR, ...) to use in other tools.",
    { q: z.string().min(1).describe("Free text, e.g. 'paris', 'reunion', 'cdg'") },
    async (a) => {
      const res = await api.locations(a.q);
      return res.map((l) => ({ value: l.value, label: l.title, detail: l.subTitle, area: l.area }));
    },
  );

  tool(
    server,
    "awardfares_programs",
    "List supported loyalty program codes (for the ffp parameter) and cabin codes.",
    {},
    async () => ({ programs: PROGRAMS, cabins: CABIN_LABEL }),
  );

  tool(
    server,
    "awardfares_airlines",
    "Airline IATA codes known to AwardFares (for carrier filters), optionally filtered by name substring.",
    { q: z.string().optional() },
    async (a) => {
      const { airlines } = await api.airlines();
      const q = a.q?.toLowerCase();
      return airlines
        .filter((x) => !q || x.label.toLowerCase().includes(q) || x.value.toLowerCase() === q)
        .map((x) => ({ code: x.value, name: x.label, alliance: x.alliance }));
    },
  );

  tool(
    server,
    "awardfares_login",
    "Force a fresh login. Set headed=true to open a visible browser window (needed if Cloudflare shows a challenge or to log in manually).",
    { headed: z.boolean().optional() },
    async (a) => {
      await session.login(a.headed);
      const u = await api.usage();
      return { authenticated: u.authenticated, tier: u.tier, headed: session.isHeaded };
    },
  );
}
