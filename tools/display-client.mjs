#!/usr/bin/env node
// Dependency-free reference bridge. A driver is an executable + argument array,
// never a shell command. File-only mode intentionally sends no applied-image ACK.
import { createHash, randomBytes } from 'node:crypto';
import { readFile, writeFile, rename, mkdir, unlink } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
export class DeliveryError extends Error {
  constructor(message, retryAfter = 0, fatal = false) { super(message); this.retryAfter = retryAfter; this.fatal = fatal; }
}
export function retryAfterSeconds(value, now = Date.now()) {
  const seconds = /^\d+$/.test(value ?? '') ? Number(value) : Math.ceil((Date.parse(value ?? '') - now) / 1000);
  return Number.isFinite(seconds) ? Math.min(86400, Math.max(1, seconds)) : 60;
}
export function failureDelay(failures, retryAfter = 0) {
  return Math.min(86400, Math.max(15, retryAfter, Math.min(3600, 15 * 2 ** Math.min(failures, 8))));
}

async function boundedBody(response, maximum = 512 * 1024) {
  if (Number(response.headers.get('content-length')) > maximum) throw new DeliveryError('Response is too large');
  const chunks = []; let size = 0;
  if (!response.body) throw new DeliveryError('Missing response body');
  for await (const chunk of response.body) {
    size += chunk.byteLength;
    if (size > maximum) throw new DeliveryError('Response is too large');
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

async function atomicWrite(filename, bytes) {
  await mkdir(dirname(filename), { recursive: true });
  const temporary = `${filename}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
  try { await writeFile(temporary, bytes, { flag: 'wx', mode: 0o600 }); await rename(temporary, filename); }
  finally { await unlink(temporary).catch(() => {}); }
}

async function runDriver(driver, file, frame) {
  const arguments_ = driver.args.map((arg) => arg.replaceAll('{file}', file).replaceAll('{width}', String(frame.width)).replaceAll('{height}', String(frame.height)).replaceAll('{rotation}', String(frame.rotation)));
  // The display process does not need access to the server credential.
  const environment = { ...process.env }; delete environment.DEVICE_TOKEN;
  await new Promise((resolveDriver, reject) => {
    const child = spawn(driver.executable, arguments_, { shell: false, windowsHide: true, stdio: 'ignore', env: environment, timeout: driver.timeoutSeconds * 1000, killSignal: 'SIGKILL' });
    child.once('error', () => reject(new DeliveryError('Display driver could not run')));
    child.once('close', (code) => code === 0 ? resolveDriver() : reject(new DeliveryError('Display driver failed; image was not acknowledged')));
  });
}

export function createPoller(options) {
  const base = new URL(options.baseUrl);
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(base.hostname);
  if (base.protocol !== 'https:' && !(options.allowHttpLocalhost && base.protocol === 'http:' && local)) throw new Error('The API URL must use HTTPS');
  if (base.username || base.password || base.search || base.hash) throw new Error('Invalid API URL');
  if (!/^[A-Za-z0-9-]{1,100}$/.test(options.deviceId) || !/^einkd_[A-Za-z0-9_-]{43}$/.test(options.token)) throw new Error('Invalid device ID or token');
  const format = options.format ?? 'bmp';
  if (!['bmp', 'raw'].includes(format)) throw new Error('Format must be bmp or raw');
  const frame = { width: options.width, height: options.height, rotation: options.rotation ?? 0 };
  if (!Number.isInteger(frame.width) || !Number.isInteger(frame.height) || frame.width < 64 || frame.width > 1600 || frame.height < 64 || frame.height > 1600 || frame.width * frame.height > 1920000 || ![0, 90, 180, 270].includes(frame.rotation)) throw new Error('Configure supported display dimensions and rotation');
  const file = resolve(options.outputFile ?? `frame.${format === 'bmp' ? 'bmp' : 'bin'}`);
  const driver = options.driver ? { ...options.driver, timeoutSeconds: options.driver.timeoutSeconds ?? 300 } : undefined;
  if (driver && (typeof driver.executable !== 'string' || !driver.executable || !Array.isArray(driver.args) || driver.args.some((arg) => typeof arg !== 'string') || !driver.args.some((arg) => arg.includes('{file}')))) throw new Error('Driver needs an executable and JSON string arguments containing {file}');
  if (driver && (!Number.isInteger(driver.timeoutSeconds) || driver.timeoutSeconds < 10 || driver.timeoutSeconds > 600)) throw new Error('Driver timeout must be an integer from 10 to 600 seconds');
  const version = options.firmwareVersion ?? 'display-bridge/1.0';
  if (!/^[A-Za-z0-9][A-Za-z0-9._+/-]{0,63}$/.test(version)) throw new Error('Invalid firmware version');
  const endpoint = `${base.href.replace(/\/$/, '')}/device-feed/${encodeURIComponent(options.deviceId)}`;
  let etag; let downloadedHash; let appliedHash;
  const request = async (path, init = {}) => {
    let response;
    try {
      response = await fetch(`${endpoint}${path}`, { ...init, headers: { Authorization: `Bearer ${options.token}`, ...init.headers }, redirect: 'error', signal: AbortSignal.timeout(20000) });
    } catch { throw new DeliveryError('Device request failed or timed out'); }
    if (response.status === 401 || response.status === 403) {
      await response.body?.cancel();
      throw new DeliveryError('Device token rejected; create a new token in Devices', 0, true);
    }
    if (![200, 204, 304].includes(response.status)) {
      await response.body?.cancel();
      throw new DeliveryError(`Device request failed (${response.status})`, retryAfterSeconds(response.headers.get('retry-after')));
    }
    return response;
  };
  const heartbeat = async () => {
    const response = await request('/heartbeat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ firmware_version: version, ...(appliedHash ? { last_applied_hash: appliedHash } : {}) }) });
    if (response.status !== 200) throw new DeliveryError('Heartbeat was not accepted');
    const body = await boundedBody(response, 8192);
    let accepted = false;
    try { accepted = JSON.parse(body.toString()).accepted === true; } catch { /* generic error below */ }
    if (!accepted) throw new DeliveryError('Heartbeat was not accepted');
  };
  return {
    async pollOnce() {
      // Never accept 304 when the locally cached file has disappeared/changed.
      if (etag) {
        try { if (hash(await readFile(file)) !== downloadedHash) etag = undefined; }
        catch { etag = undefined; }
      }
      const response = await request(`/frame?format=${format}`, { headers: etag ? { 'If-None-Match': etag } : {} });
      // Count download, driver and heartbeat time against the server's cadence.
      // A slow apply must not add a second full page duration before the next poll.
      const deadline = performance.now() + retryAfterSeconds(response.headers.get('retry-after')) * 1000;
      const result = (kind) => ({ kind, retryAfter: Math.max(1, Math.ceil((deadline - performance.now()) / 1000)) });
      if (response.status === 204) { await heartbeat(); return result('quiet'); }
      for (const [name, expected] of Object.entries({ width: frame.width, height: frame.height, rotation: frame.rotation, 'row-bytes': Math.ceil(frame.width / 8), encoding: 'mono-msb-white1' })) {
        if (response.headers.get(`x-display-${name}`) !== String(expected)) { await response.body?.cancel(); throw new DeliveryError('Frame dimensions or encoding do not match this display'); }
      }
      if (response.headers.get('x-refresh-mode') !== 'full') { await response.body?.cancel(); throw new DeliveryError('Unsupported refresh mode'); }
      if (response.status === 304) {
        if (!etag || response.headers.get('etag') !== etag) throw new DeliveryError('Unexpected unchanged-frame response');
        await heartbeat(); return result('unchanged');
      }
      const bytes = await boundedBody(response);
      const digest = hash(bytes);
      if (response.headers.get('x-image-sha256') !== digest || response.headers.get('etag') !== `"${digest}"`) throw new DeliveryError('Frame hash does not match');
      if (format === 'raw') {
        if (bytes.length !== Math.ceil(frame.width / 8) * frame.height) throw new DeliveryError('Invalid raw image length');
      } else {
        const length = 62 + Math.ceil(frame.width / 32) * 4 * frame.height;
        if (bytes.length !== length || bytes.toString('ascii', 0, 2) !== 'BM' || bytes.readUInt32LE(2) !== length || bytes.readUInt32LE(10) !== 62 || bytes.readUInt32LE(14) !== 40 || bytes.readInt32LE(18) !== frame.width || bytes.readInt32LE(22) !== -frame.height || bytes.readUInt16LE(26) !== 1 || bytes.readUInt16LE(28) !== 1 || bytes.readUInt32LE(30) !== 0 || !bytes.subarray(54, 62).equals(Buffer.from([0, 0, 0, 0, 255, 255, 255, 0]))) throw new DeliveryError('Invalid monochrome BMP');
      }
      await atomicWrite(file, bytes);
      if (driver && appliedHash !== digest) { await runDriver(driver, file, frame); appliedHash = digest; }
      etag = `"${digest}"`; downloadedHash = digest;
      await heartbeat();
      return result('updated');
    },
  };
}

export async function main(environment = process.env) {
  const poller = createPoller({
    baseUrl: environment.DISPLAY_API_URL, deviceId: environment.DISPLAY_DEVICE_ID, token: environment.DEVICE_TOKEN,
    width: Number(environment.DISPLAY_WIDTH), height: Number(environment.DISPLAY_HEIGHT), rotation: Number(environment.DISPLAY_ROTATION ?? 0),
    format: environment.DISPLAY_FORMAT ?? 'bmp', outputFile: environment.DISPLAY_OUTPUT_FILE,
    allowHttpLocalhost: environment.ALLOW_HTTP_LOCALHOST === '1',
    driver: environment.DISPLAY_DRIVER ? { executable: environment.DISPLAY_DRIVER, args: JSON.parse(environment.DISPLAY_DRIVER_ARGS ?? '[]'), timeoutSeconds: Number(environment.DISPLAY_DRIVER_TIMEOUT_SECONDS ?? 300) } : undefined,
  });
  let failures = 0;
  for (;;) {
    let wait;
    try { const result = await poller.pollOnce(); failures = 0; wait = result.retryAfter; console.log(`Display bridge: ${result.kind}; next check in ${wait}s`); }
    catch (error) {
      if (error.fatal || environment.DISPLAY_ONCE === '1') throw error;
      wait = failureDelay(failures++, error.retryAfter); console.error(`Display bridge: update failed; retry in ${wait}s`);
    }
    if (environment.DISPLAY_ONCE === '1') return;
    await delay(wait * 1000);
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch(() => { console.error('Display bridge stopped: check configuration, token and connection.'); process.exitCode = 1; });
}
