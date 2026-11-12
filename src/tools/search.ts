import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AwardFaresApi, FaresQuery, SearchAges } from "../api.js";
import { compactFare } from "../format.js";
import { CABINS, normalizeCabin, normalizeLocation, normalizeProgram, PROGRAM_CODES } from "../programs.js";
import { resolveDates, sleep, tool } from "./util.js";

const DEFAULT_FFP = (process.env.AWARDFARES_DEFAULT_FFP ?? "sas").split(",").map((s) => s.trim());
const MAX_DATES = 31;

const locationList = z
  .array(z.string())
  .min(1)
  .describe('Locations: IATA codes ("CDG"), or prefixed values "airport:CDG", "area:PAR", "country:FR", "continent:EU"');

const commonFilter = {
  ffp: z
    .array(z.string())
    .optional()
    .describe(`Loyalty programs to search. Default: ${DEFAULT_FFP.join(",")}. Codes: ${PROGRAM_CODES.join(", ")}`),
  cabin: z.array(z.string()).optional().describe(`Restrict to cabins: ${CABINS.join(", ")}`),
  pax: z.number().int().min(1).max(9).optional().describe("Minimum seats required (passengers)"),
  stops: z.array(z.number().int().min(0).max(3)).optional().describe("Allowed number of stops, e.g. [0] nonstop only, [0,1]"),
  carriers: z.array(z.string()).optional().describe("Only these operating carriers (IATA codes, e.g. AF, KL)"),
  equipment: z.array(z.string()).optional().describe("Only these aircraft type codes (e.g. 77W, 359)"),
  minPrice: z.number().optional().describe("Minimum miles per passenger"),
  maxPrice: z.number().optional().describe("Maximum miles per passenger"),
  saver: z.boolean().optional().describe("Only saver-level awards"),
  excludeAirportChange: z.boolean().optional(),
  maxDuration: z.number().optional().describe("Maximum total travel time in minutes"),
  layoverMaxDuration: z.number().optional().describe("Maximum layover in minutes"),
  departEarliest: z.number().min(0).max(24).optional().describe("Earliest local departure hour (0-24)"),
  departLatest: z.number().min(0).max(24).optional(),
  arriveEarliest: z.number().min(0).max(24).optional(),
  arriveLatest: z.number().min(0).max(24).optional(),
  mixedCabins: z.number().min(0).max(1).optional().describe("Max share of segments in a lower cabin (0 = none, 1 = any)"),
  flight: z.string().optional().describe("Filter by flight number, e.g. AF654"),
};

type CommonFilter = {
  ffp?: string[];
  cabin?: string[];
  pax?: number;
  stops?: number[];
  carriers?: string[];
  equipment?: string[];
  minPrice?: number;
  maxPrice?: number;
  saver?: boolean;
  excludeAirportChange?: boolean;
  maxDuration?: number;
  layoverMaxDuration?: number;
  departEarliest?: number;
  departLatest?: number;
  arriveEarliest?: number;
  arriveLatest?: number;
  mixedCabins?: number;
  flight?: string;
};

export function buildFilter(a: CommonFilter): FaresQuery {
  const times: FaresQuery["times"] = {};
  if (a.departEarliest !== undefined) times.localDepartEarliest = a.departEarliest;
  if (a.departLatest !== undefined) times.localDepartLatest = a.departLatest;
  if (a.arriveEarliest !== undefined) times.localArriveEarliest = a.arriveEarliest;
  if (a.arriveLatest !== undefined) times.localArriveLatest = a.arriveLatest;
  const q: FaresQuery = {
    ffp: (a.ffp?.length ? a.ffp : DEFAULT_FFP).map(normalizeProgram),
    times,
  };
  if (a.cabin?.length) q.cabin = a.cabin.map(normalizeCabin);
  if (a.pax) q.pax = a.pax;
  if (a.stops?.length) q.stops = a.stops;
  if (a.carriers?.length) q.carriers = a.carriers.map((c) => c.toUpperCase());
  if (a.equipment?.length) q.equipment = a.equipment.map((c) => c.toUpperCase());
  if (a.minPrice) q.minPrice = a.minPrice;
  if (a.maxPrice) q.maxPrice = a.maxPrice;
  if (a.saver) q.saver = true;
  if (a.excludeAirportChange) q.excludeAirportChange = true;
  if (a.maxDuration) q.maxDuration = a.maxDuration;
  if (a.layoverMaxDuration) q.layoverMaxDuration = a.layoverMaxDuration;
  if (a.mixedCabins !== undefined && a.mixedCabins < 1) q.mixedCabins = a.mixedCabins;
  if (a.flight) q.flight = a.flight.toUpperCase();
  return q;
}

function isSearchable(loc: string) {
  return loc.startsWith("airport:") || loc.startsWith("area:");
}

