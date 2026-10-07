#!/usr/bin/env node
// AI usage collector. Reads Claude Code and Codex session files on this computer and
// pushes aggregate usage to the display server: per-model token counts for today and
// subscription quota windows. Prompts, responses, paths and project names never leave
// this computer. Dependency-free TypeScript, run directly by Node.js 22.18 or newer
// (built-in type stripping, no build step).
//
//   node collector.ts init --url https://host/api/ai-usage/ingest --token eau_… [--machine laptop] [--timezone Europe/Copenhagen]
//   node collector.ts push [--dry-run] [--only claude|codex]
//   node collector.ts statusline [--quiet]     (Claude Code status line command; reads JSON on stdin)
//
// See docs/AI_USAGE.md for scheduling and the status line setup.
import { stat } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { claudeProjectDirs, readClaudeUsage, statusLineLimits } from './lib/claudeCode.ts';
import { codexSessionDirs, readCodexUsage } from './lib/codex.ts';
import { loadConfig, loadState, saveConfig, saveState, validateConfig } from './lib/config.ts';
import type { Config, Limits, Payload } from './lib/types.ts';

const DAY_MS = 86_400_000;

async function anyDirectory(dirs: string[]): Promise<boolean> {
  for (const dir of dirs) if (await stat(dir).then((info) => info.isDirectory(), () => false)) return true;
  return false;
}
/** The status line runs after every response; push at most this often unless quota changed. */
const STATUSLINE_MIN_INTERVAL_MS = 60_000;
const STATUSLINE_MAX_INTERVAL_MS = 10 * 60_000;

const FLAGS = ['dry-run', 'quiet'] as const;
const VALUES = ['url', 'token', 'machine', 'timezone', 'only'] as const;
type Flag = typeof FLAGS[number];
type ValueOption = typeof VALUES[number];
export type Options = Partial<Record<Flag, true>> & Partial<Record<ValueOption, string>> & { only?: 'claude' | 'codex' };

const isFlag = (name: string): name is Flag => (FLAGS as readonly string[]).includes(name);
const isValueOption = (name: string): name is ValueOption => (VALUES as readonly string[]).includes(name);

export function parseArgs(argv: string[]): { command: string; options: Options } {
  const [command = 'help', ...rest] = argv;
  const options: Partial<Record<Flag, true>> & Partial<Record<ValueOption, string>> = {};
  for (let index = 0; index < rest.length; index++) {
    const arg = rest[index];
    if (!arg.startsWith('--')) throw new Error(`Unexpected argument: ${arg}`);
    const name = arg.slice(2);
    const value = rest[index + 1];
    if (isFlag(name)) options[name] = true;
    else if (isValueOption(name) && value !== undefined) { options[name] = value; index++; }
    else throw new Error(`Unknown or incomplete option: ${arg}`);
  }
  if (options.only !== undefined && options.only !== 'claude' && options.only !== 'codex') throw new Error('--only must be claude or codex');
  return { command, options: options as Options };
}

