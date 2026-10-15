# Calendar widgets

The calendar shows events from a private ICS feed. The original **Calendar** widget uses the feed saved under **Integrations → Calendar**. Under **Additional calendars** you can add more (a person, a job, a team): each becomes its own **Calendar: <name>** widget in the layout editor, next to the original one, like additional news feeds.

Every calendar widget can be drawn in four views. Choose the view by selecting the widget in **Edit layout** and using **View**; the choice belongs to that placement, so one calendar can be a month on one scheduled page and a list on another. All four views use the same fetched data.

| View | Shows | Options |
|---|---|---|
| `list` (default) | Upcoming events under a bold heading per day (`Today, Thu 15 Oct`, `Tomorrow, …`), all-day first. From 70 pixels of height each event is a **card**: a bar, the title (up to two lines) and its time range `06:30 - 07:15` (`All day`). Under 70 pixels the list becomes a **schedule**: a shaded day bar, then one row per event with the start time in a black pill (`#` for all-day), the bold title, and the end time in a shaded pill at the right (left out below about 190 pixels of width). A wide widget flows the days into up to three columns and repeats a day's heading where it carries on. Events that have ended are hidden. | `items`: most events drawn (1–10, never more than the calendar's own limit). The calendar's **Days ahead** sets how far it looks. |
| `day` | Today hour by hour. Events are shaded blocks with a bar at the left edge, the time range over the title, side by side when they overlap; all-day events sit above the hours. A line marks the current time. | None. |
| `days` | Several days side by side (`Thu 15/10`, today inverted), sharing the hour labels, with weekends shaded. | `days`: 2–7 columns. Unset fits as many as the width allows, with at least 10 characters per day. |
| `month` | The month of today as a Monday-first grid: bold weekday names, the day numbers at the right of each cell, today inverted, weekends and the days around the month shaded. A large cell lists its events (bar and title, `+N more` when they do not fit), and a multi-day all-day event is one shaded bar across the week instead of a title in every cell; a small cell shows a dot for each event, up to three. | None. |

The look follows e-paper calendar dashboards such as TRMNL's Apple Calendar plugin, within what a 1-bit panel and the 8 × 8 font allow: grey becomes a dot pattern, and text over a pattern sits on a clean patch so it stays readable.

`day` and `days` start an hour before now so what just happened and what comes next are both in view. How many hours show depends on the widget's height: at least 12 pixels an hour, so a tall widget, a larger panel or a lower text size shows more, and the whole day fits at about 300 pixels. Events outside the window are left out of that view; use the list for the rest of the day.

A view the widget is too small for falls back to the list instead of drawing something unreadable: the hour views need about 60 pixels of height and 5 characters of width per day, and the month needs about 7 × 17 pixels for the grid and a text line per week. The month drops its title, then its weekday names, as the widget gets shorter. A widget under 30 pixels tall (one grid row on the default 250 × 122 panel) shows the list without day headings, one line per event, as it always did.

## Setting up additional calendars

1. Find the calendar's private HTTPS ICS URL as described in [Calendar subscriptions](INTEGRATIONS.md#calendar-subscriptions).
2. Under **Integrations → Calendar → Additional calendars**, choose **Add calendar**, give it a name, a time zone, **Days ahead** and **Events** (used by the list view), paste the URL and choose **Save calendars**. Up to 8 calendars.
3. Add **Calendar: <name>** to a layout and pick a view.

The URL is write-only. It is stored encrypted in `api_keys` under the provider `calendar:<id>` (the same ID as the layout widget), and no route returns it: `GET /api/preferences/calendar-credentials/widgets` lists only which calendars have one. Taking a calendar off the list deletes its URL. A URL can only be saved for a calendar that is already saved, so the list is saved first. Additional calendars are excluded from exported templates, which is also why they have no on/off switch: a configured calendar is fetched on every refresh and drawn wherever a layout places it.

A calendar with no URL shows `Calendar: Add calendar URL`, a failing one `Calendar: Unavailable` or `Timed out`, and a calendar removed from the settings but still in a layout shows as unavailable until its widget is removed. One failing calendar never affects another. An empty calendar shows `No upcoming events` in the list view.

## What the server fetches

One fetch per calendar holds what every view needs: the month grid of the current month and at least the next 7 days (or the calendar's **Days ahead**, if more), up to 300 events. Events are expanded from recurrences in the same bounded worker as before (two seconds, 64 MiB, 500 event components, 5,000 expanded instances) and each carries its local day, last day and start and end minutes, so the views place it without time zone arithmetic. An event that ends exactly at midnight belongs to the day before; an event that runs past midnight is drawn on both days.

The JSON preview (`GET /api/preview`) returns the original calendar as `calendar` and the others as `calendars`, keyed by calendar ID:

```json
{
  "calendar": {
    "timezone": "Europe/Copenhagen", "today": "2026-10-15", "nowMinute": 385, "days": 7, "limit": 5,
    "events": [
      { "title": "D-dråber", "start": "2026-10-15T04:00:00.000Z", "end": "2026-10-15T07:00:00.000Z", "allDay": false,
        "dateLabel": "15 Oct", "timeLabel": "06:00", "day": "2026-10-15", "endDay": "2026-10-15", "startMinute": 360, "endMinute": 540 }
    ]
  },
  "calendars": {
    "work": { "calendar": { "...": "same shape" } },
    "fam2": { "error": { "code": "unavailable", "message": "Calendar unavailable: check the feed URL and supported format." } }
  }
}
```

`error.code` is `not_configured`, `unavailable` or `timeout`; messages never contain the feed URL or parser text.

## Saving

`POST /api/preferences` accepts `calendar_widgets`: up to 8 `{ id, name, timezone, days, item_limit }` entries, validated like the original calendar's settings (`id` is 1–16 lowercase letters or digits, `name` at most 40 characters, `days` 1–30, `item_limit` 1–10). URLs are saved separately, one calendar at a time:

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/preferences/calendar-credentials/widgets` | `{ "configured": ["work"] }`: IDs with a stored URL |
| POST | `/api/preferences/calendar-credentials/widgets/{id}` | Body `{ "url": "https://…" }`. 404 unless `{id}` is a saved calendar |
| DELETE | `/api/preferences/calendar-credentials/widgets/{id}` | Remove the stored URL |

Apply `025_calendar_widgets.sql` to existing databases first; see the [database upgrade steps](RASPBERRY_PI_DATABASE_MIGRATION.md#upgrade-an-existing-database-for-additional-calendars-025).
