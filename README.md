# awardfares-mcp

Personal [MCP](https://modelcontextprotocol.io) server for [AwardFares](https://awardfares.com): award search, availability calendar, alerts, journeys, seat maps and flight schedules, driven from Claude Code.

AwardFares has no public API. This server drives a real Chromium (Playwright) with a persistent profile, logs in with your account, and calls the site's internal JSON API from inside the page. That keeps Cloudflare happy and the session cookie fresh. One user, one account, local only.

## Setup

```sh
# Node 20+ required
npm install
npx playwright install chromium
npm run build
```

Register with Claude Code (user scope, credentials stay in `~/.claude.json`):

```sh
claude mcp add awardfares -s user \
  -e AWARDFARES_EMAIL='you@example.com' \
  -e AWARDFARES_PASSWORD='...' \
  -- node /home/bore/Projects/awardfares-mcp/dist/index.js
```

Restart Claude Code and run `/mcp` to confirm it connected. The first call launches the browser and logs in (about 5 s).

### Environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `AWARDFARES_EMAIL` / `AWARDFARES_PASSWORD` | | Login credentials. Without them the server only works if the profile already holds a session. |
| `AWARDFARES_PROFILE_DIR` | `~/.local/share/awardfares-mcp/profile` | Chromium profile and saved cookies. Delete it to start clean. |
| `AWARDFARES_HEADED` | `0` | `1` always shows the browser window. |
| `AWARDFARES_BROWSER_PATH` | Playwright's Chromium | Use a system Chromium instead (for example `/usr/bin/chromium`). |
| `AWARDFARES_DEFAULT_FFP` | `sas` | Comma-separated program codes used when a tool call omits `ffp`. |
| `AWARDFARES_USER_AGENT` | a desktop Chrome UA | Pin a different user agent. Changing it invalidates Cloudflare clearance. |
| `AWARDFARES_DEBUG` | `0` | `1` logs every navigation and API call to stderr. |

If Cloudflare ever serves a challenge the headless browser cannot clear, the server relaunches with a visible window so you can solve it. `awardfares_login` with `headed: true` does the same on demand.

## Tools

| Tool | What it does | Quota |
| --- | --- | --- |
| `awardfares_search` | Award availability for a route and dates. `live: true` (default) triggers fresh airline searches and waits for them. `live: false` returns cached results only. | live searches |
| `awardfares_calendar` | Per-day seat counts over a date range from cached data. | none |
| `awardfares_flight` | Full detail for one fare id (segments, booking classes, history). | none |
| `awardfares_refresh` | Re-search one route and date. | live searches |
| `awardfares_alerts_list` / `_get` / `_create` / `_update` / `_delete` | Live and flex availability alerts. | alerts |
| `awardfares_journeys_list` / `_get` / `_create` / `_add_fare` / `_remove_fare` / `_rename` / `_share` / `_delete` | Saved itineraries. | none |
| `awardfares_seatmap` | Live seat map for one segment. | seat maps (limited per month) |
| `awardfares_schedule` | Flight schedule with revenue booking-class availability. | none |
| `awardfares_status` | Tier, login state and remaining quotas. | none |
| `awardfares_locations` / `_programs` / `_airlines` | Lookups for location values, program codes and carrier codes. | none |
| `awardfares_login` | Force a fresh login, optionally headed. | none |

Locations accept IATA codes (`CDG`) or prefixed values (`airport:CDG`, `area:PAR`, `country:FR`, `continent:EU`). Live searches need airports or areas. Program codes are listed by `awardfares_programs`.

## Development

```sh
npm run smoke            # read-only checks against the live site
npx tsx scripts/roundtrip.ts   # creates and deletes an alert, adds/removes a journey fare, one seat map lookup
```

`docs/API.md` documents the internal endpoints this server uses. They were recovered from the site's JavaScript bundles and a HAR capture, so expect them to change without notice.
