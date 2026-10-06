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
import { ScheduleValidationError } from '../utils/scheduleValidation';
import { LayoutValidationError } from '../utils/layoutValidation';
import { validatePublicHttpsUrl } from '../utils/publicFeedFetch';
import { parseNewsFeeds } from '../utils/newsFeeds';
import calendarRouter from './calendar';
import { DEFAULT_DISPLAY_TIMEZONE } from '../utils/displayTimezone';
import { parseCustomContentUpdates } from '../utils/customContent';
import { parseWebhookPreferences } from '../services/customWebhook';
import { parseDisplayTemplate, TEMPLATE_SETTING_KEYS } from '../utils/displayTemplates';
import { normalizeWeatherLocation } from '../utils/weatherLocation';
import { WeatherSourceError, weatherProblem } from '../utils/weatherErrors';
import { fetchWeather } from '../services/weather';
import { fetchEnergyPrice } from '../services/energinet';
import { EnergyPriceSourceError, energyPriceProblem } from '../utils/energyPriceErrors';
import { logger } from '../lib/logger';
import { normalizeNotionCredentials } from '../utils/notionCredentials';

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
        display_timezone: DEFAULT_DISPLAY_TIMEZONE,
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
        energy_price_settings: { mode: 'spot' },
        weather_location: '55.3,10.4',
        news_language: 'da',
        news_source: 'newsapi',
        news_feed_url: '',
        news_item_limit: 3,
        news_feeds: [],
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

      let updates: Partial<UserPreferences>;
      try {
        const settings = Object.fromEntries(TEMPLATE_SETTING_KEYS
          .filter((key) => req.body[key] !== undefined).map((key) => [key, req.body[key]]));
        updates = {
          ...(Object.keys(settings).length ? parseDisplayTemplate({ format: 'esp32-eink-template', version: 1, settings }).settings : {}),
          ...parseCustomContentUpdates(req.body), ...parseWebhookPreferences(req.body),
        };
      } catch (error) {
        res.status(400).json({ error: error instanceof Error ? error.message : 'Invalid preferences' });
        return;
      }
      const { news_source, news_feed_url, show_news } = req.body;
      if (news_feed_url !== undefined) {
        try {
          if (typeof news_feed_url !== 'string') throw new Error('Feed URL must be a string');
          if (news_feed_url !== '') validatePublicHttpsUrl(news_feed_url);
          updates.news_feed_url = news_feed_url;
        } catch (error) {
          res.status(400).json({ error: (error as Error).message }); return;
        }
      }
      if (req.body.news_feeds !== undefined) {
        try { updates.news_feeds = parseNewsFeeds(req.body.news_feeds); }
        catch (error) { res.status(400).json({ error: (error as Error).message }); return; }
      }
      const userId = await getOrCreateUserFromClerk(req.clerkUserId!);
      if (news_source === 'rss' || news_feed_url === '' || show_news === true) {
        const current = await getPreferences(userId);
        if ((show_news ?? current?.show_news ?? true) && (news_source ?? current?.news_source) === 'rss'
          && !(news_feed_url ?? current?.news_feed_url)) {
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
 * @swagger
 * /api/preferences/weather/test:
 *   post:
 *     summary: Test draft weather coordinates with the authenticated user's saved OpenWeatherMap key
 *     description: Uses the configured server key only when the user has no saved key. Bypasses cached readings. Does not save coordinates or accept credentials in the request. Provider failures return fixed messages without credentials or response bodies.
 *     tags: [Preferences]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [location]
 *             properties:
 *               location:
 *                 type: string
 *                 example: '57.05,9.92'
 *     responses:
 *       200:
 *         description: Current metric weather (temperature in Celsius, wind in m/s)
 *       400:
 *         description: Missing key, invalid coordinates or rejected/inactive API key; body contains error and code
 *       401:
 *         description: Sign-in required
 *       502:
 *         description: Provider unavailable, rate limited or invalid response; body contains error and code
 *       504:
 *         description: Provider timeout; body contains error and code
 */
router.post('/weather/test', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const location = normalizeWeatherLocation(req.body?.location);
    const userId = await getOrCreateUserFromClerk(req.clerkUserId!);
    const keys = await getApiKeys(userId);
    const key = keys.find((entry) => entry.provider === 'openweathermap')?.api_key;
    const weather = await fetchWeather(location, key, undefined, { bypassCache: true });
    res.json({ weather });
  } catch (error) {
    if (!(error instanceof WeatherSourceError)) { next(error); return; }
    const problem = weatherProblem(error);
    const status = problem.code === 'timeout' ? 504
      : ['missing_key', 'invalid_location', 'invalid_key'].includes(problem.code) ? 400 : 502;
    res.status(status).json({ error: problem.message, code: problem.code });
  }
});

