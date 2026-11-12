# AwardFares internal API (as used by this server)

Recovered from the production bundles at `https://static.awardfares.com/production/assets/` and a HAR capture (October 2026). Not an official API.

## Conventions

- Base: `https://awardfares.com`. Cookie session (`sid`), plus Cloudflare `cf_clearance`. No CSRF token.
- Request headers: `Content-Type: application/json`, `accept: application/json`, `x-af-language: en`.
- Errors: non-2xx with JSON `{errorMessage, details?}`. 204 = empty body. 403 with an HTML "Just a moment..." body = Cloudflare challenge.
- Login: `POST /login` form-encoded `email`, `password` → 302 `/`, sets `sid` (session cookie).
- Locations are strings: `airport:CDG`, `area:PAR`, `country:FR`, `continent:EU`.
- Programs (`ffp`): `aadvantage aeromexico aeroplan alaska azul ba delta etihad finnair flyingblue flyingclub indigo jetblue lifemiles qantas qatar sas smilesar smilesbr turkish united virginaustralia`. Cabins: `economy premeco business first`.

## Account

- `GET /api/usage/status.json` → `{tier, authenticated, search:{pending, used, maxPending, limit, reset}, alerts:{triggered, liveUsed, liveLimit, flexUsed, flexLimit, reset}, seatMap:{used, limit, reset}}`
- `GET /api/locations.json?q=` → `[{shortLabel, value, title, subTitle, countryCode, continentCode, cityName, area?}]`
- `GET /api/airlines.json` → `{airlines:[{label, value, alliance?}]}`
- `GET /api/equipment.json` → `[{label, value}]`
- `GET /api/connection-airports.json` → `{airports:[...]}` (large)

## Search

1. `POST /api/search.json` `{origin[], destination[], dates[], ffp[], cabin?[]}` → `[{_id, date, origin, destination, createdAt, providers[], allProviders[]}]`. Empty array = nothing queued (results fresh). Each date × program is one live search; at most `maxPending` outstanding.
2. `POST /api/search-ages.json` `{origin[], destination[], ffp[], dates[]}` → `{ages:[{provider, origin, destination, localDateString, completedAt}], inProgress:[...]}`. Poll until `inProgress` is empty. `GET /api/searches.json` lists the user's pending searches.
3. `POST /api/fares.json` filter → `{fares:[Fare]}` (50 per page, `page` 0-based). Filter keys: `origin[]`, `destination[]`, `ffp[]`, `exactDates[]`, `cabin[]`, `carriers[]`, `pax`, `equipment[]`, `stops[]`, `layoverAirports[]`, `flight`, `exactFlight`, `times{localDepartEarliest, localDepartLatest, localArriveEarliest, localArriveLatest}`, `mixedCabins` (0..1), `minPrice`, `maxPrice`, `saver`, `excludeAirportChange`, `minDuration`, `maxDuration`, `layoverMinDuration`, `layoverMaxDuration`, `sort{value, order:"a"|"d"}`, `page`. Single fare: `{ids:[id], allowDeparted:true, allowUnavailable:true}`.
4. `POST /api/calendar.json` `{origin[], destination[], ffp[], cabin?[], flight:"", exactFlight:"", times:{}, localDateStart, localDateEnd}` → `{calendar:{date:{date, count, availability, ages[], inProgress[]}}, firstDate}`
5. `POST /api/refresh.json` same body as `search.json`; forces a re-search.
6. `POST /api/routes.json` `{origin[], destination[], exactDates[], ...filter}` → known routes (unused).

Fare: `_id, key, date, origin, destination, route, flight, flightNumber, numberOfStops, segments[], depart, arrive, localDepart, localArrive, flightTime, longestLayover, equipment, equipmentType, operatingCarrier, marketingCarrier, uniqueCarriers, availability{cabin:n}, fares{cabin:bool}, prices{cabin:miles}, taxes{cabin}, currency, saver, mixedCabins, hasAirportChange, sources{ffp:{updatedAt, bookingClasses, availability, prices, fares, ...}}, historicalAvailability[], originAirport, destinationAirport`.

## Alerts

- `GET /api/alerts.json` → `{alerts:[Alert]}`
- `GET /api/alerts/:id/fares.json` → `{alert, fares}`
- `POST /api/alerts.json` body: `{alertType:"live"|"flex", origin[], destination[], departureDates[], ffp[], cabin[]|null, carriers[]|null, numberOfStops[]|null, minAvailability, mixedCabins, minPrice, maxPrice, minDuration, maxDuration, flight|null, times?, saver?, excludeAirportChanges}` → Alert
- `PATCH /api/alerts/:id` same body → Alert
- `DELETE /api/alerts/:id`; `DELETE /api/alerts.json` deletes all (not exposed).
- `POST /api/find-alert.json` `{origin, destination, departureDates, ffp, excludeAirportChanges}` → Alert or `{}`
- `POST /api/calendar-alerts.json` `{origin, destination, departureDates[], ffp}` → `{date: bool}`

## Journeys

- `GET /api/journeys.json` → `{journeys:[{_id, label, customName, active, sharingUrl}]}`
- `GET /api/journey.json` → active journey `{..., fares:[Fare]}`
- `PUT /api/journey.json` `{id: journeyId}` → make active
- `DELETE /api/journey.json` `{id: fareId}` → remove fare from active journey
- `POST /api/journey/add.json` `{id: fareId}` → add fare to active journey
- `POST /api/journey/create.json` `{}` → new active journey
- `PATCH /api/journey/update-name.json` `{id, customName}`
- `DELETE /api/journey/delete/:id`
- `POST /api/journey/share.json` `{id}` → `{sharingUrl}`; `DELETE` same to unshare
- `GET /api/journey/shared/:token` → public journey

## Seat maps and schedules

- `GET /api/seatmap.json?from=&to=&date=&flight=&cabin=` (counts against the monthly seat-map quota)
- `GET /api/availability.json?from=&to=&date=` → scheduled flights with booking-class availability
- `GET /api/booking-link/instructions/:ffp` → booking help text
