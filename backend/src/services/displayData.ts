import { fetchEnergyPrice } from './energinet';
import { fetchWeather } from './weather';
import { fetchNews } from './news';
import { fetchRssNews } from './rss';
import { fetchMontaData } from './monta';
import { fetchZaptecData } from './zaptec';
import { fetchNotionData, NotionCredentials } from './notion';
import { DisplayData, UserPreferences } from '../types/index';
import { logger } from '../lib/logger';

// JSON previews and display images use the same enabled sources. A failed
// source stays absent so an unavailable reading is never presented as live data.
export const DEFAULT_PREFS: UserPreferences = {
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
  news_source: 'newsapi',
  news_feed_url: '',
  news_item_limit: 3,
  refresh_interval_minutes: 30,
  layout: null,
  monta_fields: ['charger_status', 'active_session'],
  zaptec_fields: ['charger_status', 'active_session'],
};

const SOURCE_TIMEOUT_MS = 10_000;

async function withSourceDeadline<T>(load: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      const error = new Error('Display source timed out');
      controller.abort(error);
      reject(error);
    }, SOURCE_TIMEOUT_MS);
  });
  try {
    // Race the entire operation, including body parsing and SDK work that may
    // ignore cancellation. Only the winning result can update the display data.
    return await Promise.race([Promise.resolve().then(() => load(controller.signal)), deadline]);
  } finally {
    clearTimeout(timer);
  }
}

export async function buildDisplayData(
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
      withSourceDeadline((signal) => fetchEnergyPrice(prefs.energy_price_location, signal))
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
      withSourceDeadline((signal) => fetchWeather(prefs.weather_location, weatherKey, signal))
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
      withSourceDeadline((signal) => prefs.news_source === 'rss'
        ? fetchRssNews(prefs.news_feed_url ?? '', prefs.news_item_limit ?? 3, signal)
        : fetchNews(prefs.news_language, newsKey, signal))
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
          withSourceDeadline((signal) => fetchMontaData(userId, creds, fields, signal))
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
          withSourceDeadline((signal) => fetchZaptecData(userId, creds, fields, signal))
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
          withSourceDeadline((signal) => fetchNotionData(userId, creds, signal))
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
