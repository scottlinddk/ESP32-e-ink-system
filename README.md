# ESP32 E-Ink Home Display

A quiet, glanceable home dashboard for Danish electricity prices, weather, news, EV charging and Notion lists. Choose the information and layout in a web app, then send a monochrome image to an ESP32 e-ink display over Bluetooth.

## How it works

1. Sign in and choose your data sources on the Dashboard.
2. Add the API credentials required by your chosen sources.
3. Arrange widgets in the layout editor and use **Preview layout** to render the unsaved arrangement with your saved data sources. Save when ready; the Dashboard shows the saved display image.
4. Use **Push to Display** to select a compatible OpenDisplay device and transfer a fresh image. Transfers are manual; refreshing the browser preview does not update the physical display.

Use **Layout templates** on the Dashboard to export settings, review a JSON import or apply a starter layout. Templates omit credentials and private feed URLs; see the [format and compatibility guide](docs/DISPLAY_TEMPLATES.md).

Use **Pages and schedule** to save named layouts, choose their order and duration, and configure local quiet hours. Server requests select the active page; browser Bluetooth still requires manual pushes. See the [schedule guide](docs/DISPLAY_SCHEDULES.md) for timing rules and the required migration.

The JSON preview, BMP preview and Bluetooth payload share one live-data pipeline. Unavailable sources are shown as unavailable, without invented weather or headlines. Widget drawing is clipped to its assigned area so long content cannot overwrite neighboring widgets.

The image renderer supports validated monochrome panel sizes and clockwise rotation, defaulting to **250 × 122**. Choose native dimensions on the Dashboard. Bluetooth verifies the connected panel; current OpenDisplay direct-write firmware requires a byte-aligned width, so 250-pixel output is available as a BMP download rather than sent through that unsafe path. See [display profiles](docs/DISPLAY_PROFILES.md) and [the researched feature comparison](docs/PROJECT_COMPARISON_2026-09-28.md). A profile does not install a new board driver.

## Data sources

| Source | Data | Credentials |
|---|---|---|
| Energinet | DK1/DK2 day-ahead spot electricity prices | None |
| OpenWeatherMap | Temperature, conditions and wind | API key |
| NewsAPI | Headlines | API key |
| RSS / Atom | Headlines from a public HTTPS feed | None |
| Monta | Charger status, active sessions and daily energy | Client ID and secret |
| Zaptec | Charger status, active session and installation | Account credentials |
| Notion | Database items | Integration token and database ID |
| Calendar | Upcoming timed/all-day ICS events and recurring appointments | Private HTTPS ICS feed URL, encrypted at rest |

For RSS/Atom, select **RSS / Atom** under News headlines, enter a public HTTPS feed URL and save. NewsAPI remains the default for existing accounts. The feed returns up to 1–10 headlines; the display draws as many as fit in the news widget. An empty feed shows “No headlines”; a failed feed shows “News: unavailable”. Apply `010_rss.sql` to existing databases before using these settings.

Feed fetching accepts UTF-8 RSS 2.0 and Atom 1.0, including CDATA/HTML titles and relative links. Requests use public HTTPS on port 443, an 8-second total deadline, a 1 MiB response limit, and at most three redirects. DNS addresses are checked and pinned for each request. Local/private feeds, embedded credentials, compressed responses and XML document types are rejected. Feed URLs are ordinary preferences: use public feeds without secret tokens.

For calendars, apply `012_calendar.sql`, save the subscription URL in the dashboard's **Calendar** card, enable the source, and add **Calendar** in the layout editor. Select an IANA timezone (for example `Europe/Copenhagen`), a 1–30 day window and 1–10 events. Private URL paths/query tokens are encrypted using `ENCRYPTION_KEY`; credential endpoints return only configured status and the URL is excluded from preferences and key listings. Removing the URL stops calendar fetching.

The agenda uses `node-ical` for UTF-8 ICS 2.0: UTC/IANA TZID and floating times, all-day dates with exclusive end dates, daily/weekly/monthly/yearly RRULEs, EXDATEs, moved instances and cancellations. Floating times use the selected timezone; ongoing events remain visible until they end. RDATE, EXRULE, RANGE overrides, unknown timezones and subdaily rules are rejected explicitly. The calendar uses the same public HTTPS/DNS/size/deadline restrictions as RSS, so local network calendars and compressed responses are unsupported. Parsing/recurrence expansion runs in a worker limited to two seconds, 64 MiB, 500 event components and 5,000 expanded instances. Empty calendars show “No upcoming events”; errors show “Calendar: unavailable”. Physical panel behavior still requires hardware validation.

