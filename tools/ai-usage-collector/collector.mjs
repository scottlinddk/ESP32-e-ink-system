#!/usr/bin/env node
// AI usage collector. Reads Claude Code and Codex session files on this computer and
// pushes aggregate usage to the display server: per-model token counts for today and
// subscription quota windows. Prompts, responses, paths and project names never leave
// this computer. Dependency-free; Node.js 20 or newer.
//
//   node collector.mjs init --url https://host/api/ai-usage/ingest --token eau_… [--machine laptop] [--timezone Europe/Copenhagen]
//   node collector.mjs push [--dry-run] [--only claude|codex]
//   node collector.mjs statusline [--quiet]     (Claude Code status line command; reads JSON on stdin)
//
// See docs/AI_USAGE.md for scheduling and the status line setup.
import { stat } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { claudeProjectDirs, readClaudeUsage, statusLineLimits } from './lib/claudeCode.mjs';
import { codexSessionDirs, readCodexUsage } from './lib/codex.mjs';
import { loadConfig, loadState, saveConfig, saveState, validateConfig } from './lib/config.mjs';

const DAY_MS = 86_400_000;

async function anyDirectory(dirs) {
  for (const dir of dirs) if (await stat(dir).then((info) => info.isDirectory(), () => false)) return true;
  return false;
}
/** The status line runs after every response; push at most this often unless quota changed. */
const STATUSLINE_MIN_INTERVAL_MS = 60_000;
const STATUSLINE_MAX_INTERVAL_MS = 10 * 60_000;

export function parseArgs(argv) {
  const [command = 'help', ...rest] = argv;
  const options = {};
  for (let index = 0; index < rest.length; index++) {
    const arg = rest[index];
    if (!arg.startsWith('--')) throw new Error(`Unexpected argument: ${arg}`);
    const name = arg.slice(2);
    if (['dry-run', 'quiet'].includes(name)) options[name] = true;
    else if (['url', 'token', 'machine', 'timezone', 'only'].includes(name) && rest[index + 1] !== undefined) options[name] = rest[++index];
    else throw new Error(`Unknown or incomplete option: ${arg}`);
  }
  if (options.only && !['claude', 'codex'].includes(options.only)) throw new Error('--only must be claude or codex');
  return { command, options };
}

/** Builds the push payload from local files. Errors in one source do not stop the other. */
export async function buildPayload({ machine, timeZone, only, now = new Date(), claudeDirs = claudeProjectDirs(), codexDirs = codexSessionDirs() }) {
  // Files untouched for a day cannot contain today's records in any time zone.
  const since = now.getTime() - DAY_MS;
  const providers = {};
  const warnings = [];
  // A tool that is not installed is left out, so the display shows no empty row for it.
  if (only !== 'codex' && await anyDirectory(claudeDirs)) {
    try {
      const usage = await readClaudeUsage({ dirs: claudeDirs, timeZone, now, since });
      providers.claude = { usage };
    } catch (error) { warnings.push(`Claude Code: ${error.message}`); }
  }
  if (only !== 'claude' && await anyDirectory(codexDirs)) {
    try {
      const { usage, limits } = await readCodexUsage({ dirs: codexDirs, timeZone, now, since });
      providers.openai = { usage, ...(limits ? { limits } : {}) };
    } catch (error) { warnings.push(`Codex: ${error.message}`); }
  }
  return { payload: { machine, providers }, warnings };
}

export async function send(config, payload, timeoutMs = 10_000) {
  const response = await fetch(config.url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.token}`, 'Content-Type': 'application/json', 'User-Agent': 'ai-usage-collector/1.0' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(timeoutMs),
    redirect: 'error',
  });
  const text = (await response.text()).slice(0, 500);
  if (!response.ok) {
    let message = text;
    try { message = JSON.parse(text).error ?? text; } catch { /* plain text */ }
    throw new Error(`Server answered ${response.status}: ${message}`);
  }
  return text;
}

async function readStdin(maxBytes = 1_000_000) {
  const chunks = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    size += chunk.length;
    if (size > maxBytes) break;
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function statusText(limits) {
  if (!limits) return '';
  return limits.windows.map((window) => `${window.window_minutes === 300 ? '5h' : '7d'} ${Math.round(window.used_percent)}%`).join(' | ');
}

/** Claude Code status line: print the quota and push it, throttled, without ever failing the line. */
async function statusline(config, options) {
  let input = null;
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
  node collector.mjs init --url <ingest URL> --token <eau_ token> [--machine <name>] [--timezone <IANA zone>]
  node collector.mjs push [--dry-run] [--only claude|codex]
  node collector.mjs statusline [--quiet]
Environment variables AI_USAGE_URL, AI_USAGE_TOKEN, AI_USAGE_MACHINE and AI_USAGE_TIMEZONE override the saved config.`;

export async function main(argv = process.argv.slice(2)) {
  const { command, options } = parseArgs(argv);
  const config = await loadConfig();
  if (options.machine) config.machine = options.machine;
  if (options.timezone) config.timeZone = options.timezone;

  if (command === 'init') {
    const next = { ...config, url: options.url ?? config.url, token: options.token ?? config.token };
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
    if (problems.length) throw new Error(`${problems.join('\n')}\nRun "node collector.mjs init" or set the environment variables.`);
    if (!Object.keys(payload.providers).length) throw new Error('No usage source could be read.');
    console.log(await send(config, payload));
    return;
  }
  console.log(HELP);
  if (command !== 'help' && command !== '--help') process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
