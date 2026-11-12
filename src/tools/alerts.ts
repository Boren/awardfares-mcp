import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AlertInput, AwardFaresApi } from "../api.js";
import { compactAlert, compactFare } from "../format.js";
import { CABINS, normalizeCabin, normalizeLocation, normalizeProgram, PROGRAM_CODES } from "../programs.js";
import { resolveDates, tool } from "./util.js";

const DEFAULT_FFP = (process.env.AWARDFARES_DEFAULT_FFP ?? "sas").split(",").map((s) => s.trim());

const alertFields = {
  cabin: z.array(z.string()).optional().describe(`Cabins to watch: ${CABINS.join(", ")} (default any)`),
  minSeats: z.number().int().min(1).max(9).optional().describe("Minimum seats (default 1)"),
  carriers: z.array(z.string()).optional().describe("Only these carriers (IATA)"),
  stops: z.array(z.number().int().min(0).max(3)).optional().describe("Allowed stop counts, e.g. [0]"),
  minPrice: z.number().optional(),
  maxPrice: z.number().optional().describe("Max miles per passenger"),
  mixedCabins: z.number().min(0).max(1).optional().describe("Max share of lower-cabin segments (default 1)"),
  flight: z.string().optional().describe("Specific flight number"),
  saver: z.boolean().optional(),
  excludeAirportChanges: z.boolean().optional(),
  maxDuration: z.number().optional().describe("Max travel time in minutes"),
};

export function registerAlertTools(server: McpServer, api: AwardFaresApi) {
  tool(
    server,
    "awardfares_alerts_list",
    "List the account's availability alerts (live and flex).",
    { type: z.enum(["all", "live", "flex"]).optional() },
    async (a) => {
      const { alerts } = await api.alerts();
      const filtered = a.type && a.type !== "all" ? alerts.filter((x) => x.alertType === a.type) : alerts;
      return { count: filtered.length, alerts: filtered.map(compactAlert) };
    },
  );

  tool(
    server,
    "awardfares_alerts_get",
    "Get one alert and the fares currently matching it.",
    { id: z.string() },
    async (a) => {
      const res = await api.alertFares(a.id);
      return { alert: compactAlert(res.alert), matchingFares: res.fares.map(compactFare) };
    },
  );

  tool(
    server,
    "awardfares_alerts_create",
    `Create an availability alert. type="live" watches specific airport/area routes on exact dates and re-searches the airlines regularly (counts toward the live-alert quota). type="flex" watches broader criteria (countries/continents, any dates) against results AwardFares finds anyway. Programs codes: ${PROGRAM_CODES.join(", ")}.`,
    {
      type: z.enum(["live", "flex"]).optional().describe("Default live"),
      origin: z.array(z.string()).optional().describe("Locations (IATA or prefixed). Empty = anywhere (flex only)"),
      destination: z.array(z.string()).optional().describe("Locations. Empty = anywhere (flex only)"),
      dates: z.array(z.string()).optional().describe("Departure dates YYYY-MM-DD"),
      dateStart: z.string().optional(),
      dateEnd: z.string().optional().describe("Inclusive; expands to one alert covering each date"),
      ffp: z.array(z.string()).optional().describe(`Programs (default ${DEFAULT_FFP.join(",")})`),
      ...alertFields,
    },
    async (a) => {
      const type = a.type ?? "live";
      const origin = (a.origin ?? []).map(normalizeLocation);
      const destination = (a.destination ?? []).map(normalizeLocation);
      const dates = resolveDates(a, 60);
      if (type === "live" && (!origin.length || !destination.length || !dates.length))
        throw new Error("Live alerts need origin, destination and at least one date");
      const body: AlertInput = {
        alertType: type,
        origin,
        destination,
        departureDates: dates,
        ffp: (a.ffp?.length ? a.ffp : DEFAULT_FFP).map(normalizeProgram),
        cabin: a.cabin?.length ? a.cabin.map(normalizeCabin) : null,
        carriers: a.carriers?.length ? a.carriers.map((c) => c.toUpperCase()) : null,
        numberOfStops: a.stops?.length ? a.stops : null,
        minAvailability: a.minSeats ?? 1,
        mixedCabins: a.mixedCabins ?? 1,
        minPrice: a.minPrice ?? 0,
        maxPrice: a.maxPrice ?? 0,
        minDuration: 0,
        maxDuration: a.maxDuration ?? 0,
        flight: a.flight ? a.flight.toUpperCase() : null,
        times: undefined,
        saver: a.saver,
        excludeAirportChanges: a.excludeAirportChanges ?? false,
      };
      const created = await api.createAlert(body);
      return { created: compactAlert(created) };
    },
  );

  tool(
    server,
    "awardfares_alerts_update",
    "Update fields of an existing alert. Only the provided fields change.",
    {
      id: z.string(),
      origin: z.array(z.string()).optional(),
      destination: z.array(z.string()).optional(),
      dates: z.array(z.string()).optional(),
      ffp: z.array(z.string()).optional(),
      ...alertFields,
    },
    async (a) => {
      const existing = (await api.alertFares(a.id)).alert;
      const patch: Partial<AlertInput> & { _id?: string } = {
        alertType: existing.alertType,
        origin: a.origin ? a.origin.map(normalizeLocation) : existing.origin ?? [],
        destination: a.destination ? a.destination.map(normalizeLocation) : existing.destination ?? [],
        departureDates: a.dates ?? existing.departureDates ?? [],
        ffp: a.ffp ? a.ffp.map(normalizeProgram) : existing.ffp ?? [],
        cabin: a.cabin !== undefined ? (a.cabin.length ? a.cabin.map(normalizeCabin) : null) : existing.cabin ?? null,
        carriers: a.carriers !== undefined ? (a.carriers.length ? a.carriers : null) : existing.carriers ?? null,
        numberOfStops: a.stops !== undefined ? (a.stops.length ? a.stops : null) : existing.numberOfStops ?? null,
        minAvailability: a.minSeats ?? existing.minAvailability ?? 1,
        mixedCabins: a.mixedCabins ?? existing.mixedCabins ?? 1,
        minPrice: a.minPrice ?? existing.minPrice ?? 0,
        maxPrice: a.maxPrice ?? existing.maxPrice ?? 0,
        minDuration: existing.minDuration ?? 0,
        maxDuration: a.maxDuration ?? existing.maxDuration ?? 0,
        flight: a.flight !== undefined ? a.flight || null : existing.flight ?? null,
        times: existing.times,
        saver: a.saver ?? existing.saver,
        excludeAirportChanges: a.excludeAirportChanges ?? existing.excludeAirportChanges ?? false,
      };
      const updated = await api.updateAlert(a.id, patch);
      return { updated: compactAlert(updated) };
    },
  );

  tool(
    server,
    "awardfares_alerts_delete",
    "Delete one alert by id.",
    { id: z.string() },
    async (a) => {
      await api.deleteAlert(a.id);
      return { deleted: a.id };
    },
  );
}