Electricity uses Energinet's [DayAheadPrices dataset](https://www.energidataservice.dk/tso-electricity/DayAheadPrices). It selects the current **15-minute interval by UTC**, compares it with the average of available intervals for the Danish calendar day, and expires cached prices at the next interval boundary. Zero and negative prices are supported. Values are **spot prices, excluding VAT, taxes and grid/supplier tariffs**, not the final household electricity cost. The former Elspotprices feed contains historical hourly data only.

## Development

Requires Node.js 20+ and npm, a Supabase project or the Raspberry Pi database below, and a Clerk application. Browser Bluetooth requires a supported browser and a secure context (HTTPS or localhost).

Install from the repository root; this is an npm workspace:

```sh
npm ci
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env
```

On PowerShell, use `Copy-Item` in place of `cp` if preferred. Fill in Clerk and Supabase settings, plus a 64-character hexadecimal `ENCRYPTION_KEY`. Leave `VITE_API_BASE_URL` empty for local development: Vite proxies `/api/*` to the backend and removes the prefix.

For a new database, apply all SQL files in `backend/src/db/migrations/` in filename order, including both `002_*.sql` files. Existing installations should apply only missing migrations; these files are not all safe to rerun.

```sh
npm run dev         # frontend http://localhost:5173; backend http://localhost:3001
npm run typecheck   # all workspace TypeScript projects
npm test           # backend, frontend Bluetooth, widgets and rendering tests
npm run build      # frontend and backend production builds
```

Tests use mocked external services and do not require account credentials or hardware. The application-check workflow runs type checks, tests and builds for pull requests.

## Raspberry Pi database

To move database storage to a Raspberry Pi already running Investor, use the
[migration plan and runbook](docs/RASPBERRY_PI_DATABASE_MIGRATION.md). The
[deployment and migration tools](infra/raspberry-pi/) keep the web app and Clerk
in place and provide an isolated PostgreSQL/PostgREST service on the Pi.
This includes schema initialization, verified data transfer, a maintenance switch,
backups and recovery. Investor keeps its own database, storage paths and Tailscale
access. Live deployment requires the Pi's storage inventory and an HTTPS route
from the hosted backend; creating this package does not switch production.

The hosted Supabase project no longer exists, so the Pi database starts empty. Use
the runbook's [fresh-start path](docs/RASPBERRY_PI_DATABASE_MIGRATION.md#fresh-start-no-source-database).
Existing preferences, saved provider keys and devices are not recoverable, and each
display must be registered again. The export/import tools apply only when a live
source database exists.

## Structure

| Directory | Purpose |
|---|---|
| `frontend/` | React 19, Vite, TanStack Query, Clerk, dashboard and browser Bluetooth |
| `backend/` | Express API, Supabase-compatible database persistence, source integrations, BMP/raw rendering |
| `packages/widgets/` | Reusable widget definitions and provider adapters |
| `packages/rendering/` | Layout and typography utilities |
| `packages/types/` | Shared widget contracts |
| `firmware/` | Legacy custom Wi-Fi firmware and board tooling |
| `docs/` | Setup, API and hardware reference material |

## API and hardware status

Browser-facing paths below include `/api`; direct requests to the local Express server omit that prefix.

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/health` | Public health check |
| POST | `/api/auth/login` | Synchronize authenticated user |
| GET / POST | `/api/preferences` | Read/save source preferences and layout |
| GET / POST / DELETE | `/api/preferences/calendar-credentials` | Calendar configured status, encrypted URL storage, removal |
| GET | `/api/preview` | Live display data as JSON |
| GET | `/api/image/preview` | Actual saved-layout BMP preview |
| POST | `/api/image/preview/draft` | Live BMP of a validated unsaved layout; body `{ "layout": ... }` |
| GET | `/api/image/preview/raw` | Raw pixels for Bluetooth transfer |
| GET / POST / DELETE | `/api/devices/:id/delivery` and `/delivery/token` | Owner-managed device credentials and reported status |
| GET / POST | `/api/device-feed/:id/frame` and `/heartbeat` | Device-token frame delivery and telemetry |

Browser endpoints require a Clerk bearer token; device-feed endpoints require the separately issued device token. Health is public.

The dashboard supports OpenDisplay Bluetooth and an [unattended polling bridge](docs/DEVICE_DELIVERY.md) with per-device credentials, ETag/304, scheduled quiet periods and reported telemetry. The bridge can run an explicitly configured display driver; file-only mode never reports physical application. The bundled custom Wi-Fi firmware still calls legacy endpoints and does not implement this new protocol. See [the improvement notes](docs/PROJECT_DIRECTION.md) for remaining work and validation limits.

Older [setup](docs/SETUP_TRACK_A.md), [API](docs/API_REFERENCE.md) and [flashing](docs/FIRMWARE_FLASHING.md) guides retain some legacy instructions; use the architecture and endpoint status above when they differ.
