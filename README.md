# ESP32 E-Ink Home Display

A quiet, glanceable home dashboard for Danish electricity prices, weather, news, EV charging and Notion lists. Choose the information and layout in a web app, then send a monochrome image to an ESP32 e-ink display over Bluetooth.

## How it works

1. Sign in and open **Integrations** to choose your data sources.
2. Follow each integration's setup guide, add its credentials if required, and save its source settings.
3. Open a device from **Devices**, create or select a named layout, and arrange its widgets in the layout editor. Use **Preview layout** to render the unsaved arrangement, then save. The Dashboard identifies the selected device.
4. Use **Push to Display** to select bundled firmware in Bluetooth setup mode or a compatible OpenDisplay device and transfer a fresh image. Transfers are manual; refreshing the browser preview does not update the physical display.

The [integration setup guide](docs/INTEGRATIONS.md) maps every source to its widget, including calendar subscriptions and Home Assistant sensor updates. Dashboard contains the preview, display settings, notes/images, templates and schedule; integration credentials and source controls are on **Integrations**.

The [device workspace guide](docs/DEVICE_WORKSPACES.md) explains per-device layouts, switching layouts and migration 018. Shared content and legacy defaults are labelled separately from the selected device's settings.

See the [integration and widget audit](docs/INTEGRATION_AUDIT.md) for supported behavior, provider compatibility fixes and validation limits.

Use **Layout templates** on the Dashboard to export settings, review a JSON import or apply a starter layout. Templates omit credentials and private feed URLs; see the [format and compatibility guide](docs/DISPLAY_TEMPLATES.md).

Use **Pages and schedule** to save named layouts, choose their order and duration, and configure local quiet hours. Server requests select the active page; browser Bluetooth still requires manual pushes. See the [schedule guide](docs/DISPLAY_SCHEDULES.md) for timing rules and the required migration.

Use **Display time zone** on the Dashboard to set the status clock and preview timestamp, or select **Use browser time zone**. The default is `Europe/Copenhagen`; daylight saving time follows the selected IANA zone. Calendar event times and scheduled quiet hours retain their separately labelled time zones. Apply `016_display_timezone.sql` before deploying this setting.

The JSON preview, BMP preview and Bluetooth payload share one live-data pipeline. Unavailable sources are shown as unavailable, without invented weather or headlines. Widget drawing is clipped to its assigned area so long content cannot overwrite neighboring widgets.

Weather has a **Test weather** action and specific setup/error messages. Save an OpenWeatherMap Current Weather key, enter coordinates with decimal points, and test before saving the display settings. See [weather setup and troubleshooting](docs/WEATHER.md).

The image renderer supports validated monochrome panel sizes and clockwise rotation, defaulting to **250 × 122**. Choose native dimensions on the Dashboard. The bundled firmware accepts row-padded 250 × 122 Bluetooth pushes in manual setup mode. The separate OpenDisplay path retains its byte-aligned width requirement. See [display profiles](docs/DISPLAY_PROFILES.md) and [Bluetooth setup](docs/BLUETOOTH_DELIVERY.md). A profile does not install a new board driver.

## Data sources

| Source | Data | Credentials |
|---|---|---|
| Energinet | DK1/DK2 spot prices or estimated consumer prices with tariffs and VAT | None |
| OpenWeatherMap | Temperature, conditions and wind | API key |
| NewsAPI | Headlines | API key |
| RSS / Atom | Headlines from a public HTTPS feed | None |
| Monta | Charger status, active sessions and energy of sessions created today | Client ID and secret |
| Zaptec | Charger status, active session and installation | Account credentials |
| Notion | Database items | `ntn_` or legacy `secret_` token and database ID/link; data source ID for a database with multiple sources |
| Calendar | Upcoming timed/all-day ICS events and recurring appointments | Private HTTPS ICS feed URL, encrypted at rest |
| Home Assistant / custom webhook | Timestamped sensor readings with freshness status | Dedicated integration token |

For RSS/Atom, select **RSS / Atom** under News headlines, enter a public HTTPS feed URL and save. NewsAPI remains the default for existing accounts, but does not supply Danish or Finnish coverage: choose RSS for those languages. NewsAPI's Developer plan is restricted to development/testing. The feed returns up to 1–10 headlines; the display draws as many as fit in the news widget. An empty feed shows “No headlines”; a failed feed shows a short diagnostic. Apply `010_rss.sql` to existing databases before using these settings.

