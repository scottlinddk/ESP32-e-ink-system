# API Reference

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
  ]
}
```

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
