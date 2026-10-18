# Device slideshows and quiet hours

Open a device from **Devices**, then use **Saved layouts** on its dashboard to create and edit named layouts. The selected device has its own layouts, slideshow, display time zone and quiet hours. Editing a layout previews that layout even when the slideshow is currently showing another one. Saving the editor updates that layout and keeps the other layouts intact.

In **Display mode and slideshow**, choose **Slideshow** to rotate through **all named layouts in their saved order**. Set each layout's duration to 60–86400 seconds (one minute to 24 hours), reorder the layouts as needed, then choose **Save display mode**. There can be at most 12 layouts; slideshow mode requires at least one. The schedule applies to JSON, BMP, raw-pixel and compatible unattended-device requests. Switching back to **Single layout** shows the previously selected layout; it preserves the selected layout (`active_layout_id`), saved layouts, order and durations for later use. A disabled slideshow may have no named layouts and use the base layout.

Apply migrations `013_display_schedule.sql` and `018_device_displays.sql` before using per-device slideshows, along with any other missing migrations in filename order. Existing installations should apply only migrations they have not already run.

Page rotation repeats in the configured order using elapsed UTC time anchored at the Unix epoch. It is deterministic across server restarts and does not restart at local midnight or when settings are saved. Saving a new order or durations changes the server's selection for the next request; it does not wake the device. Source enable flags and credentials remain shared across layouts and devices.

Quiet hours use the configured IANA time zone (for example `Europe/Copenhagen`). Start is inclusive and end is exclusive; overnight windows are supported. The server keeps the page selected at the beginning of the quiet window and returns a delay until quiet hours end. Rotation then resumes on the UTC cycle. Daylight-saving transitions use actual UTC instants: overnight quiet windows become shorter or longer when clocks change. Skipped local minutes are evaluated at the next real clock minute; repeated minutes follow the local clock rule on each occurrence.

## Timed layouts

Open the device's **Timed layouts** tab to show a saved layout at a set time of day, for a set length of time. Each rule has a layout, a start time and a duration, for example "Morning" at 07:00 for 30 minutes, or "Alert" at 18:00:00 for 45 seconds. The rule repeats every day.

- **Start** is a 24-hour `HH:MM` time in the schedule time zone, the one under **Time zone for quiet hours and timed layouts** in the slideshow settings (default `Europe/Copenhagen`). It follows daylight saving: 07:00 stays 07:00 on the wall clock all year. A start time that does not exist on the day clocks go forward (for example 02:30) runs at the same offset after the gap, and one that happens twice on the day clocks go back runs at its first occurrence.
- **Duration** is entered in seconds, minutes or hours and stored as whole seconds, from 10 seconds to 23 hours 59 minutes. A window may run past midnight. Unlike slideshow durations (60 seconds and up), timed durations can be short, because a timed layout is a deliberate glance and not a rotation step.
- **Works in both modes.** In single-layout mode the timed layout replaces the saved layout while its window is open, then the saved layout returns. In slideshow mode it pauses the rotation; afterwards the rotation continues from wherever its UTC-anchored cycle is, as if the rule had never interrupted it.
- **Overlaps.** If windows overlap, the one that started last is shown, then the earlier one again when it ends. A rule listed first wins an exact tie.
- **Quiet hours win.** Quiet hours only apply to the slideshow. While they are active a window that opens does not wake the display. If a window is still open when quiet hours end, it is shown from then until its own end. In single-layout mode quiet hours do not apply, so timed layouts run.
- **Limits.** Up to 24 rules per device. A rule must show a saved layout of the same device. Removing that layout removes its rules, and accepting a shared dashboard (which replaces every layout) clears the recipient's rules. Rules are included in exported templates.

The server picks the layout when the device asks. For the device to show a window it must be awake during it. A device that obeys the returned refresh delay (`Retry-After`, `nextRefresh`) wakes at each start and end, because those instants are folded into `nextTransitionAt`. A device that polls on a longer fixed interval can miss a short window, a sleeping device cannot be woken from here, and each change of layout is a full e-ink refresh, so very short windows wear the panel and the battery. Browser Bluetooth remains a manual push.

Timed layouts are stored inside the existing `display_schedule` column as an optional `timed_layouts` list, so no migration is needed:

```json
{"timed_layouts":[{"id":"wake","layout_id":"morning","start":"07:00","duration_seconds":1800}]}
```

While a rule is open the JSON preview reports `"timed": true` in `schedule`, and the preview headers use `X-Preview-Mode: timed`.

The JSON preview adds:

```json
{"schedule":{"pageId":"home","pageName":"Home","quiet":false,"nextTransitionAt":"2026-09-28T14:15:00.000Z"},"nextRefresh":60000}
```

`nextRefresh` is in milliseconds. While awake, it is the lesser of the source refresh interval and the next page/quiet-hour transition. During quiet hours it is the time until the window ends. `nextTransitionAt` is an absolute UTC instant; clients should account for request latency when setting their next wake time. The renderer uses the same page chosen when the request began, even if fetching a source crosses a transition.

The schedule selects content on the server; it does not create background Bluetooth connections or wake a sleeping device. A device sees saved changes when it next polls. It can remain asleep until its previously scheduled refresh or the end of quiet hours, and can skip layouts if it polls less often than they change. Browser Bluetooth remains manual, and an explicit preview/push can still fetch fresh source data during quiet hours. Unattended clients must obey the returned delay to pause their scheduled physical refreshes. Physical battery life and refresh behavior need verification with the specific device.

For integrations, use `buildDisplayData` to obtain source data, schedule metadata and the refresh delay, then `layoutForDisplayData(preferences, data)` when calling the BMP/raw renderer. `resolveDisplaySchedule(preferences, now)` provides deterministic selection without fetching source data. Explicit draft previews render their supplied layout independently of the active schedule.
