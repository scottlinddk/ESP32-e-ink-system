# Weather setup and troubleshooting

The Weather widget uses [OpenWeatherMap Current Weather Data](https://openweathermap.org/api/current), with temperature in Celsius and wind speed in m/s.

1. Obtain a key with Current Weather Data access from your OpenWeatherMap account and save it in the app's API key settings.
2. Enable Weather and enter latitude,longitude with decimal points, such as `57.05,9.92` for Aalborg. **Use my location** fills these values from the browser's location permission.
3. Select **Test weather**. This checks the entered coordinates using the saved key and bypasses cached data. It does not save the location or other display settings.
4. Save the source settings, add the Weather widget in the layout editor, and refresh the preview. Send the new preview over Bluetooth or let the device fetch it on its next scheduled refresh.

A **Configured** key means the app has stored it; it does not prove provider access. If the server supplies `OPENWEATHERMAP_API_KEY`, accounts without their own key can use that default. An account's saved key always takes precedence.

| Diagnosis | Action |
|---|---|
| Add API key | Save a Current Weather Data key. |
| Check location | Use exactly two coordinates with decimal points, separated by a comma. Latitude must be -90 to 90; longitude -180 to 180. |
| Check API key | Check the saved key, activation and product access. Newly created keys can take up to two hours to activate. |
| API limit | Check the account's request quota and retry later. |
| Timed out / Unavailable | Retry when the provider or network recovers. |
| Invalid data | The provider returned incomplete or malformed data; no temperature is invented. Retry later. |

OpenWeatherMap documents key activation, rejected keys and request limits in its [FAQ](https://openweathermap.org/faq). Testing again after updating the key gives a fresh result. Normal previews reuse successful readings for up to one hour; a failed forced test removes the matching cached reading.

Tests verify provider response contracts, coordinate validation, credential isolation, sanitized diagnostics and cancellation. A live reading from a customer's account still requires that account's valid key. API details are in the [API reference](API_REFERENCE.md#post-apipreferencesweathertest).