/** Queue live searches in batches and wait until the provider searches complete. */
export async function runLiveSearch(
  api: AwardFaresApi,
  base: { origin: string[]; destination: string[]; ffp: string[]; cabin?: string[] },
  dates: string[],
  maxWaitSeconds: number,
  mode: "search" | "refresh" = "search",
) {
  const usage = await api.usage();
  const perBatch = Math.max(1, Math.floor((usage.search.maxPending || 30) / Math.max(1, base.ffp.length)));
  const queued: string[] = [];
  let timedOut = false;
  const started = Date.now();
  const deadline = started + maxWaitSeconds * 1000;
  let lastAges: SearchAges | undefined;
  for (let i = 0; i < dates.length; i += perBatch) {
    const batch = dates.slice(i, i + perBatch);
    const queuedAt = Date.now();
    const pending =
      mode === "search" ? await api.search({ ...base, dates: batch }) : await api.refresh({ ...base, dates: batch });
    queued.push(...pending.map((p) => `${p.origin}-${p.destination} ${p.date} [${p.providers.join(",")}]`));
    // Cells (provider|route|date) we expect to see a fresh completedAt for.
    const expected = new Set<string>();
    for (const p of pending) for (const prov of p.providers) expected.add(`${prov}|${p.origin}|${p.destination}|${p.date}`);
    if (!expected.size) continue;
    let polls = 0;
    for (;;) {
      lastAges = await api.searchAges({ origin: base.origin, destination: base.destination, ffp: base.ffp, dates: batch });
      polls++;
      for (const a of lastAges.ages ?? []) {
        const key = `${a.provider}|${a.origin}|${a.destination}|${a.localDateString}`;
        if (expected.has(key) && a.completedAt && Date.parse(a.completedAt) >= queuedAt - 5000) expected.delete(key);
      }
      const inProgress = lastAges.inProgress?.length ?? 0;
      if (!expected.size) break;
      // Nothing running any more and we've given the backend a few seconds: assume the cell failed/was skipped.
      if (!inProgress && polls >= 4) break;
      if (Date.now() > deadline) {
        timedOut = true;
        break;
      }
      await sleep(2000);
    }
    if (timedOut) break;
  }
  return {
    queued,
    completed: !timedOut,
    waitedSeconds: Math.round((Date.now() - started) / 1000),
    stillInProgress: lastAges?.inProgress?.length ?? 0,
    usageBefore: usage.search,
  };
}

export function freshness(ages: SearchAges | undefined) {
  if (!ages?.ages?.length) return undefined;
  const times = ages.ages.map((a) => a.completedAt).filter(Boolean).sort();
  return { oldest: times[0], newest: times[times.length - 1], cells: ages.ages.length };
}

