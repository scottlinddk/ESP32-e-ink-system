# Layout grid and inverted colours

Both are layout settings, so each named layout and each scheduled page has its own. They are chosen above the grid in **Edit layout** and saved with the layout. Templates export and import them.

## Grid size

| Grid | Cell on 250 × 122 | Cell on 400 × 300 | Cell on 800 × 480 |
|---|---|---|---|
| 10 × 6 (default) | 25 × 20 px | 40 × 50 px | 80 × 80 px |
| 20 × 12 | 12.5 × 10 px | 20 × 25 px | 40 × 40 px |
| 40 × 24 | 6.25 × 5 px | 10 × 12 px | 20 × 20 px |

A finer grid lets a widget be smaller and be placed more precisely, which is what a larger or higher-resolution panel needs. The 250 × 122 panel can use 20 × 12, where a row is 10 px, just tall enough for one line of text, but 40 × 24 leaves rows of 5 px and is only useful on larger panels.

Changing the grid never moves or resizes a widget on screen:

- **Finer**: every position and size is multiplied (a full-width status bar one row tall becomes 20 × 2). It is then free to shrink to a single row.
- **Coarser**: only offered when every widget already sits on whole coarse cells. Otherwise the option is disabled, because rounding could overlap two widgets or change a size without asking. Shrink or move the widgets that do not fit first.

The layout stores `cols` and `rows`; only 10 × 6, 20 × 12 and 40 × 24 are accepted, and every widget must fit inside the layout's own grid and not overlap. Layouts saved before this keep their 10 × 6 grid unchanged. Row height is `floor(panel height / rows)`, as before.

```json
{ "version": 1, "cols": 20, "rows": 12, "widgets": [
  { "i": "energy", "x": 0, "y": 0, "w": 20, "h": 6 },
  { "i": "status", "x": 0, "y": 11, "w": 20, "h": 1, "options": { "view": "condensed" } } ] }
```

## A smaller status bar

The status bar takes a full row of the grid, 20 px on the default grid. To make it smaller:

1. Choose **20 × 12** (or finer) as the grid size. The bar keeps its look and becomes two rows tall.
2. Drag its bottom-right corner to make it one row, half the height.
3. Optionally select it and set **View** to **Compact: time only**. The bar then shows just the time (and the battery, if it fits), so it can also be made narrow and share a row with another widget.

A one-row bar on 20 × 12 is 10 px tall on the 250 × 122 panel, which fits one line of 8 px text and the line above it. Text size (zoom) still applies; a bar too small for the chosen size uses a smaller one, as described under [zoom](WIDGET_OPTIONS.md#zoom).

## Invert colours

**Invert colours** draws white text on a black background instead of black on white. It is applied to the finished image, so every widget, line, bar and unused area is inverted together, in the browser preview, the BMP, the Bluetooth payload and the pictures sent to a Wi-Fi device alike.

An uploaded **photo is not inverted**: it is already a picture, and a negative of it would be wrong. It keeps its own colours and stands in the black layout as a light or dark block. The setting is `"invert": true` beside `widgets`; false is the default and is not stored.

Inverting changes the picture sent to the panel only; it does not change the panel's own colour polarity.
