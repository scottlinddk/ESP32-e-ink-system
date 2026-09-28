import { parseDisplayProfile } from '../utils/displayProfile';
import { Router, Request, Response, NextFunction } from 'express';
import { requireAuth } from '../middleware/auth';
import {
  getPreferences,
  upsertPreferences,
  getApiKeys,
  upsertApiKey,
  deleteApiKey,
} from '../services/database';
import { getOrCreateUserFromClerk } from './preferences-helpers';
import { UserPreferences } from '../types/index';
import templatesRouter from './templates';
import { parseDisplaySchedule, ScheduleValidationError } from '../utils/scheduleValidation';
import { LayoutValidationError } from '../utils/layoutValidation';
import { validatePublicHttpsUrl } from '../utils/publicFeedFetch';
import calendarRouter from './calendar';
import { validateCalendarOptions } from '../services/calendar';
import { parseCustomContentUpdates } from '../utils/customContent';
import { parseWebhookPreferences } from '../services/customWebhook';

/**
 * @swagger
 * tags:
 *   name: Preferences
 *   description: User display preferences and third-party API key management
 *
 * /api/preferences:
 *   get:
 *     summary: Get authenticated user's display preferences
 *     description: Returns saved preferences, or sensible defaults if none have been set yet
 *     tags: [Preferences]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: User preferences
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 preferences:
 *                   $ref: '#/components/schemas/UserPreferences'
 *       401:
 *         description: Unauthorized
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *
 *   post:
 *     summary: Update authenticated user's display preferences
 *     description: Partial updates are supported — only fields present in the body are updated
 *     tags: [Preferences]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/UserPreferences'
 *     responses:
 *       200:
 *         description: Updated preferences
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 preferences:
 *                   $ref: '#/components/schemas/UserPreferences'
 *       401:
 *         description: Unauthorized
 *
 * /api/preferences/api-keys:
 *   get:
 *     summary: List stored third-party API keys (values are masked)
 *     tags: [Preferences]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Masked API keys
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 api_keys:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/ApiKey'
 *       401:
 *         description: Unauthorized
 *
 *   post:
 *     summary: Store or update an API key for a provider
 *     tags: [Preferences]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - provider
 *               - api_key
 *             properties:
 *               provider:
 *                 type: string
 *                 enum: [openweathermap, newsapi, openai]
 *               api_key:
 *                 type: string
 *                 minLength: 4
 *                 description: Plain-text key — stored encrypted at rest
 *     responses:
 *       200:
 *         description: API key stored (value masked in response)
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 api_key:
 *                   $ref: '#/components/schemas/ApiKey'
 *       400:
 *         description: Validation error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       401:
 *         description: Unauthorized
 *
 * /api/preferences/api-keys/{provider}:
 *   delete:
 *     summary: Remove an API key for a provider
 *     tags: [Preferences]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: provider
 *         required: true
 *         schema:
 *           type: string
 *           enum: [openweathermap, newsapi, openai]
 *     responses:
 *       200:
 *         description: API key deleted
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *       400:
 *         description: Invalid provider
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       401:
 *         description: Unauthorized
 */

const router = Router();
router.use('/calendar-credentials', calendarRouter);
router.use('/templates', templatesRouter);

/**
 * GET /api/preferences
 * Returns authenticated user's preferences
 */
