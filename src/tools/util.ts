import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ZodRawShape } from "zod";
import { ApiError } from "../session.js";
import { json } from "../format.js";

export type ToolResult = { content: Array<{ type: "text"; text: string }>; isError?: boolean };

export function ok(data: unknown): ToolResult {
  return { content: [{ type: "text", text: typeof data === "string" ? data : json(data) }] };
}

export function fail(err: unknown): ToolResult {
  const msg =
    err instanceof ApiError
      ? `${err.message}${err.details ? `\n${json(err.details)}` : ""}`
      : err instanceof Error
        ? err.message
        : String(err);
  return { content: [{ type: "text", text: `Error: ${msg}` }], isError: true };
}

export function tool<S extends ZodRawShape>(
  server: McpServer,
  name: string,
  description: string,
  schema: S,
  handler: (args: { [K in keyof S]: S[K]["_output"] }) => Promise<unknown>,
) {
  const cb = async (args: { [K in keyof S]: S[K]["_output"] }): Promise<ToolResult> => {
    try {
      return ok(await handler(args));
    } catch (e) {
      return fail(e);
    }
  };
  // The SDK's callback generics are stricter than needed; our ToolResult is a valid CallToolResult.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  server.registerTool(name, { description, inputSchema: schema }, cb as any);
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function assertDate(d: string): string {
  if (!DATE_RE.test(d)) throw new Error(`Invalid date "${d}", expected YYYY-MM-DD`);
  return d;
}

export function expandDates(start: string, end: string, cap: number): string[] {
  assertDate(start);
  assertDate(end);
  const out: string[] = [];
  const d = new Date(`${start}T00:00:00Z`);
  const last = new Date(`${end}T00:00:00Z`);
  if (last < d) throw new Error("dateEnd is before dateStart");
  while (d <= last) {
    out.push(d.toISOString().slice(0, 10));
    if (out.length > cap) throw new Error(`Date range too long: at most ${cap} dates per call`);
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

export function resolveDates(args: { dates?: string[]; dateStart?: string; dateEnd?: string }, cap: number): string[] {
  if (args.dates?.length) return args.dates.map(assertDate);
  if (args.dateStart) return expandDates(args.dateStart, args.dateEnd ?? args.dateStart, cap);
  return [];
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
