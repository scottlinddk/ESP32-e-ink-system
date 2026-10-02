# Custom sensors and Home Assistant

Apply `backend/src/db/migrations/014_custom_webhook.sql` before deploying. The
new `custom_webhooks` table has row-level security and no client policies. Use
the backend service-role database credential; alternate PostgREST installations
must grant their dedicated backend role table access and RLS bypass. Do not
grant the table to anonymous or authenticated browser roles.

On Integrations, create an integration token under **Home Assistant and custom
sensors**, copy it into your integration's secret store, and enable the source.
Set its freshness lifetime (1–1440 minutes). Add **Custom sensors** to the layout
and save. The server stores a SHA-256 hash of the random token, not its plaintext.
The creation response shows the token once; status APIs never return it or its
hash. **Replace token** invalidates the old token; **Revoke token** stops incoming
updates. Both clear previously received readings. Tokens are scoped to one user.

The integration sends data out from Home Assistant to the hosted backend. It
does not require exposing Home Assistant or fetching private LAN URLs.

## HTTP contract

Browser-facing routes include `/api`; direct Express routes omit that prefix.

| Method and path | Authentication | Result |
|---|---|---|
| `GET /api/custom-webhook` | Clerk bearer token | Configuration and freshness status, no secrets |
| `POST /api/custom-webhook/token` | Clerk bearer token | New token, replacing any previous token |
| `DELETE /api/custom-webhook/token` | Clerk bearer token | Revoke token and clear readings |
| `POST /api/custom-webhook/ingest` | Integration bearer token | Store a validated sensor snapshot |

Send `Content-Type: application/json` and `Authorization: Bearer YOUR_TOKEN`:

```json
{
  "rows": [
    { "label": "Kitchen", "value": "21.5", "unit": "°C" },
    { "label": "Front door", "value": "Closed" }
  ]
}
```

There must be 1–12 rows with unique labels. `label` (1–40 characters), `value`
(1–80), and optional `unit` (0–16) are single-line strings. Strings are normalized
to NFC and trimmed; controls and malformed Unicode are rejected. Fields are
plain text, never HTML. Numeric readings must be sent as strings. Unrecognized
fields, including user IDs, are rejected. Request bodies are limited to 10 KiB.
The existing application rate limiter applies when configured.

An optional `observed_at` accepts a UTC timestamp such as
`2026-09-28T12:00:00Z` or `2026-09-28T12:00:00.123Z`. Invalid and future dates are
rejected. When omitted, it defaults to server receipt time, indicating a newly
received snapshot rather than independently verified sensor observation time.
The server always sets `received_at` itself. Freshness expires at the earlier
of observation/receipt plus your configured lifetime; at the exact boundary,
the state becomes `stale`. An old observation does not become fresh just because
it was uploaded again. Each successful update replaces all rows.

Expired values remain visible with **STALE** at the beginning of the widget's
heading. Missing/revoked data shows **No sensor data**. A disabled source is
blank. JSON, BMP and raw Bluetooth output use the same state. These are evaluated
when an image is generated: an e-ink panel retains its previous image until its
next successful transfer. A webhook does not itself trigger a Bluetooth push.

Successful ingestion returns receipt/observation times and row count. Invalid or
revoked tokens return `401`, invalid payloads `400`, and oversized bodies `413`.
Token replacement/revocation is rechecked in the database update, including for
requests already in flight.

## Home Assistant example

Add to `secrets.yaml` (use your token and deployed HTTPS URL):

```yaml
eink_webhook_url: "https://YOUR-DISPLAY-HOST/api/custom-webhook/ingest"
eink_webhook_authorization: "Bearer PASTE_YOUR_INTEGRATION_TOKEN_HERE"
```

Add this REST command to `configuration.yaml`, replacing the entity IDs with
your own. The JSON filter correctly escapes quotes and other characters in
sensor states:

```yaml
rest_command:
  update_eink_sensors:
    url: !secret eink_webhook_url
    method: post
    headers:
      authorization: !secret eink_webhook_authorization
    content_type: "application/json"
    timeout: 10
    verify_ssl: true
    payload: >-
      {{ {"rows": [
        {"label": "Kitchen", "value": states('sensor.kitchen_temperature'), "unit": "°C"},
        {"label": "Front door", "value": states('binary_sensor.front_door')}
      ]} | to_json }}
```

Restart Home Assistant after configuring the REST command. In `automations.yaml`,
send a snapshot every five minutes (choose a freshness lifetime longer than this
interval):

```yaml
- alias: "Update e-ink sensor snapshot"
  triggers:
    - trigger: time_pattern
      minutes: "/5"
  actions:
    - action: rest_command.update_eink_sensors
  mode: single
```

Test `rest_command.update_eink_sensors` in Home Assistant's developer actions,
then use **Refresh status** on Integrations. Do not send a Clerk session token
to this endpoint or publish your integration token in configuration examples.

References: [RESTful Command](https://www.home-assistant.io/integrations/rest_command/),
[time-pattern triggers](https://www.home-assistant.io/docs/automation/trigger/#time-pattern-trigger),
[JSON templates](https://www.home-assistant.io/template-functions/to_json/),
and [YAML secrets](https://www.home-assistant.io/docs/configuration/secrets/).