router.get(
  '/',
  requireAuth,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const clerkUserId = req.clerkUserId!;
      const userId = await getOrCreateUserFromClerk(clerkUserId);
      const prefs = await getPreferences(userId);

      // Return defaults if no preferences set yet
      const defaultPrefs: UserPreferences = {
        show_custom_webhook: false,
        custom_webhook_ttl_minutes: 60,
        show_custom_text: false,
        custom_text: '',
        show_custom_image: false,
        custom_image: null,
        show_energy_price: true,
        show_weather: true,
        show_news: true,
        show_air_quality: false,
        show_monta: false,
        show_zaptec: false,
        show_notion: false,
        show_calendar: false,
        calendar_timezone: 'Europe/Copenhagen',
        calendar_days: 7,
        calendar_item_limit: 5,
        energy_price_location: 'DK1',
        weather_location: '55.3,10.4',
        news_language: 'da',
        news_source: 'newsapi',
        news_feed_url: '',
        news_item_limit: 3,
        refresh_interval_minutes: 30,
        layout: null,
        monta_fields: ['charger_status', 'active_session'],
        zaptec_fields: ['charger_status', 'active_session'],
      };

      res.json({ preferences: prefs ?? defaultPrefs });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * POST /api/preferences
 * Upsert authenticated user's preferences
 */
router.post(
  '/',
  requireAuth,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
        res.status(400).json({ error: 'Preferences must be an object.' });
        return;
      }

      const allowedFields: (keyof UserPreferences)[] = [
        'display_schedule',
        'show_energy_price',
        'show_weather',
        'show_news',
        'show_air_quality',
        'show_monta',
        'show_zaptec',
        'energy_price_location',
        'weather_location',
        'news_language',
        'news_source',
        'news_feed_url',
        'news_item_limit',
        'refresh_interval_minutes',
        'layout',
        'display_profile',
        'monta_fields',
        'zaptec_fields',
        'show_notion',
        'show_calendar',
        'calendar_timezone',
        'calendar_days',
        'calendar_item_limit',
      ];

      if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
        res.status(400).json({ error: 'Preferences must be an object' });
        return;
      }
      let updates: Partial<UserPreferences>;
      try {
        updates = { ...parseCustomContentUpdates(req.body), ...parseWebhookPreferences(req.body) };
      } catch (error) {
        res.status(400).json({ error: error instanceof Error ? error.message : 'Invalid custom content' });
        return;
      }
      if (req.body.show_calendar !== undefined && typeof req.body.show_calendar !== 'boolean') {
        res.status(400).json({ error: 'show_calendar must be a boolean' }); return;
      }
      try {
        validateCalendarOptions({
          timezone: req.body.calendar_timezone === undefined ? 'Europe/Copenhagen' : req.body.calendar_timezone,
          days: req.body.calendar_days === undefined ? 7 : req.body.calendar_days,
          limit: req.body.calendar_item_limit === undefined ? 5 : req.body.calendar_item_limit,
        });
      } catch (error) { res.status(400).json({ error: (error as Error).message }); return; }

      const { news_source, news_feed_url, news_item_limit } = req.body;
      if (news_source !== undefined && !['newsapi', 'rss'].includes(news_source)) {
        res.status(400).json({ error: 'news_source must be newsapi or rss' }); return;
      }
      if (news_item_limit !== undefined && (!Number.isInteger(news_item_limit) || news_item_limit < 1 || news_item_limit > 10)) {
        res.status(400).json({ error: 'news_item_limit must be an integer between 1 and 10' }); return;
      }
      if (news_feed_url !== undefined) {
        try {
          if (typeof news_feed_url !== 'string') throw new Error('Feed URL must be a string');
          if (news_feed_url !== '') validatePublicHttpsUrl(news_feed_url);
        } catch (error) {
          res.status(400).json({ error: (error as Error).message }); return;
        }
      }
      for (const field of allowedFields) {
        if (req.body[field] !== undefined) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (updates as Record<string, any>)[field] = req.body[field];
        }
      }

      if (updates.display_schedule !== undefined && updates.display_schedule !== null) {
        updates.display_schedule = parseDisplaySchedule(updates.display_schedule);
      }

      const userId = await getOrCreateUserFromClerk(req.clerkUserId!);
      if (req.body.display_profile !== undefined) {
        try { updates.display_profile = parseDisplayProfile(req.body.display_profile); }
        catch (error) { res.status(400).json({ error: (error as Error).message }); return; }
      }
      if (news_source === 'rss' || news_feed_url === '') {
        const current = await getPreferences(userId);
        if ((news_source ?? current?.news_source) === 'rss' && !(news_feed_url ?? current?.news_feed_url)) {
          res.status(400).json({ error: 'A feed URL is required for RSS/Atom' }); return;
        }

      }
      const prefs = await upsertPreferences(userId, updates);
      res.json({ preferences: prefs });
    } catch (err) {
      if (err instanceof ScheduleValidationError || err instanceof LayoutValidationError) {
        res.status(400).json({ error: err.message });
        return;
      }
      next(err);
    }
  }
);

/**
 * GET /api/preferences/api-keys
 * Returns stored API keys (masked) for the user
 */
