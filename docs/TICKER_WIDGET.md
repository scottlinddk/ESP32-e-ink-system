# Stock ticker widget (package layer)

`packages/widgets/src/widgets/ticker/` adds a `ticker` widget with two views.
This first step covers the widget package only. The backend search route, saved
per-user widgets and the dashboard form are not wired up yet, and nothing in the
backend currently consumes `packages/widgets` output, so the widget does not
appear on a display until that integration lands.

## Views

| View | Shows |
|---|---|
| `full` | One stock: symbol, price, direction arrow with absolute and percent change, intraday sparkline with a dotted previous-close line, market status and time. |
| `condensed` | A list: header with market status, per row symbol and price, then arrow, change and percent. Footer with the time and page (`Side 1/2`). |

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

## Cycling

The page is `floor(now / dwell) % pages`, derived from the clock, so rendering
stays stateless. A new page only becomes visible when a new frame is delivered
(device poll or manual Bluetooth push). Only the symbols on the current page are
fetched.

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
and the trading-period fields used for the market status.
