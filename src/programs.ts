/** Loyalty program codes accepted by the AwardFares API (`ffp` field). */
export const PROGRAMS: Record<string, string> = {
  aadvantage: "American AAdvantage",
  aeromexico: "Aeromexico Rewards",
  aeroplan: "Air Canada Aeroplan",
  alaska: "Atmos Rewards (Alaska & Hawaiian)",
  azul: "Azul Fidelidade",
  ba: "British Airways Club",
  delta: "Delta SkyMiles",
  etihad: "Etihad Guest",
  finnair: "Finnair Plus",
  flyingblue: "AF/KLM Flying Blue",
  flyingclub: "Virgin Atlantic Flying Club",
  indigo: "IndiGo BluChip",
  jetblue: "jetBlue TrueBlue",
  lifemiles: "Avianca LifeMiles",
  qantas: "Qantas Frequent Flyer",
  qatar: "Qatar Airways Privilege Club",
  sas: "SAS EuroBonus",
  smilesar: "GOL Smiles (Argentina)",
  smilesbr: "GOL Smiles (Brazil)",
  turkish: "Turkish Miles&Smiles",
  united: "United MileagePlus",
  virginaustralia: "Virgin Australia Velocity",
};

export const PROGRAM_CODES = Object.keys(PROGRAMS);

export const CABINS = ["economy", "premeco", "business", "first"] as const;
export type Cabin = (typeof CABINS)[number];

export const CABIN_LABEL: Record<Cabin, string> = {
  economy: "Economy",
  premeco: "Premium Economy",
  business: "Business",
  first: "First",
};

/** Aliases users are likely to type for program codes. */
const PROGRAM_ALIASES: Record<string, string> = {
  eurobonus: "sas",
  "sas eurobonus": "sas",
  "flying blue": "flyingblue",
  klm: "flyingblue",
  airfrance: "flyingblue",
  "air france": "flyingblue",
  american: "aadvantage",
  aa: "aadvantage",
  avios: "ba",
  "british airways": "ba",
  "air canada": "aeroplan",
  avianca: "lifemiles",
  "united mileageplus": "united",
  mileageplus: "united",
  skymiles: "delta",
  "virgin atlantic": "flyingclub",
  velocity: "virginaustralia",
  "miles&smiles": "turkish",
  "miles and smiles": "turkish",
  "privilege club": "qatar",
  "etihad guest": "etihad",
  hawaiian: "alaska",
  "mileage plan": "alaska",
  atmos: "alaska",
  trueblue: "jetblue",
  smiles: "smilesbr",
};

export function normalizeProgram(input: string): string {
  const key = input.trim().toLowerCase();
  if (PROGRAMS[key]) return key;
  if (PROGRAM_ALIASES[key]) return PROGRAM_ALIASES[key];
  throw new Error(
    `Unknown loyalty program "${input}". Valid codes: ${PROGRAM_CODES.join(", ")}`,
  );
}

export function normalizeCabin(input: string): Cabin {
  const key = input.trim().toLowerCase().replace(/[\s_-]+/g, "");
  const map: Record<string, Cabin> = {
    economy: "economy",
    eco: "economy",
    y: "economy",
    premeco: "premeco",
    premiumeconomy: "premeco",
    premium: "premeco",
    w: "premeco",
    business: "business",
    biz: "business",
    j: "business",
    c: "business",
    first: "first",
    f: "first",
  };
  const cabin = map[key];
  if (!cabin) throw new Error(`Unknown cabin "${input}". Use one of: ${CABINS.join(", ")}`);
  return cabin;
}

/**
 * Normalize a location to the `type:CODE` form the API expects.
 * Accepts "CDG", "airport:CDG", "area:PAR", "country:FR", "continent:EU".
 * Bare 3-letter codes are treated as airports; bare 2-letter codes as countries.
 */
export function normalizeLocation(input: string): string {
  const s = input.trim();
  const m = /^(airport|area|country|continent):([A-Za-z0-9]+)$/.exec(s);
  if (m) return `${m[1]}:${m[2].toUpperCase()}`;
  if (/^[A-Za-z]{3}$/.test(s)) return `airport:${s.toUpperCase()}`;
  if (/^[A-Za-z]{2}$/.test(s)) return `country:${s.toUpperCase()}`;
  throw new Error(
    `Cannot interpret location "${input}". Use an IATA code (CDG), or a prefixed value such as airport:CDG, area:PAR, country:FR, continent:EU. Use awardfares_locations to look up codes.`,
  );
}

export function stripLocation(value: string): string {
  return value.replace(/^[a-z]+:/, "");
}
