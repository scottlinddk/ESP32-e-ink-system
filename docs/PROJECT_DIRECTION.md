# Project direction and reliability work

## Product direction

Make this a dependable household information display: the right electricity price, useful charging status and personal information, readable at a glance. Reliability and honest freshness matter more than additional integrations on a screen that keeps its last image when disconnected.

## Implemented in this pass

- Replace discontinued hourly Elspotprices requests with the current DayAheadPrices feed in both the backend and reusable widget package. Select the actual UTC interval and handle Danish day boundaries, negative prices and daylight-saving changes.
- Share live-data assembly across JSON, BMP and raw Bluetooth output, including Monta, Zaptec and Notion. Give each source a 10-second deadline, preserve healthy readings when another source stalls, and remove fabricated weather and headlines.
- Show the actual server-rendered image on the Dashboard, with the last successful image-fetch time and explicit stale/error states. Source readings can still be older according to their provider cache; this timestamp is not a sensor observation time.
- Refresh previews after preferences, layouts or credentials change.
- Open the Bluetooth picker during the user's click, validate the expected image size and release the connection after transfers or failures. Successful transmission means the final command was acknowledged; physical panel behavior still needs hardware verification.
- Clip widgets and separator lines to their layout rectangles, correct mirrored bitmap glyphs, and honor selected EV fields. EV caches distinguish field selections so enabling another field takes effect immediately.
- Expose EV/Notion widgets in the layout palette, place added widgets without overlaps, and protect saved settings after a load failure.
- Render unsaved layouts on demand with the same authenticated live-data pipeline and BMP renderer as saved previews. Draft requests validate widget IDs, geometry and overlaps without writing to the database; layout edits cancel and clear outdated previews.
- Add regression coverage and an application CI workflow.
- Implement direct Wi-Fi device-feed firmware with separate original CrowPanel, V1.2 and Waveshare drivers. Compile and validate full factory images for the browser installer, provision per-device tokens, and test display protocol transfers and malformed BMP handling on the host.

## Next useful increments

1. **Verify the hardware contract.** The renderer supports validated display profiles; bundled Wi-Fi firmware requires its board's native size (250 × 122 today) and accepts every content rotation, and the Bluetooth path checks its own format constraints. Verify USB installation, orientation and refresh on every supported physical board, including both Elecrow panel revisions.
2. **Validate unattended delivery on the unit.** Per-device token delivery is implemented by the bundled Wi-Fi firmware and the optional gateway bridge. Complete the actual device's provisioning, TLS connection, successful refresh, acknowledgement and subsequent scheduled update before claiming end-to-end hardware operation.
3. **Refine live layout editing.** The editor now renders the current draft on demand. Any future automatic rendering should debounce changes and respect source/API rate limits.
4. **Add source freshness.** Return each integration's observation time and availability state; put a compact last-updated marker on the physical screen. A server image-generation timestamp alone does not show how old a source reading is.
5. **Turn price awareness into planning.** Once current prices are dependable, add upcoming prices and cheapest contiguous charging/appliance windows. Keep spot-price guidance distinct from the household's actual tariff.

## Verification and limits

Automated tests cover live-data assembly and routes, matching BMP/raw pixels, rendering boundaries, Bluetooth framing/cleanup, and electricity interval/date/cache edge cases. Production builds and workspace type checks run separately. External integrations are mocked in automated tests; Energinet's current response shape was also checked against its public API and metadata.

No physical display was connected during this work. Authenticated production workflows, firmware flashing, physical refresh, battery life and panel-specific pixel ordering need testing with the user's accounts and hardware. Existing hardware/tooling limitations described above remain.

## Energinet contract

Verified against the provider's [dataset metadata](https://api.energidataservice.dk/meta/dataset/DayAheadPrices) and [API guide](https://www.energidataservice.dk/guides/api-guides):

- `TimeUTC` is the start of a 15-minute interval; JSON timestamps omit the `Z` suffix despite being UTC.
- `DayAheadPriceDKK` is DKK/MWh; divide by 10 for øre/kWh.
- `start`/`end` request bounds use Danish local time. `StartOfDay` through `StartOfDay+P1D` includes the correct 23-, 24- or 25-hour Danish day.
- A 100-record limit accommodates the longest Danish day for one price area.
- Newest published data is not necessarily the current interval. Missing current data must be unavailable, never silently replaced by a future or historical price.
