// Setup snippets for the AI usage collector. The collector runs on the computer where
// Claude Code or Codex is used and pushes aggregates to this app's ingest endpoint.

const PLACEHOLDER_ENDPOINT = 'https://YOUR-DISPLAY-HOST/api/ai-usage/ingest';
export const COLLECTOR_REPOSITORY = 'https://github.com/scottlinddk/ESP32-e-ink-system.git';
const INSTALL_DIR = '~/.local/share/esp32-eink';
const COLLECTOR = `${INSTALL_DIR}/tools/ai-usage-collector/collector.mjs`;

export interface AiUsageSetup {
  endpoint: string;
  needsHttpsHost: boolean;
  install: string;
  init: string;
  cron: string;
  launchd: string;
  windows: string;
  statusLine: string;
}

/** Collector machine names: lowercase letters, digits, "-" and "_", as the server accepts. */
export function machineName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^[-_]+|-+$/g, '').slice(0, 32) || 'laptop';
}

export function aiUsageSetup(origin: string | undefined, timeZone: string, machine = 'laptop'): AiUsageSetup {
  let endpoint = PLACEHOLDER_ENDPOINT;
  try {
    const url = new URL(origin ?? '');
    const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    const local = host === 'localhost' || host.endsWith('.localhost') || host === '::1' || /^127\./.test(host);
    if (url.protocol === 'https:' && !url.username && !url.password && !local) endpoint = `${url.origin}/api/ai-usage/ingest`;
  } catch { /* SSR and development origins use an explicit deployment placeholder. */ }
  const name = machineName(machine);
  return {
    endpoint,
    needsHttpsHost: endpoint === PLACEHOLDER_ENDPOINT,
    install: `git clone --depth 1 ${COLLECTOR_REPOSITORY} ${INSTALL_DIR}`,
    init: `node ${COLLECTOR} init \\
  --url ${endpoint} \\
  --token PASTE_YOUR_AI_USAGE_TOKEN_HERE \\
  --machine ${name} --timezone ${timeZone}
node ${COLLECTOR} push`,
    cron: `*/15 * * * * node ${COLLECTOR} push >/dev/null 2>&1`,
    launchd: `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>dk.esp32-eink.ai-usage</string>
  <key>ProgramArguments</key><array>
    <string>/usr/bin/env</string><string>node</string>
    <string>/Users/YOU/.local/share/esp32-eink/tools/ai-usage-collector/collector.mjs</string><string>push</string>
  </array>
  <key>StartInterval</key><integer>900</integer>
</dict></plist>`,
    windows: `schtasks /Create /SC MINUTE /MO 15 /TN "AI usage collector" /TR "node %USERPROFILE%\\.local\\share\\esp32-eink\\tools\\ai-usage-collector\\collector.mjs push"`,
    statusLine: `{
  "statusLine": {
    "type": "command",
    "command": "node ${COLLECTOR} statusline"
  }
}`,
  };
}
