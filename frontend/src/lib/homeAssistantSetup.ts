const PLACEHOLDER_ENDPOINT = 'https://YOUR-DISPLAY-HOST/api/custom-webhook/ingest';

/** Browser API requests are same-origin; the Vite proxy target is not a public URL. */
export function homeAssistantSetup(origin?: string) {
  let endpoint = PLACEHOLDER_ENDPOINT;
  try {
    const url = new URL(origin ?? '');
    const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    const local = host === 'localhost' || host.endsWith('.localhost') || host === '::1'
      || /^127\./.test(host);
    if (url.protocol === 'https:' && !url.username && !url.password && !local) {
      endpoint = `${url.origin}/api/custom-webhook/ingest`;
    }
  } catch { /* SSR and development origins use an explicit deployment placeholder. */ }
  return {
    endpoint,
    needsHttpsHost: endpoint === PLACEHOLDER_ENDPOINT,
    secrets: `eink_webhook_url: ${JSON.stringify(endpoint)}
eink_webhook_authorization: "Bearer PASTE_YOUR_INTEGRATION_TOKEN_HERE"`,
    restCommand: `rest_command:
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
      ]} | to_json }}`,
    automation: `- alias: "Update e-ink sensor snapshot"
  triggers:
    - trigger: time_pattern
      minutes: "/5"
  actions:
    - action: rest_command.update_eink_sensors
  mode: single`,
  };
}