/**
 * @swagger
 * /api/preferences/energy-price/test:
 *   post:
 *     summary: Test draft electricity price settings without saving them
 *     description: Calculates the current price for the draft price area and settings. Consumer mode names every configured grid tariff code that has no current tariff for the configured GLN. Provider failures return fixed messages without upstream URLs or response bodies.
 *     tags: [Preferences]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [location, settings]
 *             properties:
 *               location: { type: string, enum: [DK1, DK2] }
 *               settings: { $ref: '#/components/schemas/EnergyPriceSettings' }
 *     responses:
 *       200:
 *         description: Current price in øre/kWh, as in display data
 *       400:
 *         description: Invalid settings, or tariff codes without a current tariff; body contains error, code and missingCodes when known
 *       401:
 *         description: Sign-in required
 *       502:
 *         description: Price source unavailable or invalid response; body contains error and code
 *       504:
 *         description: Price source timeout; body contains error and code
 */
router.post('/energy-price/test', requireAuth, async (req: Request, res: Response) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    // Both fields are required so a missing value never silently tests the defaults.
    if (typeof req.body?.location !== 'string' || req.body?.settings === undefined) {
      throw new EnergyPriceSourceError('invalid_settings');
    }
    const price = await fetchEnergyPrice(req.body.location, undefined, req.body.settings);
    res.json({ price });
  } catch (error) {
    const problem = energyPriceProblem(error);
    if (!['invalid_settings', 'missing_tariff'].includes(problem.code)) logger.warn({ err: error }, 'Energy price test failed');
    const status = problem.code === 'timeout' ? 504 : ['invalid_settings', 'missing_tariff'].includes(problem.code) ? 400 : 502;
    res.status(status).json({ error: problem.message, code: problem.code,
      ...(problem.missingCodes ? { missingCodes: problem.missingCodes } : {}) });
  }
});

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

      const { provider, credentials } = (req.body ?? {}) as {
        provider?: string;
        credentials?: Record<string, string>;
      };

      const validEvProviders = ['monta', 'zaptec', 'notion'];
      if (!provider || !validEvProviders.includes(provider)) {
        res.status(400).json({ error: `provider must be one of: ${validEvProviders.join(', ')}` });
        return;
      }

      if (!credentials || typeof credentials !== 'object' || Array.isArray(credentials)) {
        res.status(400).json({ error: 'credentials must be an object' });
        return;
      }

      let serialised: string;
      try {
        if (provider === 'notion') {
          serialised = JSON.stringify(normalizeNotionCredentials(credentials));
        } else {
          const fields = provider === 'monta' ? ['clientId', 'clientSecret'] : ['username', 'password'];
          if (fields.some((field) => typeof credentials[field] !== 'string'
            || !credentials[field].trim() || credentials[field].length > 4096)) {
            throw new Error(`${provider} requires non-empty text for ${fields.join(' and ')} (at most 4096 characters each).`);
          }
          serialised = JSON.stringify(Object.fromEntries(fields.map((field) => [field,
            field === 'password' ? credentials[field] : credentials[field].trim()])));
        }
      } catch (error) {
        res.status(400).json({ error: error instanceof Error ? error.message : 'Invalid credentials' }); return;
      }
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
