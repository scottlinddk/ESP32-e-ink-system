# API Reference

> Some sections below describe the legacy Wi-Fi/license-key firmware. The current
> dashboard uses authenticated `/api/preview`, `/api/image/preview` (BMP) and
> `/api/image/preview/raw` (Bluetooth pixels). See the [README](../README.md#api-and-hardware-status)
> for active endpoints and hardware limitations. Direct local Express requests
> omit the `/api` prefix; the frontend development proxy adds that public prefix.

Base URL: `https://api.yourdomain.com` (or `http://localhost:3001` for local dev)

All authenticated endpoints require a Clerk JWT in the `Authorization: Bearer <token>` header.

---

## Health

### GET /health

Check if the API is running. No authentication required.

**Response 200:**
```json
{
  "status": "ok",
  "timestamp": "2024-01-15T14:32:00.000Z",
  "uptime": 3600.123,
  "version": "1.0.0"
}
```

---

## Auth

### POST /api/auth/login

Sync the authenticated Clerk user into the Supabase database. Call this after sign-in.

**Headers:** `Authorization: Bearer <clerk_jwt>`

**Response 200:**
```json
{
  "user": {
    "id": "uuid",
    "email": "user@example.com",
    "display_name": "Jane Doe",
    "created_at": "2024-01-01T00:00:00.000Z",
    "updated_at": "2024-01-15T14:00:00.000Z"
  }
}
```

### GET /api/auth/user

Get the currently authenticated user.

**Headers:** `Authorization: Bearer <clerk_jwt>`

**Response 200:** Same as `POST /api/auth/login`

---

## Preferences

### GET /api/preferences

Get the authenticated user's display preferences.

**Headers:** `Authorization: Bearer <clerk_jwt>`

**Response 200:**
```json
{
  "preferences": {
    "show_energy_price": true,
    "show_weather": true,
    "show_news": true,
    "show_air_quality": false,
    "energy_price_location": "DK1",
    "weather_location": "55.3,10.4",
    "news_language": "da",
    "refresh_interval_minutes": 30
  }
}
```

### POST /api/preferences

Update display preferences (partial updates supported).

**Headers:** `Authorization: Bearer <clerk_jwt>`

**Body:**
```json
{
  "show_energy_price": true,
  "energy_price_location": "DK2",
  "refresh_interval_minutes": 60
}
```

**Response 200:** Full updated preferences object (same shape as GET)

### POST /api/preferences/weather/test

Test draft coordinates with the authenticated user's saved OpenWeatherMap key, or the server's `OPENWEATHERMAP_API_KEY` if no account key exists. The request does not save preferences and always bypasses the weather cache. A saved but rejected account key never falls back to the server key.

```json
{ "location": "57.05,9.92" }
```

**Response 200:** `{ "weather": { "temp": 12, "condition": "cloudy", "windSpeed": 3, "icon": "04d" } }`. Temperature is Celsius and wind speed is m/s, rounded to whole units.

Failures return `{ "error": "safe explanation", "code": "invalid_key" }`: 400 for `missing_key`, `invalid_location` or `invalid_key`; 502 for `rate_limited`, `unavailable` or `invalid_response`; 504 for `timeout`. Authentication failures retain the normal 401 response. Provider response bodies and request URLs are never included.

Coordinates use decimal points and a comma between latitude (-90..90) and longitude (-180..180). The same validator applies to preference saves and template imports. See [weather setup](WEATHER.md).

When enabled weather fails during preview/device rendering, JSON contains `weatherError: { code, message }` instead of `weather`; the bitmap displays a short diagnosis. Successful readings are cached for one hour per key and normalized location. Testing removes the matching cached reading before contacting the provider.

### POST /api/preferences/energy-price/test

Price draft electricity settings without saving them. Both fields are required; `settings` uses the same shape as `energy_price_settings`.

```json
{ "location": "DK1", "settings": { "mode": "consumer", "gridGln": "5790000611003", "gridChargeCodes": ["T-C-F-T-TD"], "retailerMarkupOre": 10 } }
```

**Response 200:** `{ "price": { "now": 210.5, "average": 190, "trend": "up", "basis": "consumer" } }` in øre/kWh, as in display data.

Failures return `{ "error": "safe explanation", "code": "missing_tariff", "missingCodes": ["CD", "CD R"] }`: 400 for `invalid_settings` or `missing_tariff`; 502 for `unavailable` or `invalid_response`; 504 for `timeout`. `missingCodes` lists every configured grid tariff code without a current tariff for the configured GLN, typically because the GLN and codes come from different grid companies or areas. Missing national Energinet charges are reported as `unavailable`, since the user cannot fix them. Upstream URLs and response bodies are never included.

When the enabled energy price fails during preview/device rendering, JSON contains `priceError: { code, message, missingCodes? }` instead of `price`; the bitmap shows `Energy: check tariff` and the missing codes, or a short diagnosis for other failures.

### GET /api/preferences/api-keys

List stored API keys (values are masked).

**Headers:** `Authorization: Bearer <clerk_jwt>`

**Response 200:**
```json
{
  "api_keys": [
    {
      "id": "uuid",
      "provider": "openweathermap",
      "api_key": "a1b2c3••••••••",
      "created_at": "2024-01-01T00:00:00.000Z"
    }
  ]
}
```

### POST /api/preferences/api-keys

Store or update an API key for a provider.

**Headers:** `Authorization: Bearer <clerk_jwt>`

**Body:**
```json
{
  "provider": "openweathermap",
  "api_key": "your-actual-api-key"
}
```

Valid providers: `openweathermap`, `newsapi`

**Response 200:**
```json
{
  "api_key": {
    "id": "uuid",
    "provider": "openweathermap",
    "api_key": "your-ac••••••••",
    "created_at": "2024-01-15T14:00:00.000Z"
  }
}
```

### DELETE /api/preferences/api-keys/:provider

Remove a stored API key.

**Headers:** `Authorization: Bearer <clerk_jwt>`

**Path parameter:** `provider` — one of `openweathermap`, `newsapi`

**Response 200:**
```json
{ "success": true }
```

---

## Devices

### GET /api/devices

List all devices paired to the authenticated user.

**Headers:** `Authorization: Bearer <clerk_jwt>`

**Response 200:**
```json
{
  "devices": [
    {
      "id": "uuid",
      "user_id": "uuid",
      "device_id": "ESP-7F3A9C",
      "device_name": "Living room display",
      "license_key": "DSPL-2K4M-9XQ1-7TBA",
      "firmware_version": "1.0.0",
      "last_seen_at": "2024-01-15T14:30:00.000Z"
    }
  ],
  "default_device_id": "uuid"
}
```

`default_device_id` is the device the dashboard opens when the URL names none. It is `null` when unset, and also when the stored device was deleted or now belongs to another account. Without a default, an account with exactly one device opens that device; an explicit `?device=` always wins.

### PUT /api/devices/default

Set or clear the dashboard's default device. Body: `{ "id": "uuid" }`, or `{ "id": null }` to clear.

**Response 200:** `{ "default_device_id": "uuid" }`. **400** when `id` is neither a UUID nor `null`; **404** when the device does not belong to the user.

Apply `backend/src/db/migrations/022_default_device.sql` before deploying.

### POST /api/devices

Pair a new device. Generates a unique license key automatically.

**Headers:** `Authorization: Bearer <clerk_jwt>`

**Body:**
```json
{
  "device_name": "Living room display",
  "device_id": "ESP-7F3A9C"
}
```

`device_id` is optional — a random ID is generated if omitted.

**Response 201:**
```json
{
  "device": {
    "id": "uuid",
    "user_id": "uuid",
    "device_id": "ESP-7F3A9C",
    "device_name": "Living room display",
    "license_key": "DSPL-2K4M-9XQ1-7TBA",
    "firmware_version": "1.0.0",
    "last_seen_at": null
  }
}
```

### PUT /api/devices/:id

Rename a device.

**Headers:** `Authorization: Bearer <clerk_jwt>`

**Path parameter:** `id` — the device UUID

**Body:**
```json
{ "device_name": "Kitchen display" }
```

**Response 200:**
```json
{ "device": { ...updated device object... } }
```

### DELETE /api/devices/:id

Remove a device. The device's license key immediately becomes invalid.

**Headers:** `Authorization: Bearer <clerk_jwt>`

**Path parameter:** `id` — the device UUID

**Response 200:**
```json
{ "success": true }
```

### GET /api/devices/:userId/firmware/latest

Check for available OTA firmware updates for a device.

**Headers:** `X-License-Key: <device_license_key>`

**Path parameter:** `userId` — the Supabase user ID owning the device

**Response 200:**
```json
{
  "version": "1.0.1",
  "url": "https://api.example.com/api/devices/<userId>/firmware/download?version=1.0.1",
  "checksum": "",
  "releaseNotes": "Adds OTA support"
}
```

**Response 204:** No update available.

### GET /api/devices/:userId/firmware/download

Download the requested firmware binary.

**Headers:** `X-License-Key: <device_license_key>`

**Path parameter:** `userId` — the Supabase user ID owning the device

**Query parameters:**
- `version` (optional) — firmware version to download; latest active release is used if omitted

**Response 200:** Binary firmware stream

---

## Firmware Management

### GET /api/firmware

List firmware releases for the authenticated user.

**Headers:** `Authorization: Bearer <clerk_jwt>`

**Response 200:**
```json
{
  "firmware_versions": [
    {
      "id": "uuid",
      "user_id": "uuid",
      "version": "1.0.1",
      "download_path": "firmware.bin",
      "checksum": "",
      "release_notes": "Initial OTA release",
      "active": true,
      "created_at": "2026-06-03T12:00:00.000Z"
    }
  ]
}
```

### POST /api/firmware

Create a new firmware release for OTA updates.

**Headers:** `Authorization: Bearer <clerk_jwt>`

**Body:**
```json
{
  "version": "1.0.1",
  "download_path": "firmware.bin",
  "checksum": "",
  "release_notes": "Initial OTA release"
}
```

**Response 201:**
```json
{
  "firmware_version": {
    "id": "uuid",
    "user_id": "uuid",
    "version": "1.0.1",
    "download_path": "firmware.bin",
    "checksum": "",
    "release_notes": "Initial OTA release",
    "active": true,
    "created_at": "2026-06-03T12:00:00.000Z"
  }
}
```

---

## Display Data

### GET /api/display-data/:userId

Device-facing endpoint. Used by the ESP32 firmware. No JWT required — authenticated via `licenseKey`.

**Query parameters:**
- `licenseKey` (required) — the device's license key

**Example:**
```
GET /api/display-data/abc123?licenseKey=LK-xyz-789
```

**Response 200:**
```json
{
  "price": {
    "now": 142.5,
    "average": 118.3,
    "trend": "up"
  },
  "weather": {
    "temp": 12,
    "condition": "cloudy",
    "windSpeed": 6,
    "icon": "04d"
  },
  "news": [
    { "title": "Energipriserne stiger i Danmark", "url": "https://..." },
    { "title": "Nyt vejrsystem på vej", "url": "https://..." },
    { "title": "Grøn energi slår rekord", "url": "https://..." }
  ],
  "nextRefresh": 1800000
}
```

Fields are only included if the corresponding `show_*` preference is enabled.

Enabled NewsAPI failures return `newsError: { code, message }` instead of headlines. Codes include `unsupported_coverage` (Danish/Finnish: choose RSS), `missing_key`, `invalid_key`, `rate_limited`, `timeout`, `invalid_response`, and `unavailable`. RSS failures use the same safe diagnostic shape. A successful empty feed remains `news: []`.

Additional feeds saved in `news_feeds` (up to 20 `{ id, name, feed_url, item_limit }` entries) are returned in `newsFeeds`, keyed by feed ID: `{ items: [...] }` or `{ error: { code, message } }`. Each feed is fetched independently, so one failing feed does not affect the others. Place a feed on the display with the layout widget ID `news:<id>`; a widget whose feed was removed renders as unavailable.

Notion failures return `notionError: { code, message }`, including `data_source_required`, `invalid_data_source`, `invalid_configuration`, `invalid_token`, `access_denied`, `invalid_response`, `rate_limited`, `timeout`, or `unavailable`. Messages contain no provider response bodies, credentials or private IDs. Its configured token and database ID/link are saved through `POST /api/preferences/ev-credentials` with `{ "provider": "notion", "credentials": { "token": "ntn_...", "databaseId": "...", "dataSourceId": "..." } }`. `dataSourceId` is optional for single-source databases; status/property filters remain optional. The response reports configured status without credentials.

Monta's `todayKwh` is the energy reported for sessions created today in `display_timezone`, not energy metered since midnight. Monta session energy/start/duration and Zaptec session energy can be `null` when unknown. Zaptec `startDateTime` remains `null`; state observation 718 is not a timestamp. An explicitly disabled source is also suppressed in BMP/raw rendering.

`nextRefresh` is in milliseconds — the device should deep sleep for this duration.

**Response 401:** Missing or invalid `licenseKey`
**Response 403:** `licenseKey` does not belong to `userId`

### GET /api/preview

Auth-required version of the display data endpoint. Used by the dashboard to preview current data.

**Headers:** `Authorization: Bearer <clerk_jwt>`

**Response 200:** Same shape as `GET /api/display-data/:userId`

---

## Checkout (stub)

### POST /api/checkout

Stripe checkout session (not yet implemented).

**Response 501:**
```json
{
  "error": "Checkout not yet implemented",
  "message": "Stripe integration coming soon"
}
```

---

## Error Responses

All errors return JSON with an `error` field:

```json
{ "error": "Description of what went wrong" }
```

| Status | Meaning |
|---|---|
| 400 | Bad request — missing or invalid parameters |
| 401 | Unauthorized — missing or invalid auth |
| 403 | Forbidden — authenticated but not allowed |
| 404 | Not found |
| 429 | Rate limit exceeded (100 req/15 min per IP) |
| 500 | Internal server error |
| 501 | Not implemented |

---

## Rate Limits

- General API: **100 requests per 15 minutes** per IP
- `/api/display-data`: **10 requests per minute** per IP (device polling endpoint)

---

## Data Freshness (Server-Side Cache)

| Source | Cache TTL |
|---|---|
| Energinet (energy prices) | 15 minutes |
| OpenWeatherMap (weather) | 1 hour |
| NewsAPI (headlines) | 1 hour |

The cache is in-memory per server instance. Restarts clear the cache.

### Electricity price basis

`energy_price_settings` defaults to `{"mode":"spot"}`. To estimate variable consumer costs, send the complete consumer profile with `mode`, `gridGln` (13 digits), `gridChargeCodes` (1–5 unique required codes) and `retailerMarkupOre` (finite number, -1000 to 1000, excluding VAT). See [setup, JSON example and tariff sources](ELECTRICITY_PRICES.md). The response's optional `price.basis: "consumer"` identifies an estimate including VAT and excluding fixed fees; absent means untaxed spot. The average uses each interval's tariff, and unavailable required tariffs leave the price unavailable.
