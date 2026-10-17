# Widget display options

Select a widget in **Edit layout** (tap or click it, or focus it and press Enter) to open its options under the grid. Options belong to that placement, so the base layout and each scheduled page can show the same source differently. They change how a widget is drawn, never what is fetched. Save the layout to keep them.

| Widget | Option | Values |
|---|---|---|
| `energy` | `view` | `summary` (default), `day`, `rest`. See [Electricity prices](ELECTRICITY_PRICES.md#chart-views). |
| `weather`, `weather:2` to `weather:4` | `view`, `items` | `view` is `summary` (default), `current`, `hours`, `daily` or `details`. `items` (1–10) is the most steps (`hours`) or days (`daily`) drawn. See [Weather views](WEATHER.md#views). |
| `news`, `news:<id>` | `items`, `columns`, `weight` | `items` (1–10) is the most rows drawn, also limited by how many items the source fetches and by the widget's height. `columns` (1–4, default 1) splits the headlines evenly side by side; a widget too narrow for that many (each column needs about 64 px) shows fewer. `weight` is `bold` (default, the original look), `regular` or `light`. The display font has one weight with 1 px strokes. Bold is it drawn twice, one pixel apart; a heavier smear runs the letters together. Light cannot thin a stroke, so it draws every other glyph pixel (a checkerboard): paler but dotted and harder to read, so check it in the preview. |
| `calendar`, `calendar:<id>` | `view`, `items`, `days` | `view` is `list` (default), `day`, `days` or `month`. `items` (1–10) is the most events the list draws; `days` (2–7) is how many columns the `days` view shows, unset fitting as many as the width allows. A widget too small for its view shows the list. See [Calendar widgets](CALENDAR.md). |
| `ticker:<id>` | `view`, `items` | `full` or `condensed`, and stocks per page for `condensed`. Overrides the ticker's own settings. See [Stock ticker widgets](TICKER_WIDGET.md). |
| `family-meals` | `view` | `full` (default, the week's dinners with today highlighted) or `condensed` (tonight's dinner alone, in large type when there is room). A widget too short for the whole week drops the header, then the days already passed. See [Family Meals](FAMILY_MEALS.md). |
| `ai-usage` | `view` | `full` (default, quota windows plus token breakdown) or `condensed` (quota windows only). A widget too short for the chosen view drops detail, down to one line per provider. See [AI usage](AI_USAGE.md). |
| `status` | `view` | `full` (default, refresh interval and time) or `condensed` (the time alone, so the bar can be narrow). See [A smaller status bar](LAYOUT_GRID.md#a-smaller-status-bar). |
| every widget except `custom-image` | `zoom` | 1–4 in steps of 0.2 (a slider in the editor). Enlarges the widget's text and graphics. See [Zoom](#zoom). |

Options are stored on the layout widget:

```json
{ "i": "energy", "x": 0, "y": 0, "w": 10, "h": 3, "options": { "view": "rest" } }
```

The backend validates them with the layout (`backend/src/utils/widgetOptions.ts`, mirrored in `frontend/src/lib/widgetOptions.ts`). Unknown fields, values outside the ranges above and options on widgets without any are rejected; an empty `options` object is dropped. Layouts without options render exactly as before. Templates export and import options as part of the layout.

## Zoom

The widgets are drawn with an 8 × 8 pixel font, which reads well on the 250 × 122 panel but looks small on a 400 × 300 one. Zoom enlarges everything a widget draws (text, lines, bars, cells) by a whole factor from 1 to 4. A widget is laid out on a canvas that many times smaller and each pixel becomes a block, so it shows fewer or shorter lines rather than clipped ones.

Zoom is chosen at three levels, the most specific first:

1. **Widget**: `options.zoom` on a layout widget (the **Text size** slider under the grid). Any multiple of 0.2 from 1 to 4. Unset follows the layout.
2. **Layout**: `zoom` beside `widgets` (the **Layout text size** field above the grid). A whole factor from 1 to 4. Unset means automatic.
3. **Automatic**: the largest whole factor that still leaves a logical canvas of about 200 × 100, judged on the panel's size after rotation, capped at 4. 250 × 122 stays 1×, 400 × 300 gives 2× and 800 × 480 gives 4×.

```json
{ "version": 1, "cols": 10, "rows": 6, "zoom": 2, "widgets": [
  { "i": "energy", "x": 0, "y": 0, "w": 10, "h": 3, "options": { "view": "day", "zoom": 1 } },
  { "i": "status", "x": 0, "y": 5, "w": 10, "h": 1, "static": true } ] }
```

A fine zoom such as 1.4× has no matching bitmap font, so the 8 × 8 glyphs are resampled: each glyph pixel becomes a block whose edges are rounded to the nearest panel pixel. Strokes and gaps are therefore 1 or 2 px wide, and letter spacing varies by a pixel. Whole values (1×, 2×, 3×, 4×) are the sharpest; try the in-between ones on your panel and in the live preview before relying on them. The layout's own zoom stays whole.

Choose **1×** for a layout to keep the pre-zoom look on a larger panel. A zoom too large for a widget (less than one text line, or about four characters, would remain) is lowered until it fits, so a one-row widget never shows half a line. `custom-image` is never zoomed: it is placed by pixel and already scales to its area. The layout editor labels the automatic choice from the saved display profile; a device that declares its own panel size follows that size on the server.
