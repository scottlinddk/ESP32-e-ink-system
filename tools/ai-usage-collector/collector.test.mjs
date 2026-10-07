import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildPayload, parseArgs, send } from './collector.mjs';
import { statusLineLimits } from './lib/claudeCode.mjs';
import { MAX_MODELS, modelList } from './lib/files.mjs';
import { validateConfig } from './lib/config.mjs';

const NOW = new Date('2026-10-07T10:00:00Z');
const TOKEN = `eau_${'a'.repeat(64)}`;

async function fixture(files) {
  const root = await mkdtemp(join(tmpdir(), 'ai-usage-'));
  for (const [path, lines] of Object.entries(files)) {
    await mkdir(join(root, path, '..'), { recursive: true });
    await writeFile(join(root, path), lines.map((line) => typeof line === 'string' ? line : JSON.stringify(line)).join('\n'));
  }
  return root;
}

const assistant = (id, requestId, timestamp, usage, model = 'claude-opus-5-5') => ({
  type: 'assistant', timestamp, requestId, message: { id, model, usage, content: [{ type: 'text', text: 'private prompt text' }] },
});

test('Claude Code: counts each message once, only today, with 1-hour cache writes', async () => {
  const usage = { input_tokens: 10, output_tokens: 20, cache_read_input_tokens: 100, cache_creation_input_tokens: 50,
    cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 50 } };
  const root = await fixture({
    'projects/repo/session.jsonl': [
      assistant('msg_1', 'req_1', '2026-10-07T08:00:00Z', usage),
      assistant('msg_1', 'req_1', '2026-10-07T08:00:01Z', usage), // second content block, same usage
      assistant('msg_2', 'req_2', '2026-10-07T09:00:00Z', { input_tokens: 1, output_tokens: 2 }, 'claude-sonnet-5-5'),
      assistant('msg_3', 'req_3', '2026-10-06T21:00:00Z', usage), // yesterday in Copenhagen
      '{"type":"assistant", truncated',
      { type: 'user', timestamp: '2026-10-07T08:00:00Z', message: { content: 'hello' } },
    ],
  });
  try {
    const { payload } = await buildPayload({ machine: 'laptop', timeZone: 'Europe/Copenhagen', now: NOW, claudeDirs: [join(root, 'projects')], codexDirs: [join(root, 'missing')] });
    assert.deepEqual(payload, { machine: 'laptop', providers: { claude: { usage: { day: '2026-10-07', models: [
      { model: 'claude-opus-5-5', input_tokens: 10, output_tokens: 20, cache_write_tokens: 50, cache_write_1h_tokens: 50, cache_read_tokens: 100 },
      { model: 'claude-sonnet-5-5', input_tokens: 1, output_tokens: 2, cache_write_tokens: 0, cache_write_1h_tokens: 0, cache_read_tokens: 0 },
    ] } } } });
    assert.ok(!JSON.stringify(payload).includes('private prompt text'));
    assert.ok(!JSON.stringify(payload).includes('repo'));
  } finally { await rm(root, { recursive: true }); }
});

test('Codex: counts only increases of the cumulative totals and keeps the newest rate limits', async () => {
  const event = (timestamp, total, rateLimits) => ({ timestamp, type: 'event_msg', payload: { type: 'token_count',
    info: total ? { total_token_usage: total, last_token_usage: total } : null, ...(rateLimits ? { rate_limits: rateLimits } : {}) } });
  const root = await fixture({
    'sessions/2026/10/07/rollout-a.jsonl': [
      { timestamp: '2026-10-06T20:00:00Z', type: 'session_meta', payload: { model: 'gpt-6-sol' } },
      event('2026-10-06T20:00:00Z', { input_tokens: 1000, cached_input_tokens: 400, output_tokens: 10 }), // yesterday
      event('2026-10-07T08:00:00Z', { input_tokens: 1500, cached_input_tokens: 600, output_tokens: 30 },
        { primary: { used_percent: 12, window_minutes: 299, resets_in_seconds: 3600 }, secondary: { used_percent: 40, window_minutes: 10079, resets_at: 1791700000 } }),
      event('2026-10-07T08:00:05Z', { input_tokens: 1500, cached_input_tokens: 600, output_tokens: 30 }), // repeated event
      event('2026-10-07T08:30:00Z', null),
    ],
    'sessions/2026/10/07/rollout-b.jsonl': [
      { timestamp: '2026-10-07T09:00:00Z', type: 'turn_context', payload: { model: 'gpt-6-luna' } },
      event('2026-10-07T09:00:00Z', { input_tokens: 100, cached_input_tokens: 0, output_tokens: 5 },
        { primary: { used_percent: 15.04, window_minutes: 299, resets_at: '2026-10-07T13:00:00Z' } }),
    ],
  });
  try {
    const { payload } = await buildPayload({ machine: 'laptop', timeZone: 'Europe/Copenhagen', now: NOW, claudeDirs: [join(root, 'missing')], codexDirs: [join(root, 'sessions')] });
    assert.equal(payload.providers.claude, undefined);
    const openai = payload.providers.openai;
    assert.deepEqual(openai.usage.models, [
      { model: 'gpt-6-sol', input_tokens: 300, output_tokens: 20, cache_write_tokens: 0, cache_write_1h_tokens: 0, cache_read_tokens: 200 },
      { model: 'gpt-6-luna', input_tokens: 100, output_tokens: 5, cache_write_tokens: 0, cache_write_1h_tokens: 0, cache_read_tokens: 0 },
    ]);
    assert.deepEqual(openai.limits, { observed_at: '2026-10-07T09:00:00Z', windows: [{ window_minutes: 299, used_percent: 15, resets_at: '2026-10-07T13:00:00Z' }] });
  } finally { await rm(root, { recursive: true }); }
});