Feed fetching accepts UTF-8 RSS 2.0 and Atom 1.0, including CDATA/HTML titles and relative links. Requests use public HTTPS on port 443, an 8-second total deadline, a 1 MiB response limit, and at most three redirects. DNS addresses are checked and pinned for each request. Local/private feeds, embedded credentials, compressed responses and XML document types are rejected. Feed URLs are ordinary preferences: use public feeds without secret tokens.

For calendars, apply `012_calendar.sql`, save the subscription URL in **Integrations → Calendar**, enable the source, and add **Calendar** in the layout editor. Select an IANA timezone (for example `Europe/Copenhagen`), a 1–30 day window and 1–10 events. Private URL paths/query tokens are encrypted using `ENCRYPTION_KEY`; credential endpoints return only configured status and the URL is excluded from preferences and key listings. Removing the URL stops calendar fetching.

The agenda uses `node-ical` for UTF-8 ICS 2.0: UTC/IANA TZID, known Outlook Windows timezone names and floating times, all-day dates with exclusive end dates, daily/weekly/monthly/yearly RRULEs, EXDATEs, moved instances and cancellations. Floating times use the selected timezone; ongoing events remain visible until they end. RDATE, EXRULE, RANGE overrides, unknown timezones and subdaily rules are rejected explicitly. The calendar uses the same public HTTPS/DNS/size/deadline restrictions as RSS, so local network calendars and compressed responses are unsupported. Parsing/recurrence expansion runs in a worker limited to two seconds, 64 MiB, 500 event components and 5,000 expanded instances. Empty calendars show “No upcoming events”; errors show “Calendar: unavailable”. Physical panel behavior still requires hardware validation.

Electricity uses Energinet's [DayAheadPrices dataset](https://www.energidataservice.dk/tso-electricity/DayAheadPrices) for the current **15-minute interval by UTC**. Under Energy prices, choose spot or an estimated consumer price, select your household grid tariff and enter your supplier's markup excluding VAT. Consumer estimates include current grid/national tariffs, electricity tax and VAT, but exclude fixed subscriptions. Existing accounts retain spot mode. Apply `017_energy_price_settings.sql` first; see [electricity setup, coverage and sources](docs/ELECTRICITY_PRICES.md). Zero/negative prices and Danish daylight-saving days are supported, independently of your display clock.

## Install Wi-Fi firmware on a CrowPanel

The public **Flash** page installs complete firmware over USB from desktop Chrome or Edge. Choose the original CrowPanel 2.13-inch **SSD1680** panel or **V1.2 / JD79661** revision before connecting; both use ESP32-S3, so automatic chip detection cannot distinguish them. A Waveshare 2.13-inch HAT V2 on classic ESP32 is also supported.

This firmware fetches saved layouts over Wi-Fi using a registered device UUID and token from **Devices → Automatic updates**. After installation, join its `ESP32-Display-XXXXXX` hotspot and enter the network and device settings. For a manual Bluetooth push, hold MENU while resetting (Waveshare: press BOOT within 3 seconds after releasing reset), keep your computer on its normal internet connection, and select `EInk-XXXXXX` from the dashboard's Bluetooth picker. First-boot setup also enables Bluetooth.

See the [browser flashing and recovery guide](docs/FIRMWARE_FLASHING.md) and [firmware build instructions](firmware/README.md). Local factory artifacts can be tested from `/flash` before publishing by setting backend `FIRMWARE_RELEASE_DIR` to their absolute output directory.

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
| `firmware/` | Device-feed Wi-Fi firmware, board drivers and web-flash packaging |
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

The dashboard supports OpenDisplay Bluetooth and [unattended device delivery](docs/DEVICE_DELIVERY.md) with per-device credentials, ETag/304, scheduled quiet periods and reported telemetry. The bundled Wi-Fi firmware implements this protocol for the supported 250 × 122 boards. The separate polling bridge can run an explicitly configured display driver; file-only mode never reports physical application. Firmware compilation, protocol tests and factory packaging pass; USB installation and panel refresh still require verification on the actual unit. See [the improvement notes](docs/PROJECT_DIRECTION.md) for remaining work and validation limits.

Older [setup](docs/SETUP_TRACK_A.md) and [API](docs/API_REFERENCE.md) guides retain some legacy instructions; use the architecture and endpoint status above when they differ. The [flashing guide](docs/FIRMWARE_FLASHING.md) describes the current factory-image and device-token setup.
