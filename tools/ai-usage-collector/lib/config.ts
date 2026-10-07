// Settings come from environment variables, falling back to a config file written by
// `collector.ts init` with owner-only permissions:
//   AI_USAGE_URL       ingest endpoint, https://<your app>/api/ai-usage/ingest
//   AI_USAGE_TOKEN     integration token from Integrations → AI usage (eau_…)
//   AI_USAGE_MACHINE   name for this computer, e.g. laptop (default: default)
//   AI_USAGE_TIMEZONE  IANA zone that decides "today" (default: this computer's zone);
//                      use the same zone as the display
import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir, platform } from 'node:os';
import { dirname, join } from 'node:path';
import { isRecord, type Config, type JsonRecord } from './types.ts';

export function configDir(env: NodeJS.ProcessEnv = process.env, home = homedir()): string {
  if (env.AI_USAGE_CONFIG_DIR) return env.AI_USAGE_CONFIG_DIR;
  if (platform() === 'win32' && env.APPDATA) return join(env.APPDATA, 'ai-usage-collector');
  return join(env.XDG_CONFIG_HOME || join(home, '.config'), 'ai-usage-collector');
}

const TOKEN = /^eau_[a-f0-9]{64}$/;
const MACHINE = /^[a-z0-9][a-z0-9_-]{0,31}$/;

export function validateConfig(config: Config): string[] {
  const problems: string[] = [];
  let url: URL | undefined;
  try { url = new URL(config.url ?? ''); } catch { problems.push('AI_USAGE_URL is missing or not a URL'); }
  if (url && url.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) problems.push('AI_USAGE_URL must use https');
  if (!TOKEN.test(config.token ?? '')) problems.push('AI_USAGE_TOKEN must be an eau_ integration token');
  if (!MACHINE.test(config.machine)) problems.push('AI_USAGE_MACHINE must be 1–32 lowercase letters, digits, "-" or "_"');
  try { new Intl.DateTimeFormat('en', { timeZone: config.timeZone }); } catch { problems.push('AI_USAGE_TIMEZONE is not an IANA time zone'); }
  return problems;
}

async function readJson(path: string): Promise<JsonRecord> {
  try {
    const value: unknown = JSON.parse(await readFile(path, 'utf8'));
    return isRecord(value) ? value : {};
  } catch { return {}; }
}

const text = (value: unknown): string | undefined => (typeof value === 'string' && value ? value : undefined);

export async function loadConfig(env: NodeJS.ProcessEnv = process.env): Promise<Config> {
  const file = await readJson(join(configDir(env), 'config.json'));
  return {
    url: env.AI_USAGE_URL || text(file.url),
    token: env.AI_USAGE_TOKEN || text(file.token),
    machine: env.AI_USAGE_MACHINE || text(file.machine) || 'default',
    timeZone: env.AI_USAGE_TIMEZONE || text(file.timeZone) || Intl.DateTimeFormat().resolvedOptions().timeZone,
  };
}

async function writePrivate(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, path);
  await chmod(path, 0o600).catch(() => {});
}

export async function saveConfig(config: Config, env: NodeJS.ProcessEnv = process.env): Promise<void> {
  await writePrivate(join(configDir(env), 'config.json'), config);
}

/** Status line throttling: when a push was last attempted and accepted, and what it sent. */
export interface State {
  statuslineAttemptAt?: number;
  statuslinePushedAt?: number;
  statuslineKey?: string;
}

export async function loadState(env: NodeJS.ProcessEnv = process.env): Promise<State> {
  const file = await readJson(join(configDir(env), 'state.json'));
  const time = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : undefined);
  return {
    statuslineAttemptAt: time(file.statuslineAttemptAt),
    statuslinePushedAt: time(file.statuslinePushedAt),
    statuslineKey: text(file.statuslineKey),
  };
}

export async function saveState(state: State, env: NodeJS.ProcessEnv = process.env): Promise<void> {
  await writePrivate(join(configDir(env), 'state.json'), state).catch(() => {});
}
