import type { Session } from "./session.js";

export type CabinCounts = { economy: number; premeco: number; business: number; first: number };
export type CabinFlags = { economy: boolean; premeco: boolean; business: boolean; first: boolean };

export interface UsageStatus {
  tier: string;
  authenticated: boolean;
  search: { pending: number; used: number; maxPending: number; limit: number; reset: string };
  alerts: {
    triggered: number;
    liveUsed: number;
    liveLimit: number;
    flexUsed: number;
    flexLimit: number;
    reset: string;
  };
  seatMap: { used: number; limit: number; reset: string };
}

export interface Location {
  shortLabel: string;
  value: string;
  title: string;
  subTitle: string;
  countryCode?: string;
  continentCode?: string;
  cityName?: string;
  area?: string;
  areaName?: string;
}

export interface Airport {
  code: string;
  name: string;
  cityName: string;
  countryCode: string;
  countryName?: string;
  tz?: string;
}

export interface Segment {
  date: string;
  origin: string;
  destination: string;
  depart: string;
  arrive: string;
  localDepart: string;
  localArrive: string;
  equipment: string;
  equipmentType: string;
  flightNumber: string;
  operatingCarrier: string;
  marketingCarrier: string;
  flightTime: number;
  route: string;
  flight: string;
  source?: string;
  bookingClasses?: Record<string, number>;
  availability?: CabinCounts;
  fares?: CabinFlags;
  originAirport?: Airport;
  destinationAirport?: Airport;
}

export interface FareSource {
  updatedAt?: string;
  bookingClasses?: Record<string, number>;
  availability?: CabinCounts;
  prices?: CabinCounts;
  taxes?: CabinCounts;
  fares?: CabinFlags;
  saver?: CabinFlags;
  mixedCabins?: CabinCounts;
  bookingSource?: string;
  currency?: string;
  [k: string]: unknown;
}

export interface Fare {
  _id: string;
  key: string;
  date: string;
  origin: string;
  destination: string;
  route: string;
  flight: string;
  flightNumber: string;
  numberOfStops: number;
  depart: string;
  arrive: string;
  localDepart: string;
  localArrive: string;
  flightTime: number;
  longestLayover?: number;
  shortestLayover?: number;
  equipment: string;
  equipmentType: string;
  operatingCarrier: string;
  marketingCarrier: string;
  uniqueCarriers?: string[];
  availability: CabinCounts;
  fares: CabinFlags;
  prices?: CabinCounts;
  taxes?: CabinCounts;
  currency?: string;
  saver?: CabinFlags;
  mixedCabins?: CabinCounts;
  hasAirportChange?: boolean;
  foundAt?: string;
  updatedAt?: string;
  sources?: Record<string, FareSource>;
  segments: Segment[];
  stops?: string[];
  historicalAvailability?: Array<{ date: string } & CabinCounts>;
  originAirport?: Airport;
  destinationAirport?: Airport;
}

export interface PendingSearch {
  _id: string;
  date: string;
  origin: string;
  destination: string;
  createdAt: string;
  providers: string[];
  allProviders?: string[];
}

export interface SearchAge {
  provider: string;
  origin: string;
  destination: string;
  localDateString: string;
  completedAt: string;
}

export interface SearchAges {
  ages: SearchAge[];
  inProgress: Array<Partial<SearchAge> & Record<string, unknown>>;
}

export interface CalendarDay {
  date: string;
  count: number;
  availability: CabinCounts;
  ages?: SearchAge[];
  inProgress?: unknown[];
}

export interface CalendarResponse {
  calendar: Record<string, CalendarDay>;
  firstDate?: string;
}

export interface Times {
  localDepartEarliest?: number;
  localDepartLatest?: number;
  localArriveEarliest?: number;
  localArriveLatest?: number;
}

/** Filter model mirrored from the AwardFares search page. */
export interface FaresQuery {
  origin?: string[];
  destination?: string[];
  ffp?: string[];
  exactDates?: string[];
  cabin?: string[];
  carriers?: string[];
  pax?: number;
  equipment?: string[];
  stops?: number[];
  layoverAirports?: string[];
  flight?: string;
  exactFlight?: string;
  times?: Times;
  mixedCabins?: number;
  minPrice?: number;
  maxPrice?: number;
  saver?: boolean;
  excludeAirportChange?: boolean;
  minDuration?: number;
  maxDuration?: number;
  layoverMinDuration?: number;
  layoverMaxDuration?: number;
  sort?: { value: string; order: "a" | "d" };
  page?: number;
  ids?: string[];
  allowDeparted?: boolean;
  allowUnavailable?: boolean;
}

export interface Alert {
  _id: string;
  alertType: "live" | "flex";
  origin?: string[];
  destination?: string[];
  originLocations?: Location[];
  destinationLocations?: Location[];
  departureDates?: string[];
  ffp?: string[];
  cabin?: string[] | null;
  carriers?: string[] | null;
  numberOfStops?: number[] | null;
  minAvailability?: number;
  mixedCabins?: number;
  minPrice?: number;
  maxPrice?: number;
  minDuration?: number;
  maxDuration?: number;
  flight?: string | null;
  times?: Times;
  saver?: boolean;
  excludeAirportChanges?: boolean;
  searchCount?: number;
  numMatchingFares?: number;
  createdAt?: string;
  [k: string]: unknown;
}

