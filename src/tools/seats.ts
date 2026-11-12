import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AwardFaresApi } from "../api.js";
import { normalizeCabin, stripLocation } from "../programs.js";
import { minutesToHm } from "../format.js";
import { tool } from "./util.js";

function iata(s: string) {
  return stripLocation(s).toUpperCase();
}

/** Summarize the seat map grid: counts per status plus the available seat numbers. */
function summarizeSeatmap(raw: unknown) {
  const o = (raw ?? {}) as Record<string, unknown>;
  const counts: Record<string, number> = {};
  const available: string[] = [];
  const exitRows = new Set<string>();
  let seats = 0;
  const decks = Array.isArray(o.decks) ? (o.decks as Array<Record<string, unknown>>) : [];
  for (const deck of decks) {
    for (const section of (deck.sections as Array<Record<string, unknown>>) ?? []) {
      for (const row of (section.grid as Array<Array<Record<string, unknown>>>) ?? []) {
        for (const cell of row) {
          if (cell?.type !== "seat") continue;
          seats++;
          const status = String(cell.status ?? "unknown");
          counts[status] = (counts[status] ?? 0) + 1;
          const number = String(cell.number ?? "");
          if (status === "available" && number) available.push(number + (cell.premium ? "*" : ""));
          if (cell.exit && number) exitRows.add(number.replace(/[A-Z]+$/, ""));
        }
      }
    }
  }
  if (!seats) return undefined;
  return {
    equipment: o.equipment,
    seats,
    byStatus: counts,
    available,
    exitRows: exitRows.size ? [...exitRows] : undefined,
    legend: "* = premium/chargeable seat",
  };
}

type ScheduleRow = Record<string, unknown> & {
  flight?: string;
  localDepart?: string;
  localArrive?: string;
  equipmentType?: string;
  flightTime?: number;
  bookingClasses?: Record<string, number>;
  codeShare?: boolean;
  operatingCarrier?: string;
  marketingCarrier?: string;
};

function compactSchedule(raw: unknown) {
  if (!Array.isArray(raw)) return raw;
  const hhmm = (iso?: string) => (iso && /T(\d{2}:\d{2})/.exec(iso)?.[1]) ?? "?";
  return (raw as ScheduleRow[]).map((r) => ({
    flight: r.flight,
    depart: hhmm(r.localDepart),
    arrive: hhmm(r.localArrive),
    duration: minutesToHm(r.flightTime),
    aircraft: r.equipmentType,
    operator: r.operatingCarrier !== r.marketingCarrier ? r.operatingCarrier : undefined,
    codeShare: r.codeShare || undefined,
    bookingClasses: r.bookingClasses
      ? Object.entries(r.bookingClasses)
          .map(([k, v]) => `${k}${v}`)
          .join(" ")
      : undefined,
  }));
}

export function registerSeatTools(server: McpServer, api: AwardFaresApi) {
  tool(
    server,
    "awardfares_seatmap",
    "Live seat map for one flight segment. WARNING: every call consumes one seat-map lookup from a limited monthly quota (see awardfares_status). Only call when the user explicitly wants seat availability.",
    {
      from: z.string().describe("Origin airport IATA"),
      to: z.string().describe("Destination airport IATA"),
      date: z.string().describe("YYYY-MM-DD"),
      flight: z.string().describe("Flight number, e.g. AF654"),
      cabin: z.string().optional().describe("economy (default), premeco, business, first"),
      verbose: z.boolean().optional().describe("Include the raw seat map payload"),
    },
    async (a) => {
      const raw = await api.seatmap({
        from: iata(a.from),
        to: iata(a.to),
        date: a.date,
        flight: a.flight.toUpperCase().replace(/\s+/g, ""),
        cabin: a.cabin ? normalizeCabin(a.cabin) : "economy",
      });
      const summary = summarizeSeatmap(raw);
      return a.verbose || !summary ? { summary, seatmap: raw } : { summary, note: "pass verbose=true for the full grid with seat characteristics" };
    },
  );

  tool(
    server,
    "awardfares_schedule",
    "Flight schedule with per-booking-class availability for a route on a date (revenue availability, not award-specific). Useful to see which flights operate and how full they are.",
    {
      from: z.string().describe("Origin airport IATA"),
      to: z.string().describe("Destination airport IATA"),
      date: z.string().describe("YYYY-MM-DD"),
      verbose: z.boolean().optional().describe("Return the raw flight objects"),
    },
    async (a) => {
      const raw = await api.availability({ from: iata(a.from), to: iata(a.to), date: a.date });
      return a.verbose ? raw : compactSchedule(raw);
    },
  );
}
