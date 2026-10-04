import { Router } from 'express';
import { createHash } from 'node:crypto';
import { requireAuth } from '../middleware/auth';
import { getOrCreateUserFromClerk } from './preferences-helpers';
import { authenticateDevice, DeviceNotFound, getDeliveryStatus, getRefreshState, recordHeartbeat, requestDeviceRefresh, revokeDeviceToken, rotateDeviceToken, setInstantUpdates, tokenHash, validateHeartbeat } from '../services/deviceDelivery';
import { getApiKeys } from '../services/database';
import { buildDisplayData } from '../services/displayData';
import { resolveDevicePreferences } from '../services/deviceDisplays';
import { renderDisplayData, renderDisplayDataRaw } from '../utils/bmpGenerator';
import { frameMetadata } from '../utils/displayProfile';
import { layoutForDisplayData, resolveDisplaySchedule } from '../services/displaySchedule';
import { createRateLimiter } from '../middleware/rateLimit';
import { classifyDatabaseError, DATABASE_FAILURE_HINTS } from '../services/databaseHealth';
import { logger } from '../lib/logger';

export const managementRouter = Router();
managementRouter.use(requireAuth);
managementRouter.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
managementRouter.get('/:id/delivery', async (req, res) => {
  try { res.json(await getDeliveryStatus(await getOrCreateUserFromClerk(req.clerkUserId!), req.params.id)); }
  catch (error) { res.status(error instanceof DeviceNotFound ? 404 : 500).json({ error: 'Unable to load device delivery status' }); }
});
managementRouter.post('/:id/delivery/token', async (req, res) => {
  try { res.json({ token: await rotateDeviceToken(await getOrCreateUserFromClerk(req.clerkUserId!), req.params.id) }); }
  catch (error) { res.status(error instanceof DeviceNotFound ? 404 : 500).json({ error: 'Unable to create device token' }); }
});
managementRouter.delete('/:id/delivery/token', async (req, res) => {
  try {
    await revokeDeviceToken(await getOrCreateUserFromClerk(req.clerkUserId!), req.params.id);
    res.json({ configured: false });
  } catch (error) { res.status(error instanceof DeviceNotFound ? 404 : 500).json({ error: 'Unable to revoke device token' }); }
});
managementRouter.post('/:id/refresh', async (req, res, next) => {
  try { res.status(202).json(await requestDeviceRefresh(await getOrCreateUserFromClerk(req.clerkUserId!), req.params.id)); }
  catch (error) { next(error); }
});
managementRouter.put('/:id/delivery/instant', async (req, res, next) => {
  if (!req.body || typeof req.body.enabled !== 'boolean' || Object.keys(req.body).length !== 1) {
    res.status(400).json({ error: 'Body must be { "enabled": true | false }' }); return;
  }
  try { res.json(await setInstantUpdates(await getOrCreateUserFromClerk(req.clerkUserId!), req.params.id, req.body.enabled)); }
  catch (error) { next(error); }
});

export const feedRouter = Router();
const invalidTokenLimiter = createRateLimiter(30, '1 m', 'Too many invalid device requests', 'device-feed-invalid');
const deviceLimiter = createRateLimiter(120, '1 m', 'Too many requests for this device', 'device-feed', (req) => req.params.id);
feedRouter.use('/:id', async (req, res, next) => {
  res.setHeader('Cache-Control', 'private, no-cache');
  res.setHeader('Vary', 'Authorization');
  try {
    const owner = await authenticateDevice(req.params.id, req.get('authorization'));
    if (!owner) {
      await invalidTokenLimiter(req, res, () => { res.setHeader('WWW-Authenticate', 'Bearer'); res.status(401).json({ error: 'Invalid device token' }); });
      return;
    }
    res.locals.deviceOwner = owner;
    await deviceLimiter(req, res, next);
  } catch { res.setHeader('Retry-After', '60'); res.status(503).json({ error: 'Device delivery unavailable' }); }
});

export const retrySeconds = (milliseconds: number) => Math.min(86400, Math.max(1, Math.ceil(Number.isFinite(milliseconds) ? milliseconds / 1000 : 60)));
/** How often an instant-updates device asks for a pending request. Tunable without a reflash. */
export function instantCheckSeconds(value = process.env.DEVICE_INSTANT_CHECK_SECONDS): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? Math.min(60, Math.max(2, parsed)) : 5;
}
function remainingRetry(nextRefresh: number, startedAt: number, transition?: string): number {
  const transitionAt = transition ? Date.parse(transition) : Infinity;
  const deadline = Math.min(startedAt + nextRefresh, Number.isFinite(transitionAt) ? transitionAt : Infinity);
  return retrySeconds(deadline - Date.now());
}

