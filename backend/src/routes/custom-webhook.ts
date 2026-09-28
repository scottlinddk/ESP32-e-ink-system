import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { getOrCreateUserFromClerk } from './preferences-helpers';
import { getPreferences } from '../services/database';
import {
  DEFAULT_WEBHOOK_TTL_MINUTES, findWebhookOwner, getWebhookRecord, hashWebhookToken,
  issueWebhookToken, parseWebhookBearer, parseWebhookPayload, revokeWebhookToken,
  saveWebhookPayload, webhookDisplayData,
} from '../services/customWebhook';

const router = Router();
router.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });

router.post('/ingest', async (req, res, next) => {
  try {
    const token = parseWebhookBearer(req.headers.authorization);
    if (!token) { res.status(401).json({ error: 'Invalid integration token' }); return; }
    const hash = hashWebhookToken(token);
    const userId = await findWebhookOwner(hash);
    if (!userId) { res.status(401).json({ error: 'Invalid integration token' }); return; }
    let payload;
    try { payload = parseWebhookPayload(req.body); } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : 'Invalid sensor payload' }); return;
    }
    if (!await saveWebhookPayload(userId, hash, payload)) {
      res.status(401).json({ error: 'Integration token was revoked or replaced' }); return;
    }
    res.json({ received_at: payload.received_at, observed_at: payload.observed_at, rows: payload.rows.length });
  } catch (error) { next(error); }
});

router.get('/', requireAuth, async (req, res, next) => {
  try {
    const userId = await getOrCreateUserFromClerk(req.clerkUserId!);
    const [record, prefs] = await Promise.all([getWebhookRecord(userId), getPreferences(userId)]);
    const data = webhookDisplayData(record, prefs?.custom_webhook_ttl_minutes ?? DEFAULT_WEBHOOK_TTL_MINUTES);
    res.json({
      configured: !!record?.token_hash, tokenCreatedAt: record?.token_created_at ?? null,
      state: data.state, observedAt: data.observedAt, receivedAt: data.receivedAt, expiresAt: data.expiresAt,
      rowCount: data.rows.length,
    });
  } catch (error) { next(error); }
});

router.post('/token', requireAuth, async (req, res, next) => {
  try {
    const userId = await getOrCreateUserFromClerk(req.clerkUserId!);
    res.status(201).json({ token: await issueWebhookToken(userId) });
  } catch (error) { next(error); }
});

router.delete('/token', requireAuth, async (req, res, next) => {
  try {
    const userId = await getOrCreateUserFromClerk(req.clerkUserId!);
    await revokeWebhookToken(userId);
    res.status(204).end();
  } catch (error) { next(error); }
});

export default router;
