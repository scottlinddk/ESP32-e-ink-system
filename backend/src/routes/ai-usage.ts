import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { getOrCreateUserFromClerk } from './preferences-helpers';
import { deleteApiKey, getApiKeys, getPreferences, upsertApiKey } from '../services/database';
import { ADMIN_KEY_PROVIDERS, buildAiUsage } from '../aiUsage';
import { ANTHROPIC_ADMIN_KEY_PATTERN } from '../aiUsage/anthropicAdmin';
import { OPENAI_ADMIN_KEY_PATTERN } from '../aiUsage/openaiAdmin';
import { AiUsagePayloadError, parseAiUsagePush } from '../aiUsage/snapshot';
import {
  findAiUsageOwner, getAiUsageRecord, hashAiUsageToken, issueAiUsageToken, parseAiUsageBearer,
  revokeAiUsageToken, saveAiUsagePush,
} from '../aiUsage/store';
import { AI_PROVIDERS, type AiProvider, type StoredAiUsage } from '../aiUsage/types';
import { DEFAULT_DISPLAY_TIMEZONE } from '../utils/displayTimezone';

/**
 * @swagger
 * tags:
 *   name: AI usage
 *   description: Token and quota usage for Claude and OpenAI, pushed by a local collector or pulled from Admin APIs
 *
 * /api/ai-usage/ingest:
 *   post:
 *     summary: Push an aggregate usage snapshot from the local collector
 *     description: Authenticated with an AI usage integration token (Bearer eau_…), not a sign-in token. Accepts quota windows and per-model token counts only. See docs/AI_USAGE.md for the contract.
 *     tags: [AI usage]
 *     responses:
 *       200: { description: Snapshot stored }
 *       400: { description: Invalid payload; body contains error }
 *       401: { description: Missing, invalid, revoked or replaced token }
 * /api/ai-usage:
 *   get:
 *     summary: Integration status (token, last reports, configured Admin API keys)
 *     tags: [AI usage]
 *     security: [{ BearerAuth: [] }]
 * /api/ai-usage/test:
 *   post:
 *     summary: Build the widget data now, bypassing the Admin API cache
 *     tags: [AI usage]
 *     security: [{ BearerAuth: [] }]
 */

const router = Router();
router.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });

const KEY_PATTERNS: Record<AiProvider, RegExp> = { claude: ANTHROPIC_ADMIN_KEY_PATTERN, openai: OPENAI_ADMIN_KEY_PATTERN };
const KEY_HINTS: Record<AiProvider, string> = {
  claude: 'Use an Anthropic Admin API key starting with sk-ant-admin. Regular API keys cannot read usage reports.',
  openai: 'Use an OpenAI Admin key starting with sk-admin-. Project and user keys cannot read usage reports.',
};

function providerParam(value: unknown): AiProvider | null {
  return typeof value === 'string' && (AI_PROVIDERS as readonly string[]).includes(value) ? value as AiProvider : null;
}

function reportSummary(providers: StoredAiUsage) {
  return Object.fromEntries(AI_PROVIDERS.map((provider) => [provider, {
    limitsObservedAt: providers[provider]?.limits?.observed_at ?? null,
    machines: Object.entries(providers[provider]?.usage ?? {}).map(([name, report]) => ({ name, day: report.day, observedAt: report.observed_at })),
  }]));
}

router.post('/ingest', async (req, res, next) => {
  try {
    const token = parseAiUsageBearer(req.headers.authorization);
    if (!token) { res.status(401).json({ error: 'Invalid AI usage token' }); return; }
    const hash = hashAiUsageToken(token);
    const record = await findAiUsageOwner(hash);
    if (!record) { res.status(401).json({ error: 'Invalid AI usage token' }); return; }
    let push;
    try { push = parseAiUsagePush(req.body); } catch (error) {
      if (!(error instanceof AiUsagePayloadError)) throw error;
      res.status(400).json({ error: error.message }); return;
    }
    const saved = await saveAiUsagePush(record, hash, push);
    if (!saved) { res.status(401).json({ error: 'AI usage token was revoked or replaced' }); return; }
    res.json({ machine: push.machine, providers: Object.keys(push.providers) });
  } catch (error) { next(error); }
});

router.get('/', requireAuth, async (req, res, next) => {
  try {
    const userId = await getOrCreateUserFromClerk(req.clerkUserId!);
    const [record, keys] = await Promise.all([getAiUsageRecord(userId), getApiKeys(userId)]);
    const configured = !!record?.token_hash;
    res.json({
      configured, tokenCreatedAt: configured ? record!.token_created_at : null, receivedAt: configured ? record!.received_at : null,
      reports: reportSummary(configured ? record!.providers : {}),
      adminKeys: Object.fromEntries(AI_PROVIDERS.map((provider) => [provider, keys.some((key) => key.provider === ADMIN_KEY_PROVIDERS[provider])])),
    });
  } catch (error) { next(error); }
});

router.post('/token', requireAuth, async (req, res, next) => {
  try {
    const userId = await getOrCreateUserFromClerk(req.clerkUserId!);
    res.status(201).json({ token: await issueAiUsageToken(userId) });
  } catch (error) { next(error); }
});

router.delete('/token', requireAuth, async (req, res, next) => {
  try {
    const userId = await getOrCreateUserFromClerk(req.clerkUserId!);
    await revokeAiUsageToken(userId);
    res.status(204).end();
  } catch (error) { next(error); }
});

router.put('/admin-keys/:provider', requireAuth, async (req, res, next) => {
  try {
    const provider = providerParam(req.params.provider);
    if (!provider) { res.status(400).json({ error: 'provider must be claude or openai' }); return; }
    const key = typeof req.body?.api_key === 'string' ? req.body.api_key.trim() : '';
    if (!KEY_PATTERNS[provider].test(key)) { res.status(400).json({ error: KEY_HINTS[provider] }); return; }
    const userId = await getOrCreateUserFromClerk(req.clerkUserId!);
    await upsertApiKey(userId, ADMIN_KEY_PROVIDERS[provider], key);
    res.json({ provider, configured: true });
  } catch (error) { next(error); }
});

router.delete('/admin-keys/:provider', requireAuth, async (req, res, next) => {
  try {
    const provider = providerParam(req.params.provider);
    if (!provider) { res.status(400).json({ error: 'provider must be claude or openai' }); return; }
    const userId = await getOrCreateUserFromClerk(req.clerkUserId!);
    await deleteApiKey(userId, ADMIN_KEY_PROVIDERS[provider]);
    res.status(204).end();
  } catch (error) { next(error); }
});

router.post('/test', requireAuth, async (req, res, next) => {
  try {
    const userId = await getOrCreateUserFromClerk(req.clerkUserId!);
    const [record, keys, prefs] = await Promise.all([getAiUsageRecord(userId), getApiKeys(userId), getPreferences(userId)]);
    const adminKeys: Partial<Record<AiProvider, string>> = {};
    for (const provider of AI_PROVIDERS) {
      const key = keys.find((entry) => entry.provider === ADMIN_KEY_PROVIDERS[provider])?.api_key;
      if (key) adminKeys[provider] = key;
    }
    const data = await buildAiUsage({
      stored: record?.token_hash ? record.providers : {}, adminKeys,
      timeZone: prefs?.display_timezone ?? DEFAULT_DISPLAY_TIMEZONE, bypassCache: true,
    });
    res.json({ aiUsage: data });
  } catch (error) { next(error); }
});

export default router;
