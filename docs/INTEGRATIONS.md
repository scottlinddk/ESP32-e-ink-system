# Integration setup

Open **Integrations** after signing in. It contains source controls, API credentials, Calendar, and Home Assistant/custom sensors. Setup information is available in English and Danish. Settings are scoped to the signed-in account. If saved preferences cannot load, retry before saving; unloaded defaults must not replace them.

Each source needs both saved source settings and its widget in the **layout editor**. After saving, check the Dashboard preview. Bluetooth transfer is manual; an automatic device fetches on its configured schedule. Receiving a webhook or refreshing the browser does not immediately change the panel.

| Integration | Widget | Setup |
|---|---|---|
| Elprisen lige nu + Energinet | Energy prices / Elpris | Select DK1/DK2 and spot or consumer estimate. No key. Consumer mode needs the actual grid tariff and supplier markup. [Pricing guide](ELECTRICITY_PRICES.md) |
| OpenWeatherMap | Weather | Save a Current Weather Data key, enter coordinates with decimal points, and use Test weather before saving. [Weather guide](WEATHER.md) |
| NewsAPI | News headlines | Save a key with appropriate deployment access and select supported coverage. The [Developer plan](https://newsapi.org/pricing) is restricted to development/testing; use RSS or suitable provider access for deployment. |
| RSS / Atom | News headlines | Select RSS / Atom, enter a public HTTPS feed, and choose 1–10 headlines. No key. Widget size determines how many fit. Add up to 20 more feeds under **Additional news feeds**; each becomes its own **News: <name>** widget in the layout editor. |
| Monta | Monta | Save client ID and client secret for an API client with access to the relevant charge points. Enable Monta and choose the displayed fields. [Authentication](https://docs.public-api.monta.com/reference/authentication) |
| Zaptec | Zaptec | Save the username and password for an account authorized to read the chargers. Enable Zaptec and choose the displayed fields. [Authentication](https://docs.zaptec.com/docs/api-authentication) |
| Notion | Notion | Create an internal connection with read access and share the original database with it. Save its `ntn_` or legacy `secret_` token and database ID or original Notion link. A database with multiple data sources also needs the desired data source ID. [Connection setup](https://developers.notion.com/guides/get-started/internal-connections) |
| ICS calendar | Calendar | Save a subscription URL, enable Calendar, and choose the event timezone, 1–30 day window and 1–10 event limit. See below. |
| Home Assistant / custom webhook | Custom sensors | Create a dedicated token, configure outbound JSON updates, and enable the sensor source. [Complete example](CUSTOM_WEBHOOK.md) |

NewsAPI's [published sources](https://newsapi.org/docs/endpoints/sources) do not list Danish or Finnish coverage. For Danish headlines, select a publisher's public RSS feed rather than assuming a Danish NewsAPI key will supply them. Feed URLs are ordinary preferences; use the separate Calendar form for secret calendar subscription URLs.

**My note**, **My image**, and **Status** are built-in widgets. Notes/images are configured on Dashboard; Status uses the selected display timezone. They do not require an external integration. See [custom content](CUSTOM_CONTENT.md). Calendar and quiet-hours timezones are independent of the display clock.

Monta's optional daily figure is the reported energy of sessions **created today in the display timezone**. It is not energy metered since midnight: a session can span days. Zaptec shows the first actively charging charger and its reported session energy; an unknown measurement is shown as `?`, not zero. The provider lists are bounded to 500 items per request sequence.

Notion resolves the database's data source before querying its items. A single source is selected automatically; multiple sources require an explicit choice. Copy the source ID using Notion's data-source menu or retrieve it from the [database API](https://developers.notion.com/reference/retrieve-a-database). A view ID is not a data source ID. Optional status filters require the exact property and status names. The preview provides a setup diagnostic if access or source selection is missing.

## Calendar subscriptions

Use a subscription feed, not the calendar's HTML page or a sharing invitation:

- **Google Calendar:** In the calendar's settings, open Integrate calendar and copy its secret iCal address. A work/school administrator may restrict this option. [Google instructions](https://support.google.com/calendar/answer/37648?hl=en-GB)
- **Outlook:** Publish the calendar with the intended visibility and copy the ICS link. Publishing must be allowed by the account/organization. [Microsoft instructions](https://support.microsoft.com/en-us/outlook/sharing/share-an-outlook-calendar-as-view-only-with-others)
- **iCloud:** Use the calendar's public sharing link. Anyone who obtains a public link can read it; choose an appropriate calendar. If the copied link starts with `webcal://`, replace that prefix with `https://`. [Apple instructions](https://support.apple.com/en-mide/guide/iphone/iph7613c4fb/ios)

The app encrypts the saved feed URL and does not include it in preferences or exported templates. It must be reachable by the backend over public HTTPS without a browser login. Private LAN hosts, embedded HTTP credentials, compressed responses and unsupported calendar formats cannot be read. The existing calendar limits are described in [README](../README.md#data-sources). Removing the saved address stops fetching it; invalidating a published/secret URL at the calendar provider also prevents future access through that URL.

Known Outlook Windows timezone names are converted using the installed calendar parser's mapping. Unknown timezone names remain unsupported; they are never silently interpreted in the server's timezone.

## Home Assistant

Create a token in the Home Assistant card and copy it while it is shown. The page provides the deployed HTTPS ingestion address and examples for `secrets.yaml`, a REST command, and a five-minute automation. Replace the sample entities with your own and choose a freshness lifetime longer than the update interval. On localhost, use your deployed app address; Home Assistant cannot reach your computer's `localhost` through its own loopback address.

Test the REST action in Home Assistant, then refresh the card's status. Add **Custom sensors** to the layout and inspect the preview. Updates travel from Home Assistant to this backend; Home Assistant itself does not need public inbound access. **Replace token** invalidates the previous token and clears received values; **Revoke token** stops updates. Full payload, freshness and error semantics are in [the webhook guide](CUSTOM_WEBHOOK.md).

## Checking setup

Saving credentials records configuration; it does not establish provider access. Use the Weather test where available and inspect the saved preview for other sources. Empty results and failed requests are different: an empty agenda has no upcoming events; an unavailable agenda could not be loaded. A stale sensor snapshot keeps its readings with a visible stale label. Keep API keys, database tokens and secret calendar URLs out of reusable templates.

Switching a source off leaves its layout area blank. Remove or resize the widget separately to reclaim the space. The [audit inventory](INTEGRATION_AUDIT.md) lists every supported widget and its verification limits.
