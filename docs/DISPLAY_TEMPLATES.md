# Portable display templates

Use **Dashboard → Layout templates** to export saved settings, review an imported JSON file, or choose a starter layout. Review does not save anything. **Apply template** replaces only the listed settings in one preferences write; credentials and omitted settings stay on the current account.

A template uses this versioned format:

```json
{"format":"esp32-eink-template","version":1,"settings":{"show_energy_price":true,"energy_price_location":"DK1","layout":{"version":1,"cols":10,"rows":6,"widgets":[{"i":"energy","x":0,"y":0,"w":10,"h":6}]}}}
```

Version 1 supports source enable flags, electricity area, weather coordinates, news language, refresh interval, EV field selections, layout, monochrome display profile and display schedule (named pages, durations, time zone and quiet hours). Display profile and scheduling settings take effect only on app versions that provide those features. The format is limited to 32 KiB. Unknown versions, unknown fields, duplicate/overlapping widgets, invalid geometry, unsupported profiles and invalid schedules are rejected before any settings are saved. There is no automatic conversion from other applications' formats.

Custom sensor templates can include visibility (`show_custom_webhook`) and the freshness lifetime (`custom_webhook_ttl_minutes`, 1–1440 whole minutes), along with the sensor widget layout. These controls use the same validation as dashboard settings.

Exports deliberately exclude API keys, passwords, integration/device tokens, token hashes, sensor snapshots, user/device identifiers and private feed URLs. They include your configured weather coordinates, page names and non-secret source settings: review an export before sharing it. Importing a layout that uses a data source does not transfer its account credentials or sensor readings. A receiving account must configure those separately.

Endpoints require a Clerk bearer token:

- `GET /api/preferences/templates/export` returns the safe versioned document.
- `GET /api/preferences/templates/starters` returns the built-in Electricity focus and Household overview templates.
- `POST /api/preferences/templates/validate` accepts a template and returns its validated form for review, without writing to the database.
- `POST /api/preferences/templates/import` validates again and applies the included settings atomically to the authenticated account.

Validation is server-side for both review and import. Editing the JSON after review cannot bypass import validation. Unsupported future settings are rejected on import and omitted by older exporters; retain the original file when migrating between app versions.
