import { Router, Request, Response, NextFunction } from 'express';
import { createClerkClient } from '@clerk/backend';
import {
  getDeviceByLicenseKey,
  updateDeviceLastSeen,
  getPreferences,
  getApiKeys,
  logApiUsage,
  upsertUser,
} from '../services/database';
import { fetchEnergyPrice } from '../services/energinet';
import { fetchWeather } from '../services/weather';
import { fetchNews } from '../services/news';
import { renderDisplayData } from '../utils/bmpGenerator';
import { DisplayData, UserPreferences, DisplayImageResponse, WeatherData } from '../types/index';
import { requireAuth } from '../middleware/auth';
import { logger } from '../lib/logger';

// Mock weather shown in the dashboard preview when no API key is configured
const MOCK_WEATHER: WeatherData = {
  temp: 12,
  condition: 'clear',
  windSpeed: 4.2,
  icon: '01d',
};

/**
 * @swagger
 * tags:
 *   - name: Image
 *     description: Server-rendered e-ink display images (TRMNL-style)
 *
 * /api/image/{userId}:
 *   get:
 *     summary: Get image endpoint metadata for an ESP32 device
 *     description: >
 *       TRMNL-inspired device-facing endpoint. Returns a JSON payload with
 *       `image_url` pointing to the pre-rendered BMP and a `refresh_rate`
 *       so the device knows when to poll again.
 *       Authenticated via `X-License-Key` header or `licenseKey` query param.
 *     tags: [Image]
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *       - in: header
 *         name: X-License-Key
 *         schema:
 *           type: string
 *           example: DSPL-A1B2-C3D4-E5F6
 *       - in: query
 *         name: licenseKey
 *         schema:
 *           type: string
 *           example: DSPL-A1B2-C3D4-E5F6
 *     responses:
 *       200:
 *         description: Image endpoint metadata
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/DisplayImageResponse'
 *       401:
 *         description: Missing or invalid license key
 *       403:
 *         description: License key does not belong to this user
 *
 * /api/image/{userId}/bmp:
 *   get:
 *     summary: Get the pre-rendered 1-bit BMP for an ESP32 device
 *     description: >
 *       Returns a raw 1-bit BMP image (250×122 px) generated from the user's
 *       live display data. The device can display this directly without any
 *       client-side rendering.
 *       Authenticated via `X-License-Key` header or `licenseKey` query param.
 *     tags: [Image]
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *       - in: header
 *         name: X-License-Key
 *         schema:
 *           type: string
 *       - in: query
 *         name: licenseKey
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Raw 1-bit BMP image (250×122 px, ~4 KB)
 *         content:
 *           image/bmp:
 *             schema:
 *               type: string
 *               format: binary
 *       401:
 *         description: Missing or invalid license key
 *       403:
 *         description: License key does not belong to this user
 */

const router = Router();

const DEFAULT_PREFS: UserPreferences = {
  show_energy_price: true,
  show_weather: true,
  show_news: true,
  show_calendar: false,
  show_air_quality: false,
  show_monta: false,
  show_zaptec: false,
  show_notion: false,
  show_strava: false,
  show_gcal: false,
  energy_price_location: 'DK1',
  weather_location: '55.3,10.4',
  news_language: 'da',
  refresh_interval_minutes: 30,
  layout: null,
  monta_fields: ['charger_status', 'active_session'],
  zaptec_fields: ['charger_status', 'active_session'],
};

async function buildDisplayData(
  prefs: UserPreferences,
  apiKeyMap: Record<string, string>
): Promise<DisplayData> {
  const result: DisplayData = { nextRefresh: prefs.refresh_interval_minutes * 60 * 1000 };
  const tasks: Promise<void>[] = [];

  if (prefs.show_energy_price) {
    tasks.push(
      fetchEnergyPrice(prefs.energy_price_location)
        .then((price) => { result.price = price; })
        .catch((err: unknown) => { logger.error({ err }, 'Energy price fetch failed'); })
    );
  }

  if (prefs.show_weather) {
    tasks.push(
      fetchWeather(prefs.weather_location, apiKeyMap['openweathermap'])
        .then((weather) => { result.weather = weather; })
        .catch((err: unknown) => { logger.error({ err }, 'Weather fetch failed'); })
    );
  }

  if (prefs.show_news) {
    tasks.push(
      fetchNews(prefs.news_language, apiKeyMap['newsapi'])
        .then((news) => { result.news = news; })
        .catch((err: unknown) => { logger.error({ err }, 'News fetch failed'); })
    );
  }

  await Promise.all(tasks);
  return result;
}

// Preview variant: uses mock data for any source that fails (e.g. missing API key),
// so the dashboard layout editor always shows realistic content.
async function buildDisplayDataForPreview(
  prefs: UserPreferences,
  apiKeyMap: Record<string, string>
): Promise<DisplayData> {
  const result: DisplayData = { nextRefresh: prefs.refresh_interval_minutes * 60 * 1000 };
  const tasks: Promise<void>[] = [];

  if (prefs.show_energy_price) {
    tasks.push(
      fetchEnergyPrice(prefs.energy_price_location)
        .then((price) => { result.price = price; })
        .catch(() => { /* energy unavailable — leave undefined */ })
    );
  }

  if (prefs.show_weather) {
    tasks.push(
      fetchWeather(prefs.weather_location, apiKeyMap['openweathermap'])
        .then((weather) => { result.weather = weather; })
        .catch(() => { result.weather = MOCK_WEATHER; })
    );
  }

  if (prefs.show_news) {
    tasks.push(
      fetchNews(prefs.news_language, apiKeyMap['newsapi'])
        .then((news) => { result.news = news; })
        .catch(() => { /* news service returns placeholders on failure */ })
    );
  }

  await Promise.all(tasks);
  return result;
}

