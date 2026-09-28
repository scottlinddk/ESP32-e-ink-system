import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { createPoller, failureDelay, retryAfterSeconds } from './display-client.mjs';

const token = `einkd_${'a'.repeat(43)}`;
const bytes = Buffer.alloc(8 * 64, 255);
const digest = createHash('sha256').update(bytes).digest('hex');
const headers = { 'X-Display-Width': '64', 'X-Display-Height': '64', 'X-Display-Rotation': '0', 'X-Display-Row-Bytes': '8', 'X-Display-Encoding': 'mono-msb-white1', 'X-Refresh-Mode': 'full', 'X-Image-SHA256': digest, ETag: `"${digest}"`, 'Retry-After': '120' };

async function setup(t, handle) {
  const directory = await mkdtemp(join(tmpdir(), 'eink-client-'));
  const server = createServer(handle);
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  t.after(async () => { await new Promise((done) => server.close(done)); await rm(directory, { recursive: true, force: true }); });
  const options = { baseUrl: `http://127.0.0.1:${server.address().port}`, deviceId: 'device-one', token, width: 64, height: 64, format: 'raw', outputFile: join(directory, 'image.bin'), allowHttpLocalhost: true };
  return { options, directory };
}
async function body(request) { const chunks = []; for await (const chunk of request) chunks.push(chunk); return JSON.parse(Buffer.concat(chunks).toString()); }

test('file-only client writes atomically, suppresses unchanged downloads and never claims a panel update', async (t) => {
  const reports = []; const etags = [];
  const { options } = await setup(t, async (req, res) => {
    assert.equal(req.headers.authorization, `Bearer ${token}`);
    if (req.url.endsWith('/heartbeat')) { reports.push(await body(req)); res.end('{"accepted":true}'); return; }
    etags.push(req.headers['if-none-match']); res.writeHead(req.headers['if-none-match'] ? 304 : 200, headers); res.end(bytes);
  });
  const poller = createPoller(options);
  assert.equal((await poller.pollOnce()).kind, 'updated');
  assert.deepEqual(await readFile(options.outputFile), bytes);
  assert.equal((await poller.pollOnce()).kind, 'unchanged');
  assert.deepEqual(etags, [undefined, `"${digest}"`]);
  assert.deepEqual(reports, [{ firmware_version: 'display-bridge/1.0' }, { firmware_version: 'display-bridge/1.0' }]);
  await writeFile(options.outputFile, 'corrupted');
  assert.equal((await poller.pollOnce()).kind, 'updated');
});

test('driver ACK happens only after executable completion and is retained on later 304/quiet heartbeats', async (t) => {
  const reports = []; let mode = 200;
  const { options, directory } = await setup(t, async (req, res) => {
    if (req.url.endsWith('/heartbeat')) { reports.push(await body(req)); res.end('{"accepted":true}'); return; }
    res.writeHead(mode, headers); res.end(mode === 200 ? bytes : undefined);
  });
  const script = join(directory, 'driver.mjs'); const marker = join(directory, 'applied.txt');
  await writeFile(script, 'import {writeFile} from "node:fs/promises"; await writeFile(process.argv[3], process.argv[2]);');
  const poller = createPoller({ ...options, driver: { executable: process.execPath, args: [script, '{file}', marker] } });
  assert.equal((await poller.pollOnce()).kind, 'updated'); assert.equal(await readFile(marker, 'utf8'), options.outputFile);
  mode = 304; assert.equal((await poller.pollOnce()).kind, 'unchanged');
  mode = 204; assert.equal((await poller.pollOnce()).kind, 'quiet');
  assert.deepEqual(reports.map((r) => r.last_applied_hash), [digest, digest, digest]);
});

test('a failed driver is retried without acknowledging or caching the frame', async (t) => {
  let reports = 0; const etags = [];
  const { options, directory } = await setup(t, (req, res) => {
    if (req.url.endsWith('/heartbeat')) { reports++; res.end('{"accepted":true}'); return; }
    etags.push(req.headers['if-none-match']); res.writeHead(200, headers); res.end(bytes);
  });
  const script = join(directory, 'failed.mjs'); await writeFile(script, 'process.exit(1)');
  const poller = createPoller({ ...options, driver: { executable: process.execPath, args: [script, '{file}'] } });
  await assert.rejects(poller.pollOnce(), /not acknowledged/);
  await assert.rejects(poller.pollOnce(), /not acknowledged/);
  assert.equal(reports, 0); assert.deepEqual(etags, [undefined, undefined]);
});

test('rejects mismatched dimensions, hashes and lengths before replacing a saved image', async (t) => {
  let mode = 'dimensions';
  const { options } = await setup(t, (_req, res) => {
    res.writeHead(200, { ...headers, ...(mode === 'dimensions' ? { 'X-Display-Width': '128' } : {}) });
    res.end(mode === 'hash' ? Buffer.alloc(512) : bytes);
  });
  await writeFile(options.outputFile, 'previous'); const poller = createPoller(options);
  await assert.rejects(poller.pollOnce(), /dimensions/); mode = 'hash';
  await assert.rejects(poller.pollOnce(), /hash/);
  assert.equal(await readFile(options.outputFile, 'utf8'), 'previous');
});

test('rejects redirects and stops on revoked credentials', async (t) => {
  let status = 302; let requests = 0;
  const { options } = await setup(t, (_req, res) => { requests++; res.writeHead(status, { Location: '/stolen' }); res.end(); });
  const poller = createPoller(options);
  await assert.rejects(poller.pollOnce(), /failed/); assert.equal(requests, 1);
  status = 401;
  await assert.rejects(poller.pollOnce(), (error) => error.fatal === true && /token rejected/.test(error.message));
});

test('honors bounded retry hints and exponential failure backoff', async (t) => {
  assert.equal(retryAfterSeconds('99999999'), 86400); assert.equal(retryAfterSeconds('0'), 1);
  assert.equal(retryAfterSeconds('invalid'), 60); assert.equal(retryAfterSeconds('Wed, 01 Oct 2025 12:02:00 GMT', Date.parse('2025-10-01T12:00:00Z')), 120);
  assert.deepEqual([0, 1, 2, 20].map((count) => failureDelay(count)), [15, 30, 60, 3600]);
  assert.equal(failureDelay(2, 7200), 7200);
  const { options } = await setup(t, (_req, res) => { res.writeHead(429, { 'Retry-After': '300' }); res.end(); });
  await assert.rejects(createPoller(options).pollOnce(), (error) => error.retryAfter === 300);
});