export function registerSearchTools(server: McpServer, api: AwardFaresApi) {
  tool(
    server,
    "awardfares_search",
    `Search award availability on AwardFares. With live=true (default) this triggers fresh searches against the airline systems for every date x program combination (uses the daily live-search quota, ~5-30s), then returns the matching flights. With live=false it only returns results AwardFares already has cached (free, instant).
Origins/destinations must be airports or metro areas for live searches; countries/continents only work with live=false (broad search). Give either dates[] or dateStart/dateEnd (max ${MAX_DATES} days). Returns up to 50 fares per page with seats, miles, taxes per cabin; use page to get more and awardfares_flight for full detail on one fare.`,
    {
      origin: locationList,
      destination: locationList,
      dates: z.array(z.string()).optional().describe("Exact departure dates, YYYY-MM-DD"),
      dateStart: z.string().optional().describe("Start of a date range, YYYY-MM-DD"),
      dateEnd: z.string().optional().describe("End of a date range (inclusive), YYYY-MM-DD"),
      live: z.boolean().optional().describe("Trigger fresh airline searches before reading results (default true)"),
      maxWaitSeconds: z.number().int().min(5).max(300).optional().describe("How long to wait for live searches (default 90)"),
      page: z.number().int().min(0).optional().describe("Result page (50 per page), default 0"),
      sort: z.enum(["departs", "arrives", "duration", "economy", "premeco", "business", "first", "found", "stops"]).optional(),
      verbose: z.boolean().optional().describe("Return raw fare objects instead of compact summaries"),
      ...commonFilter,
    },
    async (a) => {
      const origin = a.origin.map(normalizeLocation);
      const destination = a.destination.map(normalizeLocation);
      const dates = resolveDates(a, MAX_DATES);
      const filter = buildFilter(a);
      const live = a.live ?? true;
      let liveResult: Awaited<ReturnType<typeof runLiveSearch>> | undefined;
      let note: string | undefined;
      if (live) {
        if (!dates.length) note = "live=true requires dates; returned cached results only.";
        else if (![...origin, ...destination].every(isSearchable))
          note = "Live searches need airport: or area: locations; returned cached results only.";
        else {
          liveResult = await runLiveSearch(
            api,
            { origin, destination, ffp: filter.ffp!, cabin: filter.cabin },
            dates,
            a.maxWaitSeconds ?? 90,
          );
        }
      }
      const query: FaresQuery = { ...filter, origin, destination, page: a.page ?? 0 };
      if (dates.length) query.exactDates = dates;
      if (a.sort) query.sort = { value: a.sort, order: "a" };
      const res = await api.fares(query);
      const ages = dates.length
        ? await api.searchAges({ origin, destination, ffp: filter.ffp!, dates }).catch(() => undefined)
        : undefined;
      return {
        query: { origin, destination, dates, ffp: filter.ffp, cabin: filter.cabin, page: a.page ?? 0 },
        note,
        live: liveResult,
        freshness: freshness(ages),
        count: res.fares.length,
        hasMore: res.fares.length >= 50,
        fares: a.verbose ? res.fares : res.fares.map(compactFare),
      };
    },
  );

  tool(
    server,
    "awardfares_calendar",
    "Per-day award availability overview for a route over a date range (cached data, no quota). Returns seat counts per cabin per day plus when each day was last searched. Use it to find candidate dates, then awardfares_search for details.",
    {
      origin: locationList,
      destination: locationList,
      dateStart: z.string().describe("YYYY-MM-DD"),
      dateEnd: z.string().describe("YYYY-MM-DD (inclusive), up to ~120 days"),
      ...commonFilter,
    },
    async (a) => {
      const origin = a.origin.map(normalizeLocation);
      const destination = a.destination.map(normalizeLocation);
      const filter = buildFilter(a);
      const res = await api.calendar({ ...filter, origin, destination, localDateStart: a.dateStart, localDateEnd: a.dateEnd });
      const days = Object.values(res.calendar)
        .sort((x, y) => x.date.localeCompare(y.date))
        .map((d) => {
          const times = (d.ages ?? []).map((g) => g.completedAt).sort();
          return {
            date: d.date,
            count: d.count,
            seats: d.availability,
            lastSearched: times[0],
            searching: d.inProgress?.length ? d.inProgress.length : undefined,
          };
        });
      const withSeats = days.filter((d) => d.count > 0);
      return {
        origin,
        destination,
        ffp: filter.ffp,
        cabin: filter.cabin,
        daysWithAvailability: withSeats.length,
        days,
      };
    },
  );

  tool(
    server,
    "awardfares_flight",
    "Full detail for one fare by its id (from awardfares_search): segments with booking classes, per-program availability and prices, and availability history.",
    {
      id: z.string().describe("Fare _id"),
    },
    async (a) => {
      const res = await api.fares({ ids: [a.id], allowDeparted: true, allowUnavailable: true });
      const f = res.fares[0];
      if (!f) throw new Error(`No fare with id ${a.id}`);
      return {
        summary: compactFare(f),
        key: f.key,
        sources: f.sources,
        segments: f.segments.map((s) => ({
          flight: s.flight,
          route: s.route,
          date: s.date,
          localDepart: s.localDepart,
          localArrive: s.localArrive,
          flightTime: s.flightTime,
          equipment: s.equipment,
          equipmentType: s.equipmentType,
          operatingCarrier: s.operatingCarrier,
          marketingCarrier: s.marketingCarrier,
          bookingClasses: s.bookingClasses,
          availability: s.availability,
        })),
        historicalAvailability: f.historicalAvailability,
        airports: { origin: f.originAirport, destination: f.destinationAirport },
      };
    },
  );

  tool(
    server,
    "awardfares_refresh",
    "Re-run the airline search for one route and date (uses live-search quota) and return the refreshed fares. Use when results look stale.",
    {
      origin: z.string().describe("Airport or area, e.g. CDG"),
      destination: z.string().describe("Airport or area, e.g. RUN"),
      date: z.string().describe("YYYY-MM-DD"),
      ffp: z.array(z.string()).optional(),
      cabin: z.array(z.string()).optional(),
      maxWaitSeconds: z.number().int().min(5).max(300).optional(),
    },
    async (a) => {
      const origin = [normalizeLocation(a.origin)];
      const destination = [normalizeLocation(a.destination)];
      const ffp = (a.ffp?.length ? a.ffp : DEFAULT_FFP).map(normalizeProgram);
      const cabin = a.cabin?.map(normalizeCabin);
      const live = await runLiveSearch(api, { origin, destination, ffp, cabin }, [a.date], a.maxWaitSeconds ?? 90, "refresh");
      const res = await api.fares({ origin, destination, ffp, cabin, exactDates: [a.date] });
      return { live, count: res.fares.length, fares: res.fares.map(compactFare) };
    },
  );
}
