# Device slideshows and quiet hours

Open a device from **Devices**, then use **Saved layouts** on its dashboard to create and edit named layouts. The selected device has its own layouts, slideshow, display time zone and quiet hours. Editing a layout previews that layout even when the slideshow is currently showing another one. Saving the editor updates that layout and keeps the other layouts intact.

In **Display mode and slideshow**, choose **Slideshow** to rotate through **all named layouts in their saved order**. Set each layout's duration to 60–86400 seconds (one minute to 24 hours), reorder the layouts as needed, then choose **Save display mode**. There can be at most 12 layouts; slideshow mode requires at least one. The schedule applies to JSON, BMP, raw-pixel and compatible unattended-device requests. Switching back to **Single layout** shows the previously selected layout; it preserves the selected layout (`active_layout_id`), saved layouts, order and durations for later use. A disabled slideshow may have no named layouts and use the base layout.

Apply migrations `013_display_schedule.sql` and `018_device_displays.sql` before using per-device slideshows, along with any other missing migrations in filename order. Existing installations should apply only migrations they have not already run.

Page rotation repeats in the configured order using elapsed UTC time anchored at the Unix epoch. It is deterministic across server restarts and does not restart at local midnight or when settings are saved. Saving a new order or durations changes the server's selection for the next request; it does not wake the device. Source enable flags and credentials remain shared across layouts and devices.

Quiet hours use the configured IANA time zone (for example `Europe/Copenhagen`). Start is inclusive and end is exclusive; overnight windows are supported. The server keeps the page selected at the beginning of the quiet window and returns a delay until quiet hours end. Rotation then resumes on the UTC cycle. Daylight-saving transitions use actual UTC instants: overnight quiet windows become shorter or longer when clocks change. Skipped local minutes are evaluated at the next real clock minute; repeated minutes follow the local clock rule on each occurrence.

The JSON preview adds:

```json
{"schedule":{"pageId":"home","pageName":"Home","quiet":false,"nextTransitionAt":"2026-09-28T14:15:00.000Z"},"nextRefresh":60000}
```

`nextRefresh` is in milliseconds. While awake, it is the lesser of the source refresh interval and the next page/quiet-hour transition. During quiet hours it is the time until the window ends. `nextTransitionAt` is an absolute UTC instant; clients should account for request latency when setting their next wake time. The renderer uses the same page chosen when the request began, even if fetching a source crosses a transition.

The schedule selects content on the server; it does not create background Bluetooth connections or wake a sleeping device. A device sees saved changes when it next polls. It can remain asleep until its previously scheduled refresh or the end of quiet hours, and can skip layouts if it polls less often than they change. Browser Bluetooth remains manual, and an explicit preview/push can still fetch fresh source data during quiet hours. Unattended clients must obey the returned delay to pause their scheduled physical refreshes. Physical battery life and refresh behavior need verification with the specific device.

For integrations, use `buildDisplayData` to obtain source data, schedule metadata and the refresh delay, then `layoutForDisplayData(preferences, data)` when calling the BMP/raw renderer. `resolveDisplaySchedule(preferences, now)` provides deterministic selection without fetching source data. Explicit draft previews render their supplied layout independently of the active schedule.