feedRouter.get('/:id/frame', async (req, res) => {
  const format = req.query.format ?? 'bmp';
  if (format !== 'bmp' && format !== 'raw') { res.status(400).json({ error: 'format must be bmp or raw' }); return; }
  try {
    const startedAt = Date.now();
    const owner = res.locals.deviceOwner as string;
    const refresh = await getRefreshState(owner, req.params.id, tokenHash(req.get('authorization')!.slice(7)));
    const refreshRequestId = refresh.requestId;
    // Every response, including quiet 204 and 304, tells the device whether to stay online.
    res.setHeader('X-Instant-Updates', refresh.instantUpdates ? '1' : '0');
    const prefs = await resolveDevicePreferences(owner, req.params.id);
    const schedule = resolveDisplaySchedule(prefs);
    if (!refreshRequestId && schedule.schedule?.quiet) {
      res.setHeader('Retry-After', String(remainingRetry(schedule.nextRefresh, Date.now(), schedule.schedule.nextTransitionAt)));
      res.status(204).end(); return;
    }
    const keys = await getApiKeys(owner);
    const data = await buildDisplayData(owner, prefs, Object.fromEntries(keys.map((key) => [key.provider, key.api_key])));
    const afterFetch = resolveDisplaySchedule(prefs);
    if (!refreshRequestId && afterFetch.schedule?.quiet) {
      res.setHeader('Retry-After', String(remainingRetry(afterFetch.nextRefresh, Date.now(), afterFetch.schedule.nextTransitionAt)));
      res.status(204).end(); return;
    }
    // The page selected when source collection began stays paired with its data.
    const layout = layoutForDisplayData(prefs, data);
    const frame = format === 'bmp' ? renderDisplayData(data, layout, prefs) : renderDisplayDataRaw(data, layout, prefs);
    const metadata = frameMetadata(prefs.display_profile);
    const hash = createHash('sha256').update(frame).digest('hex');
    const etag = `"${hash}"`;
    res.set({
      'Retry-After': String(remainingRetry(data.nextRefresh, startedAt, data.schedule?.nextTransitionAt)), 'ETag': etag, 'X-Image-SHA256': hash,
      'X-Display-Width': String(metadata.width), 'X-Display-Height': String(metadata.height),
      'X-Display-Rotation': String(metadata.rotation), 'X-Display-Row-Bytes': String(metadata.rowBytes),
      'X-Display-Encoding': metadata.encoding, 'X-Refresh-Mode': 'full',
    });
    if (refreshRequestId) res.setHeader('X-Refresh-Request-ID', refreshRequestId);
    if (!refreshRequestId && (req.get('if-none-match') ?? '').split(',').some((tag) => tag.trim().replace(/^W\//, '') === etag)) { res.status(304).end(); return; }
    res.type(format === 'bmp' ? 'image/bmp' : 'application/octet-stream');
    // Conditional delivery is handled above. Express send() would independently
    // turn a forced refresh back into 304 when the original ETag still matches.
    res.setHeader('Content-Length', frame.length);
    res.end(frame);
  } catch (error) {
    const reason = classifyDatabaseError(error) ?? 'error';
    logger.error({ reason, hint: DATABASE_FAILURE_HINTS[reason] }, 'Device frame request failed');
    res.setHeader('Retry-After', '60'); res.status(503).json({ error: 'Unable to render display frame' });
  }
});

// Cheap check for an instant-updates device: no source fetching or rendering.
// 200 + X-Refresh-Request-ID means fetch the frame now; 204 means nothing pending.
feedRouter.get('/:id/refresh-request', async (req, res) => {
  try {
    const refresh = await getRefreshState(res.locals.deviceOwner as string, req.params.id, tokenHash(req.get('authorization')!.slice(7)));
    res.set({ 'X-Instant-Updates': refresh.instantUpdates ? '1' : '0', 'Retry-After': String(instantCheckSeconds()) });
    if (!refresh.requestId) { res.status(204).end(); return; }
    res.setHeader('X-Refresh-Request-ID', refresh.requestId);
    res.json({ refreshRequestId: refresh.requestId });
  } catch { res.setHeader('Retry-After', '60'); res.status(503).json({ error: 'Unable to check for a refresh request' }); }
});

feedRouter.post('/:id/heartbeat', async (req, res) => {
  let heartbeat;
  try { heartbeat = validateHeartbeat(req.body); }
  catch (error) { res.status(400).json({ error: (error as Error).message }); return; }
  try {
    await recordHeartbeat(res.locals.deviceOwner as string, req.params.id, tokenHash(req.get('authorization')!.slice(7)), heartbeat);
    res.setHeader('Cache-Control', 'no-store');
    res.json({ accepted: true });
  } catch { res.setHeader('Retry-After', '60'); res.status(503).json({ error: 'Unable to record heartbeat' }); }
});
