# Tekst TV

**Style: Tekst TV** is a layout setting that dresses a layout like a teletext page. It is chosen above the grid in **Edit layout**, next to the grid size and colours, and saved with the layout, so each named layout and each scheduled page has its own. Templates export and import it.

It is applied where the widgets are put together, so it works with every widget and every view, in the browser preview, the BMP, the Bluetooth payload and the pictures sent to a Wi-Fi device alike.

## What changes

- **Title bar.** Each widget gets a one-line bar across its top with its name on the left and a page number on the right, and draws in the room below it. A widget with no room for a bar and a line of its own content (about 20 px on the panel, the height of one row of the default grid) keeps all its space and gets no bar. The title is shortened to fit, and the page number goes first when a narrow bar cannot hold both.
- **Page numbers.** Widgets are numbered from 101 in reading order (top to bottom, then left to right). They are decoration: nothing can be reached at these numbers.
- **Page header.** The status bar becomes the page header, as `S100  ons 14 okt        23:03` (`P100  Wed 14 Oct` in English). The date and time follow the display time zone and the names follow the display language. A wider bar adds the name `TEKST TV` in front. The header shows the time of the render and does not show the refresh interval. The **Compact: time only** view keeps just the time. The battery, when there is a reading, sits to the right of the bar.
- **A photo is left alone.** An uploaded image has no bar, so nothing covers it.

Each widget keeps its own options, zoom and clipping. Title bars follow the widget's zoom, so on a larger panel the bars grow with the text.

## Colours

Teletext is colourful; the panel has two colours. The coloured bars become black bars with white text. For the closest look, also choose **Colours: Always inverted** (or sunset to sunrise): the bars turn white on a black page, like a teletext screen. The two settings are independent, and a photo keeps its own colours as usual.

## Not included

- Extra news feeds are titled **NEWS** or **NYHEDER**, not with the feed's own name.
- There is no Fastext footer, double-height text or block graphics. The 8×8 font and two colours have no room for the first, and the others would need each widget to be redrawn.

The setting is `"teletext": true` beside `widgets`; false is the default and is not stored.

```json
{ "version": 1, "cols": 10, "rows": 6, "teletext": true, "invert": true, "widgets": [
  { "i": "energy", "x": 0, "y": 0, "w": 10, "h": 2 },
  { "i": "status", "x": 0, "y": 5, "w": 10, "h": 1 } ] }
```