async function resolveDevice(req: Request, res: Response, userId: string) {
  const licenseKey =
    (req.header('X-License-Key') ?? req.query.licenseKey) as string | undefined;

  if (!licenseKey) {
    res.status(401).json({ error: 'X-License-Key header or licenseKey query param required' });
    return null;
  }

  const device = await getDeviceByLicenseKey(licenseKey);
  if (!device) {
    res.status(401).json({ error: 'Invalid license key' });
    return null;
  }

  if (device.user_id !== userId) {
    res.status(403).json({ error: 'License key does not belong to this user' });
    return null;
  }

  return device;
}

/**
 * GET /api/image/preview
 * JWT-protected preview for the dashboard — returns a 1-bit BMP for the
 * authenticated user's current preferences, just like /api/preview returns JSON.
 *
 * @swagger
 * /api/image/preview:
 *   get:
 *     summary: Get a server-rendered BMP preview for the authenticated user
 *     description: >
 *       Dashboard preview endpoint. Returns the same 1-bit BMP the device would
 *       receive, generated from the authenticated user's current preferences and
 *       live data.  Requires a Clerk JWT Bearer token.
 *     tags: [Image]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Raw 1-bit BMP image (250×122 px)
 *         content:
 *           image/bmp:
 *             schema:
 *               type: string
 *               format: binary
 *       401:
 *         description: Unauthorized
 */
router.get(
  '/preview',
  requireAuth,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const clerkUserId = req.clerkUserId!;

      const secretKey = process.env.CLERK_SECRET_KEY;
      if (!secretKey) {
        res.status(500).json({ error: 'Server misconfiguration' });
        return;
      }

      const clerk = createClerkClient({ secretKey });
      const clerkUser = await clerk.users.getUser(clerkUserId);
      const email =
        clerkUser.emailAddresses.find((e) => e.id === clerkUser.primaryEmailAddressId)
          ?.emailAddress ?? clerkUser.emailAddresses[0]?.emailAddress;

      if (!email) {
        res.status(400).json({ error: 'No email on Clerk user' });
        return;
      }

      const user = await upsertUser(email);
      logApiUsage(user.id, '/api/image/preview');

      const prefs = (await getPreferences(user.id)) ?? DEFAULT_PREFS;
      const apiKeyRows = await getApiKeys(user.id);
      const apiKeyMap: Record<string, string> = {};
      for (const row of apiKeyRows) {
        apiKeyMap[row.provider] = row.api_key;
      }

      const displayData = await buildDisplayDataForPreview(prefs, apiKeyMap);
      const bmpBuffer = renderDisplayData(displayData, prefs.layout ?? null);

      res.setHeader('Content-Type', 'image/bmp');
      res.setHeader('Content-Length', bmpBuffer.length);
      res.setHeader('Cache-Control', 'no-store');
      res.send(bmpBuffer);
    } catch (err) {
      next(err);
    }
  }
);

/**
 * GET /api/image/:userId
 * TRMNL-style JSON response with image_url and refresh_rate
 */
router.get(
  '/:userId',
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { userId } = req.params as { userId: string };
      const device = await resolveDevice(req, res, userId);
      if (!device) return;

      const licenseKey =
        (req.header('X-License-Key') ?? req.query.licenseKey) as string;
      const prefs = (await getPreferences(userId)) ?? DEFAULT_PREFS;

      const baseUrl = `${req.protocol}://${req.get('host')}`;
      const imageUrl = `${baseUrl}/api/image/${encodeURIComponent(userId)}/bmp?licenseKey=${encodeURIComponent(licenseKey)}`;

      const body: DisplayImageResponse = {
        image_url: imageUrl,
        filename: 'display.bmp',
        refresh_rate: prefs.refresh_interval_minutes * 60,
        status: 0,
      };

      res.json(body);
    } catch (err) {
      next(err);
    }
  }
);

/**
 * GET /api/image/:userId/bmp
 * Returns the raw 1-bit BMP binary
 */
router.get(
  '/:userId/bmp',
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { userId } = req.params as { userId: string };
      const device = await resolveDevice(req, res, userId);
      if (!device) return;

      // Fire-and-forget bookkeeping
      updateDeviceLastSeen(device.id).catch((err: unknown) =>
        logger.error({ err }, 'Failed to update device last_seen')
      );
      logApiUsage(userId, '/api/image/bmp');

      const prefs = (await getPreferences(userId)) ?? DEFAULT_PREFS;
      const apiKeyRows = await getApiKeys(userId);
      const apiKeyMap: Record<string, string> = {};
      for (const row of apiKeyRows) {
        apiKeyMap[row.provider] = row.api_key;
      }

      const displayData = await buildDisplayData(prefs, apiKeyMap);
      const bmpBuffer = renderDisplayData(displayData, prefs.layout ?? null);

      res.setHeader('Content-Type', 'image/bmp');
      res.setHeader('Content-Length', bmpBuffer.length);
      res.setHeader('Cache-Control', 'no-store');
      res.send(bmpBuffer);
    } catch (err) {
      next(err);
    }
  }
);

export default router;
