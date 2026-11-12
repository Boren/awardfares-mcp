import type { Alert, CabinCounts, Fare, Journey, JourneySummary, Segment } from "./api.js";
import { CABINS } from "./programs.js";

function hhmm(iso: string | undefined): string {
  if (!iso) return "?";
  // local* fields are ISO strings whose wall-clock part is already local time.
  const m = /T(\d{2}:\d{2})/.exec(iso);
  return m ? m[1] : iso;
}

function ymd(iso: string | undefined): string {
  return iso ? iso.slice(0, 10) : "?";
}

export function minutesToHm(min: number | undefined): string {
  if (min === undefined || min === null) return "?";
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h ? `${h}h${m ? `${m}m` : ""}` : `${m}m`;
}

function nonZero(c: CabinCounts | undefined): Partial<CabinCounts> | undefined {
  if (!c) return undefined;
  const out: Partial<CabinCounts> = {};
  for (const k of CABINS) if (c[k]) out[k] = c[k];
  return Object.keys(out).length ? out : undefined;
}

export function formatSegment(s: Segment): string {
  const op = s.operatingCarrier && s.operatingCarrier !== s.marketingCarrier ? ` op ${s.operatingCarrier}` : "";
  const bc = s.bookingClasses ? ` [${Object.entries(s.bookingClasses).map(([k, v]) => `${k}${v}`).join(" ")}]` : "";
  return `${s.flight} ${s.origin}-${s.destination} ${ymd(s.localDepart)} ${hhmm(s.localDepart)}-${hhmm(s.localArrive)}${ymd(s.localArrive) !== ymd(s.localDepart) ? "+1" : ""} ${s.equipmentType}${op}${bc}`;
}

export interface CompactFare {
  id: string;
  date: string;
  route: string;
  flights: string;
  stops: number;
  carriers?: string[];
  depart: string;
  arrive: string;
  duration: string;
  longestLayover?: string;
  seats?: Partial<CabinCounts>;
  miles?: Partial<CabinCounts>;
  taxes?: Partial<CabinCounts>;
  currency?: string;
  saver?: string[];
  mixedCabins?: Partial<CabinCounts>;
  airportChange?: boolean;
  programs?: Record<string, { seats?: Partial<CabinCounts>; miles?: Partial<CabinCounts>; classes?: Record<string, number>; updatedAt?: string }>;
  segments: string[];
  foundAt?: string;
}

export function compactFare(f: Fare): CompactFare {
  const saver = f.saver ? CABINS.filter((c) => f.saver![c] && f.availability?.[c]) : [];
  const programs: CompactFare["programs"] = {};
  for (const [code, src] of Object.entries(f.sources ?? {})) {
    if (!src) continue;
    programs[code] = {
      seats: nonZero(src.availability),
      miles: nonZero(src.prices),
      classes: src.bookingClasses,
      updatedAt: src.updatedAt,
    };
  }
  return {
    id: f._id,
    date: f.date,
    route: f.route ?? `${f.origin}-${f.destination}`,
    flights: f.flight,
    stops: f.numberOfStops,
    carriers: f.uniqueCarriers,
    depart: `${ymd(f.localDepart)} ${hhmm(f.localDepart)}`,
    arrive: `${ymd(f.localArrive)} ${hhmm(f.localArrive)}`,
    duration: minutesToHm(f.flightTime),
    longestLayover: f.numberOfStops ? minutesToHm(f.longestLayover) : undefined,
    seats: nonZero(f.availability),
    miles: nonZero(f.prices),
    taxes: nonZero(f.taxes),
    currency: f.currency,
    saver: saver.length ? saver : undefined,
    mixedCabins: nonZero(f.mixedCabins),
    airportChange: f.hasAirportChange || undefined,
    programs: Object.keys(programs).length ? programs : undefined,
    segments: (f.segments ?? []).map(formatSegment),
    foundAt: f.foundAt,
  };
}

export function compactAlert(a: Alert) {
  return {
    id: a._id,
    type: a.alertType,
    origin: a.origin,
    destination: a.destination,
    departureDates: a.departureDates,
    ffp: a.ffp,
    cabin: a.cabin ?? undefined,
    minSeats: a.minAvailability,
    carriers: a.carriers ?? undefined,
    stops: a.numberOfStops ?? undefined,
    minPrice: a.minPrice || undefined,
    maxPrice: a.maxPrice || undefined,
    mixedCabins: a.mixedCabins !== undefined && a.mixedCabins < 1 ? a.mixedCabins : undefined,
    flight: a.flight || undefined,
    times: a.times && Object.keys(a.times).length ? a.times : undefined,
    saver: a.saver || undefined,
    excludeAirportChanges: a.excludeAirportChanges || undefined,
    searchCount: a.searchCount,
    matchingFares: a.numMatchingFares,
    createdAt: a.createdAt,
  };
}

export function compactJourney(j: JourneySummary | Journey) {
  const fares = "fares" in j ? j.fares : undefined;
  return {
    id: j._id,
    name: j.customName || j.label,
    label: j.label,
    active: j.active,
    sharingUrl: j.sharingUrl ? `https://awardfares.com${j.sharingUrl}` : undefined,
    fares: fares?.map(compactFare),
  };
}

export function json(data: unknown): string {
  return JSON.stringify(data, null, 1);
}