export interface BuildOptions {
  machine: string;
  timeZone: string;
  only?: 'claude' | 'codex';
  now?: Date;
  claudeDirs?: string[];
  codexDirs?: string[];
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** Builds the push payload from local files. Errors in one source do not stop the other. */
export async function buildPayload({ machine, timeZone, only, now = new Date(), claudeDirs = claudeProjectDirs(), codexDirs = codexSessionDirs() }: BuildOptions): Promise<{ payload: Payload; warnings: string[] }> {
  // Files untouched for a day cannot contain today's records in any time zone.
  const since = now.getTime() - DAY_MS;
  const providers: Payload['providers'] = {};
  const warnings: string[] = [];
  // A tool that is not installed is left out, so the display shows no empty row for it.
  if (only !== 'codex' && await anyDirectory(claudeDirs)) {
    try {
      const usage = await readClaudeUsage({ dirs: claudeDirs, timeZone, now, since });
      providers.claude = { usage };
    } catch (error) { warnings.push(`Claude Code: ${message(error)}`); }
  }
  if (only !== 'claude' && await anyDirectory(codexDirs)) {
    try {
      const { usage, limits } = await readCodexUsage({ dirs: codexDirs, timeZone, now, since });
      providers.openai = { usage, ...(limits ? { limits } : {}) };
    } catch (error) { warnings.push(`Codex: ${message(error)}`); }
  }
  return { payload: { machine, providers }, warnings };
}

export async function send(config: Pick<Config, 'url' | 'token'>, payload: Payload, timeoutMs = 10_000): Promise<string> {
  const response = await fetch(config.url ?? '', {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.token}`, 'Content-Type': 'application/json', 'User-Agent': 'ai-usage-collector/1.0' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(timeoutMs),
    redirect: 'error',
  });
  const text = (await response.text()).slice(0, 500);
  if (!response.ok) {
    let detail = text;
    try {
      const body: unknown = JSON.parse(text);
      if (body && typeof body === 'object' && 'error' in body && typeof body.error === 'string') detail = body.error;
    } catch { /* plain text */ }
    throw new Error(`Server answered ${response.status}: ${detail}`);
  }
  return text;
}

async function readStdin(maxBytes = 1_000_000): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    size += buffer.length;
    if (size > maxBytes) break;
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function statusText(limits: Limits | null): string {
  if (!limits) return '';
  return limits.windows.map((window) => `${window.window_minutes === 300 ? '5h' : '7d'} ${Math.round(window.used_percent)}%`).join(' | ');
}

/** Claude Code status line: print the quota and push it, throttled, without ever failing the line. */
async function statusline(config: Config, options: Options): Promise<void> {
  let input: unknown = null;
  try { input = JSON.parse(await readStdin()); } catch { /* not JSON */ }
  const limits = statusLineLimits(input);
  if (!options.quiet) process.stdout.write(`${statusText(limits)}\n`);
  if (!limits || validateConfig(config).length) return;
  const state = await loadState();
  const key = JSON.stringify(limits.windows);
  const now = Date.now();
  if (now - (state.statuslineAttemptAt ?? 0) < STATUSLINE_MIN_INTERVAL_MS) return;
  if (key === state.statuslineKey && now - (state.statuslinePushedAt ?? 0) < STATUSLINE_MAX_INTERVAL_MS) return;
  // Claude Code cancels a running status line when the next update arrives, so only the
  // attempt is recorded up front; the sent values are recorded once the server accepts them.
  await saveState({ ...state, statuslineAttemptAt: now });
  try {
    await send(config, { machine: config.machine, providers: { claude: { limits } } }, 3_000);
    await saveState({ ...state, statuslineAttemptAt: now, statuslinePushedAt: Date.now(), statuslineKey: key });
  } catch { /* the status line must stay quiet; the next run retries */ }
}

const HELP = `Usage:
  node collector.ts init --url <ingest URL> --token <eau_ token> [--machine <name>] [--timezone <IANA zone>]
  node collector.ts push [--dry-run] [--only claude|codex]
  node collector.ts statusline [--quiet]
Environment variables AI_USAGE_URL, AI_USAGE_TOKEN, AI_USAGE_MACHINE and AI_USAGE_TIMEZONE override the saved config.`;

export async function main(argv: string[] = process.argv.slice(2)): Promise<void> {
  const { command, options } = parseArgs(argv);
  const config = await loadConfig();
  if (options.machine) config.machine = options.machine;
  if (options.timezone) config.timeZone = options.timezone;

  if (command === 'init') {
    const next: Config = { ...config, url: options.url ?? config.url, token: options.token ?? config.token };
    const problems = validateConfig(next);
    if (problems.length) throw new Error(problems.join('\n'));
    await saveConfig({ url: next.url, token: next.token, machine: next.machine, timeZone: next.timeZone });
    console.log(`Saved. This computer reports as "${next.machine}", counting days in ${next.timeZone}.`);
    return;
  }
  if (command === 'statusline') return statusline(config, options);
  if (command === 'push') {
    const { payload, warnings } = await buildPayload({ machine: config.machine, timeZone: config.timeZone, only: options.only });
    for (const warning of warnings) console.error(`Warning: ${warning}`);
    if (options['dry-run']) { console.log(JSON.stringify(payload, null, 2)); return; }
    const problems = validateConfig(config);
    if (problems.length) throw new Error(`${problems.join('\n')}\nRun "node collector.ts init" or set the environment variables.`);
    if (!Object.keys(payload.providers).length) throw new Error('No usage source could be read.');
    console.log(await send(config, payload));
    return;
  }
  console.log(HELP);
  if (command !== 'help' && command !== '--help') process.exitCode = 1;
}

export function run(): void {
  main().catch((error: unknown) => { console.error(message(error)); process.exitCode = 1; });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) run();