export interface AlertInput {
  alertType: "live" | "flex";
  origin: string[];
  destination: string[];
  departureDates: string[];
  ffp: string[];
  cabin: string[] | null;
  carriers: string[] | null;
  numberOfStops: number[] | null;
  minAvailability: number;
  mixedCabins: number;
  minPrice: number;
  maxPrice: number;
  minDuration: number;
  maxDuration: number;
  flight: string | null;
  times?: Times;
  saver?: boolean;
  excludeAirportChanges: boolean;
}

export interface JourneySummary {
  _id: string;
  label: string;
  customName?: string;
  active?: boolean;
  sharingUrl?: string;
  belongsToCurrentUser?: boolean;
}

export interface Journey extends JourneySummary {
  fares: Fare[];
}

export interface ScheduleFlight {
  [k: string]: unknown;
}

export class AwardFaresApi {
  constructor(private readonly s: Session) {}

  usage() {
    return this.s.api<UsageStatus>("GET", "/api/usage/status.json");
  }

  locations(q: string) {
    return this.s.api<Location[]>("GET", "/api/locations.json", undefined, { q });
  }

  airlines() {
    return this.s.api<{ airlines: Array<{ label: string; value: string; alliance?: string }> }>(
      "GET",
      "/api/airlines.json",
    );
  }

  equipment() {
    return this.s.api<Array<{ label: string; value: string }>>("GET", "/api/equipment.json");
  }

  /** Trigger live searches. Returns the newly queued searches (empty if results are fresh). */
  search(body: { origin: string[]; destination: string[]; dates: string[]; ffp: string[]; cabin?: string[] }) {
    return this.s.api<PendingSearch[]>("POST", "/api/search.json", body);
  }

  refresh(body: { origin: string[]; destination: string[]; dates: string[]; ffp: string[]; cabin?: string[] }) {
    return this.s.api<PendingSearch[]>("POST", "/api/refresh.json", body);
  }

  searchAges(body: { origin: string[]; destination: string[]; ffp: string[]; dates: string[] }) {
    return this.s.api<SearchAges>("POST", "/api/search-ages.json", body);
  }

  pendingSearches() {
    return this.s.api<PendingSearch[]>("GET", "/api/searches.json");
  }

  fares(query: FaresQuery) {
    const body: FaresQuery = {
      flight: "",
      exactFlight: "",
      times: {},
      sort: { value: "departs", order: "a" },
      ...query,
    };
    return this.s.api<{ fares: Fare[] }>("POST", "/api/fares.json", body);
  }

  calendar(query: Omit<FaresQuery, "exactDates" | "page" | "sort"> & { localDateStart: string; localDateEnd: string }) {
    const body = { flight: "", exactFlight: "", times: {}, ...query };
    return this.s.api<CalendarResponse>("POST", "/api/calendar.json", body);
  }

  // ---- alerts ----
  alerts() {
    return this.s.api<{ alerts: Alert[] }>("GET", "/api/alerts.json");
  }
  alertFares(id: string) {
    return this.s.api<{ alert: Alert; fares: Fare[] }>("GET", `/api/alerts/${id}/fares.json`);
  }
  createAlert(body: AlertInput) {
    return this.s.api<Alert>("POST", "/api/alerts.json", body);
  }
  updateAlert(id: string, body: Partial<AlertInput>) {
    return this.s.api<Alert>("PUT", `/api/alerts/${id}`, body);
  }
  deleteAlert(id: string) {
    return this.s.api<void>("DELETE", `/api/alerts/${id}`);
  }
  findAlert(body: {
    origin: string[];
    destination: string[];
    departureDates: string[];
    ffp: string[];
    excludeAirportChanges: boolean;
  }) {
    return this.s.api<Alert | Record<string, never>>("POST", "/api/find-alert.json", body);
  }

  // ---- journeys ----
  journeys() {
    return this.s.api<{ journeys: JourneySummary[] }>("GET", "/api/journeys.json");
  }
  activeJourney() {
    return this.s.api<Journey>("GET", "/api/journey.json");
  }
  setActiveJourney(journeyId: string) {
    return this.s.api<Journey>("PUT", "/api/journey.json", { id: journeyId });
  }
  createJourney() {
    return this.s.api<Journey>("POST", "/api/journey/create.json", {});
  }
  addFareToJourney(fareId: string) {
    return this.s.api<Journey>("POST", "/api/journey/add.json", { id: fareId });
  }
  removeFareFromJourney(fareId: string) {
    return this.s.api<Journey>("DELETE", "/api/journey.json", { id: fareId });
  }
  renameJourney(journeyId: string, customName: string) {
    return this.s.api<Journey>("PATCH", "/api/journey/update-name.json", { id: journeyId, customName });
  }
  deleteJourney(journeyId: string) {
    return this.s.api<void>("DELETE", `/api/journey/delete/${journeyId}`);
  }
  shareJourney(journeyId: string) {
    return this.s.api<{ sharingUrl: string }>("POST", "/api/journey/share.json", { id: journeyId });
  }

  // ---- seats & schedules ----
  seatmap(q: { from: string; to: string; date: string; flight: string; cabin: string }) {
    return this.s.api<Record<string, unknown>>("GET", "/api/seatmap.json", undefined, q);
  }
  availability(q: { from: string; to: string; date: string }) {
    return this.s.api<ScheduleFlight[] | Record<string, unknown>>("GET", "/api/availability.json", undefined, q);
  }
}
