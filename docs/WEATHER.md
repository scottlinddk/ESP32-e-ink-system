# Weather setup and troubleshooting

The Weather widget uses [OpenWeatherMap](https://openweathermap.org/api) with temperature in Celsius and wind speed in m/s. Its views draw the [current weather](https://openweathermap.org/api/current), the [5-day / 3-hour forecast](https://openweathermap.org/forecast5) and the [air pollution](https://openweathermap.org/api/air-pollution) readings. All three are included in the free plan; none of them needs One Call 3.0.

1. Open **Integrations**. Obtain a key with Current Weather Data access from your OpenWeatherMap account and save it in the app's API key settings.
2. Enable Weather and enter latitude,longitude with decimal points, such as `57.05,9.92` for Aalborg. **Use my location** fills these values from the browser's location permission.
3. Select **Test weather**. This checks the entered coordinates using the saved key and bypasses cached data. It does not save the location or other display settings.
4. Save the source settings, add the Weather widget in the layout editor, and refresh the preview. Send the new preview over Bluetooth or let the device fetch it on its next scheduled refresh.

## Views

Choose the view of a weather widget by selecting it in **Edit layout** and using **View**. The choice belongs to that placement, so the same weather can be one line on one scheduled page and a forecast on another. All views use the same location and key, and each draws its own weather icon (sun, moon, clouds, rain, thunder, snow, mist) from the provider's icon code, so it scales with the widget and with [text size](WIDGET_OPTIONS.md#zoom).

| View | Shows | Needs |
|---|---|---|
| `summary` (default) | The condition and temperature on one line, the wind under it. Unchanged from before. | The current reading |
| `current` | A large temperature with its icon and the condition, and beside or below it: feels like, humidity, wind with its compass direction, sunrise and sunset. | The current reading |
| `hours` | The next steps of the forecast as columns: local time, icon, temperature and chance of rain. | The forecast |
| `daily` | The days ahead, starting with today: weekday, icon, chance of rain and high/low. A wide, short widget lays the days side by side instead of stacking them. | The forecast |
| `details` | A list of readings: feels like, humidity, wind speed, direction and gusts, pressure, cloud cover, visibility, rain in the last hour, sunrise, sunset, air quality, PM2.5 and PM10. A reading the provider did not report is left out. Two columns when the list is taller than the widget. | The current reading and air quality |

Set **Number of steps** (`hours`) or **Number of days** (`daily`) to show fewer than fit. The forecast comes in **3-hour steps**, which is what the provider offers on the free plan, so `hours` shows the next 6 to 8 of them, not every hour.

Metrics are set apart by dotted rules: between the rows of `details`, `daily` and the readings of `current`, and between the columns of `hours` and the side-by-side `daily`. Rows are 12 px with a rule when that fits at least three, otherwise 10 px and tight, so a very short widget shows one more reading and no rules.

Each placement fits its space. A view that is too small for everything draws less rather than overlapping or cutting text: icons go first, then the chance of rain and the low, then labels, and `details` switches to short labels and then leaves out units. A widget under 11 pixels tall draws nothing, and a failed reading draws the same short diagnosis as the summary. What each view needs, in pixels after text size is applied:

| View | Needs |
|---|---|
| `current` | 29 tall for a larger temperature with the condition under it, 11 for the temperature alone. The readings are 10 px a line, beside the temperature from about 220 wide and under it otherwise. The icon needs 12 px of width beside the temperature. |
| `hours` | 36 wide per column. 22 tall for the time and temperature, 37 with the icon, 48 with the chance of rain; below 22 only the temperature. |
| `daily` | Stacked: 11 tall per day, wide enough for the weekday and the high (the low, icon and chance of rain follow from about 105, 130 and 165 wide). Side by side (when the widget is more than about twice as wide as it is tall): 44 wide per day, 21 tall for the weekday and high, 31 with the low, 46 with the icon. |
| `details` | 12 tall per reading (10 without rules in a short widget), and about 14 characters of width for a full label beside its value. A list taller than the widget continues in a second column from about 240 wide. |

On a large panel the automatic text size can make a narrow widget hold only a few characters. For a dashboard of several views, such as the current weather beside the forecast and the readings, set **Text size** to 2× on those widgets.

### Showing several views at once

A layout holds each widget once, so the palette lists **Weather (2)**, **Weather (3)** and **Weather (4)** next to **Weather**: up to four placements that share the weather settings and have a view each. Turning Weather off in **Integrations** turns off all of them. They are stored in the layout as `weather:2` to `weather:4` and are included in exported templates, because they have no settings of their own.

### Extra provider requests

A view only makes the requests it draws. The default layout, `summary` and `current` make the one current-weather request. A layout whose displayed page has an `hours` or `daily` weather widget also requests the forecast, and a `details` widget also requests air quality. Only the page being shown counts, so a slideshow page with a forecast makes the request only while it is on. Each request is cached for one hour, like the current reading, and fails on its own: if the forecast or air quality cannot be loaded, the current reading and every other view still draw, and the forecast views say `No forecast` (or the reason, such as `API limit`).

### What the numbers are

- **Days.** A day's high and low are taken from its 3-hour steps, so they can be a degree or two narrower than the true extremes. Today's range covers what is left of today, with the current temperature included. The last day of the forecast is left out when only a few of its steps are known. The icon of a day is its worst weather (thunder, then snow, then rain), otherwise the step around midday.
- **Times** (clock labels, sunrise and sunset) follow the **Display time zone**. In polar day or night the provider gives no sunrise or sunset, and those rows are left out.
- **Wind** is in m/s, as before, and the direction is the one the wind blows from.
- **Air quality** is the European index the provider reports: Good, Fair, Moderate, Poor, Very poor (1–5). PM2.5 and PM10 are in µg/m³.
- **UV index is not shown.** OpenWeatherMap provides it only in One Call 3.0, which needs a separate subscription with a payment card.

## Key and troubleshooting

A **Configured** key means the app has stored it; it does not prove provider access. If the server supplies `OPENWEATHERMAP_API_KEY`, accounts without their own key can use that default. An account's saved key always takes precedence.

| Diagnosis | Action |
|---|---|
| Add API key | Save a Current Weather Data key. |
| Check location | Use exactly two coordinates with decimal points, separated by a comma. Latitude must be -90 to 90; longitude -180 to 180. |
| Check API key | Check the saved key, activation and product access. Newly created keys can take up to two hours to activate. |
| API limit | Check the account's request quota and retry later. |
| Timed out / Unavailable | Retry when the provider or network recovers. |
| Invalid data | The provider returned incomplete or malformed data; no temperature is invented. Retry later. |

The same diagnoses apply to the forecast and air quality, which use the same key and quota. The **Test weather** action checks the current reading only.

OpenWeatherMap documents key activation, rejected keys and request limits in its [FAQ](https://openweathermap.org/faq). Testing again after updating the key gives a fresh result. Normal previews reuse successful readings for up to one hour; a failed forced test removes the matching cached reading.

Tests verify provider response contracts, coordinate validation, credential isolation, sanitized diagnostics and cancellation. A live reading from a customer's account still requires that account's valid key. API details are in the [API reference](API_REFERENCE.md#post-apipreferencesweathertest).
