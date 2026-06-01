import { Router, Request, Response, NextFunction } from 'express';
import { requireAuth } from '../middleware/auth';
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
import { DisplayData, UserPreferences } from '../types/index';
import { createClerkClient } from '@clerk/backend';

const router = Router();

const DEFAULT_PREFS: UserPreferences = {
  show_energy_price: true,
  show_weather: true,
  show_news: true,
  show_calendar: false,
  show_air_quality: false,
  energy_price_location: 'DK1',
  weather_location: '55.3,10.4',
  news_language: 'da',
  refresh_interval_minutes: 30,
};

async function buildDisplayData(
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
          console.error('Energy price fetch failed:', err);
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
          console.error('Weather fetch failed:', err);
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
          console.error('News fetch failed:', err);
        })
    );
  }

  await Promise.all(tasks);
  return result;
}

/**
 * GET /api/display-data/:userId
 * Device-facing endpoint — authenticated via licenseKey query param (no JWT required)
 */
router.get(
  '/:userId',
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { userId } = req.params as { userId: string };
      const { licenseKey } = req.query as { licenseKey?: string };

      if (!licenseKey) {
        res.status(401).json({ error: 'licenseKey query parameter is required' });
        return;
      }

      // Validate license key
      const device = await getDeviceByLicenseKey(licenseKey);
      if (!device) {
        res.status(401).json({ error: 'Invalid license key' });
        return;
      }

      if (device.user_id !== userId) {
        res.status(403).json({ error: 'License key does not belong to this user' });
        return;
      }

      // Update last seen timestamp (fire and forget)
      updateDeviceLastSeen(device.id).catch((err: unknown) =>
        console.error('Failed to update device last_seen:', err)
      );

      // Log usage (fire and forget)
      logApiUsage(userId, '/api/display-data');

      // Get preferences
      const prefs = (await getPreferences(userId)) ?? DEFAULT_PREFS;

      // Get API keys
      const apiKeyRows = await getApiKeys(userId);
      const apiKeyMap: Record<string, string> = {};
      for (const row of apiKeyRows) {
        apiKeyMap[row.provider] = row.api_key;
      }

      const data = await buildDisplayData(prefs, apiKeyMap);
      res.json(data);
    } catch (err) {
      next(err);
    }
  }
);

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

      const data = await buildDisplayData(prefs, apiKeyMap);
      res.json(data);
    } catch (err) {
      next(err);
    }
  }
);

export default router;
