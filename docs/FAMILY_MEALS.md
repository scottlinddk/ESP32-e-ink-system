# Family Meals widget

The **Meal plan** widget shows the week's dinners from a [Family Meals](https://github.com/scottlinddk/family-meals) app. It reads a small, read-only JSON endpoint with a bearer token that a member of the family creates in Family Meals.

## Set up

1. In Family Meals open **User & family → API access** (Danish: **Bruger & familie → API-adgang**), name the device and choose **Create key**. Copy the key now. Family Meals stores only a hash of it, so it cannot be shown again. Apply the app's `0040_api_tokens` migration first.
2. In this app open **Integrations → Family Meals**, choose **Add key**, and save the address of your Family Meals app (for example `https://family-meals.example.com`) and the key.
3. Add **Meal plan** in the layout editor and check the Dashboard preview.

There is no source switch: the widget is fetched when the layout being drawn places it, and is on once the key is saved. Before that it draws **Meals: add API key** so a placed widget is never silently blank.

## Views

| View | Shows |
|---|---|
| `full` (default) | A header with the ISO week, then Monday to Sunday with the dish. Today is white on a black bar. A day left without dinner shows its note, or **No dinner**; leftovers are prefixed **Leftovers:**. |
| `condensed` | Tonight alone: the weekday's dinner time and the dish, at double size when it fits. |

A widget too short for the whole week drops the header, then shows the days from today onward instead of the days that have passed. When the family has not generated a plan for the week, the widget says **No meal plan**. English and Danish follow the device's display language.

## What is fetched, and how it is protected

- One request to `GET <address>/api/widget/week` with `Authorization: Bearer fm_...`. The answer is validated field by field and anything unexpected is rejected as invalid data. Titles are limited to 120 characters.
- The address must be public HTTPS on port 443, without credentials, like RSS and calendar feeds. DNS answers are checked and pinned to the socket, the response is limited to 1 MiB and 8 seconds, and **redirects are never followed**, so the key cannot be sent to another host. Any path or query pasted with the address is dropped.
- The address and key are stored encrypted with `ENCRYPTION_KEY` (provider `family-meals`) and are never returned by the API, written to logs, or included in exported templates. Users a device is shared with draw the owner's plan without seeing the key.
- The week is cached per user for five minutes. A failed request never shows older data; the widget shows a short diagnostic instead.

| Widget text | Meaning |
|---|---|
| Meals: add API key | No key is saved. |
| Check Meals setup | The saved address or key no longer passes validation. Save them again. |
| Check Meals key | Family Meals answered 401: the key was revoked or mistyped. Create a new key. |
| Meals: unavailable / timed out / invalid data | Family Meals did not answer, was too slow, or answered something unexpected. |

Revoking a key in Family Meals stops the widget on its next refresh (within five minutes of cache).
