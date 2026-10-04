# Integration and widget audit — 2 October 2026

The production data path is the backend source services → `DisplayData` → the shared bitmap renderer, used by previews, scheduled devices and Bluetooth images. The standalone News, Monta, Zaptec and Notion adapters under `packages/widgets` are also checked against the corrected provider contracts. The standalone weather adapter remains a basic legacy adapter without the production setup-test/diagnostic flow, and the standalone electricity adapter exposes spot prices only; neither is the production display data path.

## Inventory

| Widget | Source and behavior | Audit result |
|---|---|---|
| Energy prices | Elprisen lige nu spot (DK1/DK2) with Energinet tariffs; spot or configured estimate including variable tariffs, tax and VAT | Current quarter-hour data; grid and national tariffs applied per interval, including DST. Explicit spot/estimate labels. Fixed fees excluded. [Pricing details](ELECTRICITY_PRICES.md) |
| Weather | OpenWeatherMap Current Weather Data | Coordinates normalized, zero accepted, account-key/location cache, setup test and safe error diagnostics. [Setup](WEATHER.md) |
| News | Public RSS/Atom or NewsAPI | RSS empty/error behavior retained. NewsAPI rejects unsupported Danish/Finnish coverage with an RSS suggestion; malformed articles cannot reach bitmap text rendering. Credential-bound cache and bounded responses. |
| Monta | Charge points, charging sessions, optional creation-day aggregate | Correct public API host, camelCase authentication/fields, pagination and `consumedKwh`. Daily aggregate follows display timezone and explicitly means sessions created today. Missing measurements stay unknown. |
| Zaptec | Charger status, first active charging session and optional installation | Correct camelCase response fields, mode 3 charging versus mode 5 finished, observation 553 already in kWh, singular installation endpoint. Observation 718 is a boolean, never a timestamp. |
| Notion | Items from a database's data source | Modern and legacy tokens; database-to-data-source resolution for API 2025-09-03. Multiple sources require explicit selection. Renamed title columns supported; credential/options changes invalidate cached results. |
| Calendar | Secret HTTPS ICS subscription | Known Outlook Windows timezone names accepted through the installed parser's mapping. UTC/IANA, all-day, recurrence and cancellation behavior retained; unknown zones rejected. |
| Custom sensors | Home Assistant or another producer sending JSON | Dedicated token, encrypted storage, bounded rows, token rotation/revocation and freshness/expiry retained. Outbound Home Assistant setup documented. [Guide](CUSTOM_WEBHOOK.md) |
| My note | User text | Existing validation, wrapping and clipping reviewed; source toggle now also enforced by renderer. [Guide](CUSTOM_CONTENT.md) |
| My image | User monochrome image | Existing dimensions, pixel validation, fit and clipping reviewed; disabled images remain blank. [Guide](CUSTOM_CONTENT.md) |
| Status | Display refresh information and clock | Uses selected IANA timezone. Restored to the layout palette so it can be added after removal. |

Air-quality preferences and OpenAI key storage are legacy schema/API fields; there is no active air-quality or OpenAI widget. They are not offered as working integrations.

## Cross-cutting fixes

All source toggles are enforced at rendering time, even if input data remains cached. An explicitly disabled source leaves its layout area blank; an enabled source with no data retains its unavailable diagnostic. Successful empty news/calendar/Notion results remain distinct from failures. Layout and schedule still determine where content fits; enabling a source does not automatically add its widget.

Direct preference updates now use the existing template validators for booleans, supported source options, field lists, refresh bounds, layout and timezone. Partial updates remain partial, invalid mixed updates cannot save only some fields, and disabled RSS drafts may have an empty feed URL. Enabling RSS requires a feed. Credentials are separately validated and never included in templates.

Integration drafts and pending credential access are scoped to the signed-in account. Credential cards distinguish loading, failure and saved configuration; a saved key does not claim a successful provider connection. Notion and NewsAPI expose fixed setup diagnostics without returning or logging provider bodies or credentials. EV failures are not cached as successful empty results.

## Provider references

- Monta: [authentication](https://docs.public-api.monta.com/reference/authentication), [client-credential token](https://docs.public-api.monta.com/reference/get-access-token-with-client-credentials), [charges](https://docs.public-api.monta.com/reference/get-charges), [charge points](https://docs.public-api.monta.com/reference/get-charge-points). Date filters select creation time, not a midnight-to-midnight meter reading.
- Zaptec: [chargers](https://docs.zaptec.com/reference/api_chargers_get), [state observations](https://docs.zaptec.com/docs/state-observation-reference), [FinalStopActive](https://docs.zaptec.com/docs/understanding-finalstopactive-and-resume-command-behavior), [installation](https://docs.zaptec.com/reference/api_installation_get), [authentication](https://docs.zaptec.com/docs/api-authentication).
- Notion: [2025-09-03 migration](https://developers.notion.com/guides/get-started/upgrade-guide-2025-09-03), [internal connections](https://developers.notion.com/guides/get-started/internal-connections), [retrieve a database](https://developers.notion.com/reference/retrieve-a-database).
- NewsAPI: [supported sources and coverage](https://newsapi.org/docs/endpoints/sources), [deployment-plan restrictions](https://newsapi.org/pricing). Danish and Finnish are not listed; this audit does not silently change a user's selection to US headlines.
- Calendar: installed [node-ical parser and Windows mappings](https://github.com/jens-maus/node-ical).

## Validation and operational limits

Regression tests use documented provider-shaped fixtures for authentication, pagination, nullable fields, response limits, cancellation, cache isolation, rendering, and calendar winter/summer/DST behavior. The complete application/client test suite, type checks and production builds are run before merging. The earlier Bluetooth change was compiled for all three supported firmware boards and checked with firmware host tests. Energinet spot and consumer pricing were also checked against live anonymous data.

Private OpenWeatherMap, Monta, Zaptec and Notion accounts and a physical e-ink device were not available for end-to-end testing. User credentials, provider account permissions and deployed database migrations therefore still need operational verification. RSS/calendar retain public-HTTPS, response-size and recurrence limits; EV lists are bounded to 500 items and fail rather than presenting a truncated aggregate. These limits are intentional and visible as unavailable data.

Existing deployments need migrations `016_display_timezone.sql` and `017_energy_price_settings.sql` for the new settings. Bundled Bluetooth requires the updated firmware; classic ESP32 builds need a full USB installation because the application partition changed. See [Bluetooth delivery](BLUETOOTH_DELIVERY.md).
