# ESP32 E-Ink Home Display

A quiet, glanceable home dashboard for Danish electricity prices, weather, news, EV charging and Notion lists. Choose the information and layout in a web app, then send a monochrome image to an ESP32 e-ink display over Bluetooth.

## How it works

1. Sign in and choose your data sources on the Dashboard.
2. Add the API credentials required by your chosen sources.
3. Arrange widgets in the layout editor and use **Preview layout** to render the unsaved arrangement with your saved data sources. Save when ready; the Dashboard shows the saved display image.
4. Use **Push to Display** to select a compatible OpenDisplay device and transfer a fresh image. Transfers are manual; refreshing the browser preview does not update the physical display.

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

For RSS/Atom, select **RSS / Atom** under News headlines, enter a public HTTPS feed URL and save. NewsAPI remains the default for existing accounts. The feed returns up to 1–10 headlines; the display draws as many as fit in the news widget. An empty feed shows “No headlines”; a failed feed shows “News: unavailable”. Apply `010_rss.sql` to existing databases before using these settings.

Feed fetching accepts UTF-8 RSS 2.0 and Atom 1.0, including CDATA/HTML titles and relative links. Requests use public HTTPS on port 443, an 8-second total deadline, a 1 MiB response limit, and at most three redirects. DNS addresses are checked and pinned for each request. Local/private feeds, embedded credentials, compressed responses and XML document types are rejected. Feed URLs are ordinary preferences: use public feeds without secret tokens.

Electricity uses Energinet's [DayAheadPrices dataset](https://www.energidataservice.dk/tso-electricity/DayAheadPrices). It selects the current **15-minute interval by UTC**, compares it with the average of available intervals for the Danish calendar day, and expires cached prices at the next interval boundary. Zero and negative prices are supported. Values are **spot prices, excluding VAT, taxes and grid/supplier tariffs**, not the final household electricity cost. The former Elspotprices feed contains historical hourly data only.

## Development

Requires Node.js 20+ and npm, a Supabase project and a Clerk application. Browser Bluetooth requires a supported browser and a secure context (HTTPS or localhost).

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

## Structure

| Directory | Purpose |
|---|---|
| `frontend/` | React 19, Vite, TanStack Query, Clerk, dashboard and browser Bluetooth |
| `backend/` | Express API, Supabase persistence, source integrations, BMP/raw rendering |
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
| GET | `/api/preview` | Live display data as JSON |
| GET | `/api/image/preview` | Actual saved-layout BMP preview |
| POST | `/api/image/preview/draft` | Live BMP of a validated unsaved layout; body `{ "layout": ... }` |
| GET | `/api/image/preview/raw` | Raw pixels for Bluetooth transfer |

All listed endpoints except health require a Clerk bearer token.

The active dashboard flow uses OpenDisplay and Bluetooth. The bundled custom Wi-Fi firmware still calls legacy license-key pairing, image/data and status endpoints that the current backend no longer exposes. It is not an end-to-end alternative to the Bluetooth flow yet. See [the improvement notes](docs/PROJECT_DIRECTION.md) for remaining work and validation limits.

Older [setup](docs/SETUP_TRACK_A.md), [API](docs/API_REFERENCE.md) and [flashing](docs/FIRMWARE_FLASHING.md) guides retain some legacy instructions; use the architecture and endpoint status above when they differ.
