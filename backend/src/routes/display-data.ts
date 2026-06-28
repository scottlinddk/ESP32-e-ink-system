import { Router, Request, Response, NextFunction } from 'express';
import { requireAuth } from '../middleware/auth';
import {
  getPreferences,
  getApiKeys,
  logApiUsage,
  upsertUser,
} from '../services/database';
import { fetchEnergyPrice } from '../services/energinet';
import { fetchWeather } from '../services/weather';
import { fetchNews } from '../services/news';
import { fetchMontaData } from '../services/monta';
import { fetchZaptecData } from '../services/zaptec';
import { fetchNotionData, NotionCredentials } from '../services/notion';
import { DisplayData, UserPreferences } from '../types/index';
import { createClerkClient } from '@clerk/backend';
import { logger } from '../lib/logger';

/**
 * @swagger
 * /api/preview:
 *   get:
 *     summary: Preview display data for the authenticated user
 *     description: Dashboard preview of what the e-ink display will render, using the user's current preferences
 *     tags: [Display Data]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Preview display data
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/DisplayData'
 *       401:
 *         description: Unauthorized
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *
 * /api/checkout:
 *   post:
 *     summary: Create a checkout session (stub)
 *     description: Stripe integration is not yet implemented
 *     tags: [Billing]
 *     responses:
 *       501:
 *         description: Not implemented
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                 message:
 *                   type: string
 */

const router = Router();

const DEFAULT_PREFS: UserPreferences = {
  show_energy_price: true,
  show_weather: true,
  show_news: true,
  show_air_quality: false,
  show_monta: false,
  show_zaptec: false,
  show_notion: false,
  energy_price_location: 'DK1',
  weather_location: '55.3,10.4',
  news_language: 'da',
  refresh_interval_minutes: 30,
  layout: null,
  monta_fields: ['charger_status', 'active_session'],
  zaptec_fields: ['charger_status', 'active_session'],
};

async function buildDisplayData(
  userId: string,
  prefs: UserPreferences,
  apiKeyMap: Record<string, string>
): Promise<DisplayData> {
  const result: DisplayData = {
    nextRefresh: prefs.refresh_interval_minutes * 60 * 1000,
  };

  const tasks: Promise<void>[] = [];

  if (prefs.show_energy_price) {
    tasks.push(
      fetchEnergyPrice(prefs.energy_price_location)
        .then((price) => {
          result.price = price;
        })
        .catch((err: unknown) => {
          logger.error({ err }, 'Energy price fetch failed');
        })
    );
  }

  if (prefs.show_weather) {
    const weatherKey = apiKeyMap['openweathermap'];
    tasks.push(
      fetchWeather(prefs.weather_location, weatherKey)
        .then((weather) => {
          result.weather = weather;
        })
        .catch((err: unknown) => {
          logger.error({ err }, 'Weather fetch failed');
        })
    );
  }

  if (prefs.show_news) {
    const newsKey = apiKeyMap['newsapi'];
    tasks.push(
      fetchNews(prefs.news_language, newsKey)
        .then((news) => {
          result.news = news;
        })
        .catch((err: unknown) => {
          logger.error({ err }, 'News fetch failed');
        })
    );
  }

  if (prefs.show_monta) {
    const raw = apiKeyMap['monta'];
    if (raw) {
      try {
        const creds = JSON.parse(raw) as { clientId: string; clientSecret: string };
        const fields = prefs.monta_fields ?? ['charger_status', 'active_session'];
        tasks.push(
          fetchMontaData(userId, creds, fields)
            .then((monta) => { result.monta = monta; })
            .catch((err: unknown) => { logger.error({ err }, 'Monta fetch failed'); })
        );
      } catch {
        logger.warn('Monta credentials are not valid JSON — skipping');
      }
    }
  }

  if (prefs.show_zaptec) {
    const raw = apiKeyMap['zaptec'];
    if (raw) {
      try {
        const creds = JSON.parse(raw) as { username: string; password: string };
        const fields = prefs.zaptec_fields ?? ['charger_status', 'active_session'];
        tasks.push(
          fetchZaptecData(userId, creds, fields)
            .then((zaptec) => { result.zaptec = zaptec; })
            .catch((err: unknown) => { logger.error({ err }, 'Zaptec fetch failed'); })
        );
      } catch {
        logger.warn('Zaptec credentials are not valid JSON — skipping');
      }
    }
  }

  if (prefs.show_notion) {
    const raw = apiKeyMap['notion'];
    if (raw) {
      try {
        const creds = JSON.parse(raw) as NotionCredentials;
        tasks.push(
          fetchNotionData(userId, creds)
            .then((notion) => { result.notion = notion; })
            .catch((err: unknown) => { logger.error({ err }, 'Notion fetch failed'); })
        );
      } catch {
        logger.warn('Notion credentials are not valid JSON — skipping');
      }
    }
  }

  await Promise.all(tasks);
  return result;
}

/**
 * GET /api/preview
 * Auth-required preview endpoint for the dashboard
 */
router.get(
  '/',
  requireAuth,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const clerkUserId = req.clerkUserId!;

      // Resolve Supabase user from Clerk ID
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

      logApiUsage(user.id, '/api/preview');

      const prefs = (await getPreferences(user.id)) ?? DEFAULT_PREFS;

      const apiKeyRows = await getApiKeys(user.id);
      const apiKeyMap: Record<string, string> = {};
      for (const row of apiKeyRows) {
        apiKeyMap[row.provider] = row.api_key;
      }

      const data = await buildDisplayData(user.id, prefs, apiKeyMap);
      res.json(data);
    } catch (err) {
      next(err);
    }
  }
);

export default router;
