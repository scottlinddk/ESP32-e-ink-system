# Stock ticker widgets

Share prices from Yahoo Finance, including Danish stocks on Nasdaq Copenhagen,
as one or more widgets on the display.

## Set up

1. Apply `backend/src/db/migrations/023_ticker_widgets.sql` (see
   [the Raspberry Pi upgrade note](RASPBERRY_PI_DATABASE_MIGRATION.md#upgrade-an-existing-database-for-stock-ticker-widgets-023)
   for that database), then deploy the backend.
2. Open **Dashboard**, under **Stock tickers** choose **Add stock widget**.
3. Search by company name or symbol. **Danish stocks only** is on by default and
   limits the search to Nasdaq Copenhagen. A symbol can also be typed directly
   and added with Enter, which still works if search is unavailable.
4. Choose the view, save, then place the widget in **Edit layout**. Each ticker
   is its own layout widget (`ticker:<id>`), so several can share one screen.

At most 6 ticker widgets, each with 1 to 10 stocks. A ticker widget needs at
least 3 grid rows of height to show a header and footer; smaller areas show rows only.

## Views

| View | Shows |
|---|---|
| `full` | One stock: symbol, price, direction arrow with absolute and percent change, intraday sparkline with a dotted previous-close line, market status and time. |
| `condensed` | A list: header with market status, per row symbol and price, then arrow, change and percent. Footer with the time and page (`Side 1/2`). |

A placement can override the view and the stocks per page for one layout or scheduled page: select the widget in **Edit layout**. This is stored on the layout widget as `options: {"view":"condensed","items":3}`; without it the ticker's own settings apply.

## Configuration

| Field | Default | Notes |
|---|---|---|
| `symbols` | required | 1 to 10 Yahoo symbols. Danish stocks use `.CO`, e.g. `NOVO-B.CO`, `DSV.CO`. Upper-cased and de-duplicated. |
| `view` | `full` | `full` or `condensed`. |
| `perPage` | auto | Condensed only. Clamped to what the region can draw. |
| `dwellMinutes` | 15 | Page stays for this long. Prefer 5 or more to limit e-ink refreshes. |
| `title` | `Stock ticker` | Condensed header. |
| `locale` | `da` | `da`: `1.234,50 kr`, `-0,80 %`. `en`: `$1,234.50`, `-0.80%`. |
| `timeZone` | `Europe/Copenhagen` | IANA zone for the clock. |

## Where the code lives

| Layer | Path |
|---|---|
| Widget package, the tested specification | `packages/widgets/src/widgets/ticker/` |
| Backend copy used for rendering | `backend/src/ticker/` |
| Settings validation, `ticker:<id>` widget IDs | `backend/src/utils/tickerWidgets.ts` |
| Symbol search | `GET /api/tickers/search?q=&region=any\|dk` (`backend/src/routes/tickers.ts`) |
| Dashboard form | `frontend/src/components/dashboard/TickerWidgetsFields.tsx` |

`backend/` is deployed on its own (Vercel root and the Docker image are `backend/`),
so it cannot import the workspace package and carries a copy of the pure ticker
code. Behavioural changes must be made in both places; both have tests.

Ticker widgets have no on/off switch. Every configured widget is loaded for each
display refresh (a symbol shared by several widgets is requested once, and quotes
are cached for 60 seconds), and only drawn when a layout places it.

## Cycling

The page is `floor(now / dwell) % pages`, derived from the clock, so rendering
stays stateless. A new page only becomes visible when a new frame is delivered
(device poll or manual Bluetooth push). In the backend all symbols of a widget are
loaded and the page is chosen when drawing, because only then is the widget's size
(and so the number of rows) known.

## Direction without colour

The panel is black and white and the display font has no triangle glyph (an
unsupported character is drawn as `?`), so arrows are drawn as filled shapes:
triangle up, triangle down, bar for flat. The sign is always printed as well.
A move that rounds to 0.00 % is treated as flat.

## Data source and limits

Yahoo Finance has no official public API. The adapter uses the endpoints its
website uses (`/v8/finance/chart`, `/v1/finance/search`). They can change or be
rate limited without notice, and Yahoo's terms may restrict this use. Mitigations:
a `QuoteProvider` interface so the source can be swapped, a 60 second quote
cache and 10 minute search cache, an 8 second deadline, a 512 KiB response cap,
and fixed error messages that never include provider or network text.

These endpoints were **not exercised against the live service** when this was
written (the development sandbox blocks the host). Verify with a real request
before relying on them, in particular `previousClose` versus `chartPreviousClose`
and the trading-period fields used for the market status. If a quote cannot be
loaded the widget shows `n/a` for that symbol, or "Stocks: unavailable" when every
symbol fails, and never an invented price.