test('status line: reads Claude Code rate_limits and tolerates missing data', () => {
  const limits = statusLineLimits({ rate_limits: { five_hour: { used_percentage: 23.46, resets_at: 1791400000 }, seven_day: { used_percentage: 41.2, resets_at: 1791800000 } } }, NOW);
  assert.deepEqual(limits, { observed_at: '2026-10-07T10:00:00Z', windows: [
    { window_minutes: 300, used_percent: 23.5, resets_at: new Date(1791400000 * 1000).toISOString().replace('.000Z', 'Z') },
    { window_minutes: 10080, used_percent: 41.2, resets_at: new Date(1791800000 * 1000).toISOString().replace('.000Z', 'Z') },
  ] });
  assert.equal(statusLineLimits({ model: { id: 'x' } }), null);
  assert.equal(statusLineLimits(null), null);
});

test('model list: largest first, overflow summed as unpriced "other"', () => {
  const models = new Map(Array.from({ length: MAX_MODELS + 3 }, (_, index) => [`model-${index}`, { input: index + 1, output: 0, cacheWrite: 0, cacheWrite1h: 0, cacheRead: 0 }]));
  models.set('bad id with spaces', { input: 1000, output: 0, cacheWrite: 0, cacheWrite1h: 0, cacheRead: 0 });
  const list = modelList(models);
  assert.equal(list.length, MAX_MODELS);
  assert.equal(list.at(-1).model, 'other');
  assert.equal(list.reduce((sum, entry) => sum + entry.input_tokens, 0), 1000 + ((MAX_MODELS + 3) * (MAX_MODELS + 4)) / 2);
});

test('config and arguments are validated', () => {
  assert.deepEqual(validateConfig({ url: 'https://example.com/api/ai-usage/ingest', token: TOKEN, machine: 'laptop', timeZone: 'Europe/Copenhagen' }), []);
  const problems = validateConfig({ url: 'http://example.com/x', token: 'ewh_x', machine: 'My Laptop', timeZone: 'Mars/Base' });
  assert.equal(problems.length, 4);
  assert.deepEqual(parseArgs(['push', '--dry-run', '--only', 'codex']), { command: 'push', options: { 'dry-run': true, only: 'codex' } });
  assert.throws(() => parseArgs(['push', '--only', 'gemini']), /claude or codex/);
  assert.throws(() => parseArgs(['push', '--token']), /incomplete/);
});

test('send: posts with the integration token and reports server errors', async () => {
  const received = [];
  const server = createServer((request, response) => {
    let body = '';
    request.on('data', (chunk) => { body += chunk; });
    request.on('end', () => {
      received.push({ auth: request.headers.authorization, body: JSON.parse(body) });
      const ok = received.length === 1;
      response.writeHead(ok ? 200 : 400, { 'content-type': 'application/json' });
      response.end(JSON.stringify(ok ? { machine: 'laptop', providers: ['claude'] } : { error: 'usage.day must be a date' }));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const config = { url: `http://127.0.0.1:${server.address().port}/api/ai-usage/ingest`, token: TOKEN };
  try {
    const payload = { machine: 'laptop', providers: { claude: { usage: { day: '2026-10-07', models: [] } } } };
    assert.match(await send(config, payload), /laptop/);
    assert.deepEqual(received[0], { auth: `Bearer ${TOKEN}`, body: payload });
    await assert.rejects(send(config, payload), /400: usage.day must be a date/);
  } finally { server.close(); }
});
