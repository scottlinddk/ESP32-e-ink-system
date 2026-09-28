# Display pages and quiet hours

Use **Dashboard → Pages and schedule** to add the saved base layout as a named page, choose each page's duration, reorder pages, and configure a time zone and quiet hours. **Save and edit layout** opens that page in the layout editor; its live draft preview shows the selected page even when another page is currently active. Saving the editor updates that page and keeps the base layout and other pages intact.

Enable page rotation and save the schedule to use it for JSON, BMP, raw-pixel and compatible unattended-device requests. There can be at most 12 pages, each lasting 60–86400 seconds. Disabling the schedule returns to the single base layout. Disabled schedules may have no pages. Apply migration `013_display_schedule.sql` before using this feature.

Page rotation repeats in the configured order using elapsed UTC time anchored at the Unix epoch. It is deterministic across server restarts and does not restart at local midnight or when settings are saved. Changing page order/durations immediately changes the selection. Source enable flags and credentials remain shared across pages.

Quiet hours use the configured IANA time zone (for example `Europe/Copenhagen`). Start is inclusive and end is exclusive; overnight windows are supported. The server keeps the page selected at the beginning of the quiet window and returns a delay until quiet hours end. Rotation then resumes on the UTC cycle. Daylight-saving transitions use actual UTC instants: overnight quiet windows become shorter or longer when clocks change. Skipped local minutes are evaluated at the next real clock minute; repeated minutes follow the local clock rule on each occurrence.

The JSON preview adds:

```json
{"schedule":{"pageId":"home","pageName":"Home","quiet":false,"nextTransitionAt":"2026-09-28T14:15:00.000Z"},"nextRefresh":60000}
```

`nextRefresh` is in milliseconds. While awake, it is the lesser of the source refresh interval and the next page/quiet-hour transition. During quiet hours it is the time until the window ends. `nextTransitionAt` is an absolute UTC instant; clients should account for request latency when setting their next wake time. The renderer uses the same page chosen when the request began, even if fetching a source crosses a transition.

The schedule selects content on the server; it does not create background Bluetooth connections. Browser Bluetooth remains manual, and an explicit preview/push can still fetch fresh source data during quiet hours. Unattended clients must obey the returned delay to pause their scheduled physical refreshes. Physical battery life and refresh behavior need verification with the specific device.

For integrations, use `buildDisplayData` to obtain source data, schedule metadata and the refresh delay, then `layoutForDisplayData(preferences, data)` when calling the BMP/raw renderer. `resolveDisplaySchedule(preferences, now)` provides deterministic selection without fetching source data. Explicit draft previews render their supplied layout independently of the active schedule.
