# Widget display options

Select a widget in **Edit layout** (tap or click it, or focus it and press Enter) to open its options under the grid. Options belong to that placement, so the base layout and each scheduled page can show the same source differently. They change how a widget is drawn, never what is fetched. Save the layout to keep them.

| Widget | Option | Values |
|---|---|---|
| `energy` | `view` | `summary` (default), `day`, `rest`. See [Electricity prices](ELECTRICITY_PRICES.md#chart-views). |
| `news`, `news:<id>`, `calendar` | `items` | 1–10 rows at most. Also limited by how many items the source fetches and by the widget's height. |
| `ticker:<id>` | `view`, `items` | `full` or `condensed`, and stocks per page for `condensed`. Overrides the ticker's own settings. See [Stock ticker widgets](TICKER_WIDGET.md). |

Options are stored on the layout widget:

```json
{ "i": "energy", "x": 0, "y": 0, "w": 10, "h": 3, "options": { "view": "rest" } }
```

The backend validates them with the layout (`backend/src/utils/widgetOptions.ts`, mirrored in `frontend/src/lib/widgetOptions.ts`). Unknown fields, values outside the ranges above and options on widgets without any are rejected; an empty `options` object is dropped. Layouts without options render exactly as before. Templates export and import options as part of the layout.