router.get(
  '/api-keys',
  requireAuth,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const clerkUserId = req.clerkUserId!;
      const userId = await getOrCreateUserFromClerk(clerkUserId);
      const keys = await getApiKeys(userId);

      // Mask the actual key values
      const masked = keys.filter((k) => k.provider !== 'calendar').map((k) => ({
        id: k.id,
        provider: k.provider,
        api_key: k.api_key.slice(0, 6) + '••••••••',
        created_at: k.created_at,
      }));

      res.json({ api_keys: masked });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * POST /api/preferences/api-keys
 * Store or update an API key for a provider
 */
router.post(
  '/api-keys',
  requireAuth,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const clerkUserId = req.clerkUserId!;
      const userId = await getOrCreateUserFromClerk(clerkUserId);

      const { provider, api_key } = req.body as { provider?: string; api_key?: string };

      if (!provider || typeof provider !== 'string') {
        res.status(400).json({ error: 'provider is required' });
        return;
      }

      if (!api_key || typeof api_key !== 'string' || api_key.trim().length < 4) {
        res.status(400).json({ error: 'api_key is required and must be at least 4 characters' });
        return;
      }

      const validProviders = ['openweathermap', 'newsapi', 'openai'];
      if (!validProviders.includes(provider)) {
        res.status(400).json({ error: `provider must be one of: ${validProviders.join(', ')}` });
        return;
      }

      const key = await upsertApiKey(userId, provider, api_key.trim());

      res.json({
        api_key: {
          id: key.id,
          provider: key.provider,
          api_key: key.api_key.slice(0, 6) + '••••••••',
          created_at: key.created_at,
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * DELETE /api/preferences/api-keys/:provider
 * Remove an API key for a provider
 */
router.delete(
  '/api-keys/:provider',
  requireAuth,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const clerkUserId = req.clerkUserId!;
      const userId = await getOrCreateUserFromClerk(clerkUserId);

      const { provider } = req.params as { provider: string };
      const validProviders = ['openweathermap', 'newsapi', 'openai', 'monta', 'zaptec', 'notion'];
      if (!validProviders.includes(provider)) {
        res.status(400).json({ error: `provider must be one of: ${validProviders.join(', ')}` });
        return;
      }

      await deleteApiKey(userId, provider);
      res.json({ success: true });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * POST /api/preferences/ev-credentials
 * Store multi-field OAuth credentials for Monta or Zaptec.
 * Credentials are JSON-serialised and stored encrypted in api_keys table.
 */
router.post(
  '/ev-credentials',
  requireAuth,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const clerkUserId = req.clerkUserId!;
      const userId = await getOrCreateUserFromClerk(clerkUserId);

      const { provider, credentials } = req.body as {
        provider?: string;
        credentials?: Record<string, string>;
      };

      const validEvProviders = ['monta', 'zaptec', 'notion'];
      if (!provider || !validEvProviders.includes(provider)) {
        res.status(400).json({ error: `provider must be one of: ${validEvProviders.join(', ')}` });
        return;
      }

      if (!credentials || typeof credentials !== 'object') {
        res.status(400).json({ error: 'credentials must be an object' });
        return;
      }

      if (provider === 'monta') {
        if (!credentials.clientId || !credentials.clientSecret) {
          res.status(400).json({ error: 'Monta credentials require clientId and clientSecret' });
          return;
        }
      } else if (provider === 'zaptec') {
        if (!credentials.username || !credentials.password) {
          res.status(400).json({ error: 'Zaptec credentials require username and password' });
          return;
        }
      } else if (provider === 'notion') {
        if (!credentials.token || !credentials.databaseId) {
          res.status(400).json({ error: 'Notion credentials require token and databaseId' });
          return;
        }
        if (!credentials.token.startsWith('secret_')) {
          res.status(400).json({ error: 'Notion integration token must start with "secret_"' });
          return;
        }
      }

      const serialised = JSON.stringify(credentials);
      const key = await upsertApiKey(userId, provider, serialised);

      res.json({
        provider: key.provider,
        configured: true,
        created_at: key.created_at,
      });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * GET /api/preferences/ev-credentials/:provider
 * Returns whether EV credentials are configured (never returns the actual credentials).
 */
router.get(
  '/ev-credentials/:provider',
  requireAuth,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const clerkUserId = req.clerkUserId!;
      const userId = await getOrCreateUserFromClerk(clerkUserId);

      const { provider } = req.params as { provider: string };
      const validEvProviders = ['monta', 'zaptec', 'notion'];
      if (!validEvProviders.includes(provider)) {
        res.status(400).json({ error: `provider must be one of: ${validEvProviders.join(', ')}` });
        return;
      }

      const keys = await getApiKeys(userId);
      const found = keys.find((k) => k.provider === provider);

      res.json({ provider, configured: !!found });
    } catch (err) {
      next(err);
    }
  }
);

export default router;
