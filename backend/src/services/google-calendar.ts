import { google } from 'googleapis';
import { getOAuthConnection, upsertOAuthConnection } from './strava';
import { getOAuthAppCreds } from './database';
import { decrypt } from '../utils/crypto';
import { IcsCalendarData, IcsCalendarEvent, CacheEntry } from '../types/index';
import { logger } from '../lib/logger';

const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes
const cache = new Map<string, CacheEntry<IcsCalendarData>>();

function isCacheValid<T>(entry: CacheEntry<T>): boolean {
  return Date.now() < entry.expiresAt;
}

function formatDate(d: Date, timeZone: string): { timeLabel: string; isToday: boolean } {
  const now = new Date();
  const todayStr = now.toLocaleDateString('en-CA', { timeZone });
  const dateStr = d.toLocaleDateString('en-CA', { timeZone });
  const isToday = dateStr === todayStr;
  const timeLabel = d.toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone,
  });
  return { timeLabel, isToday };
}

export interface GoogleCalendarFetchOptions {
  calendarId?: string;
  maxEvents?: number;
  daysAhead?: number;
  label?: string;
  timeZone?: string;
}

export async function fetchGoogleCalendarData(
  userId: string,
  opts: GoogleCalendarFetchOptions = {}
): Promise<IcsCalendarData> {
  const cacheKey = `gcal:${userId}:${opts.calendarId ?? 'primary'}`;
  const cached = cache.get(cacheKey);
  if (cached && isCacheValid(cached)) return cached.data;

  const conn = await getOAuthConnection(userId, 'google_calendar');
  if (!conn) throw new Error('Google Calendar not connected. Please authorise via the dashboard.');

  // App credentials are needed for token refresh; fall back to env vars then empty
  // strings so requests using a still-valid access token succeed without them set.
  const appCreds = await getOAuthAppCreds(userId, 'google');

  const oauth2Client = new google.auth.OAuth2(
    appCreds?.clientId ?? '',
    appCreds?.clientSecret ?? '',
    process.env.GOOGLE_REDIRECT_URI
  );

  const accessToken = decrypt(conn.access_token);
  const refreshToken = conn.refresh_token ? decrypt(conn.refresh_token) : null;
  const expiresAt = conn.expires_at ? new Date(conn.expires_at).getTime() : 0;

  oauth2Client.setCredentials({
    access_token: accessToken,
    refresh_token: refreshToken,
    expiry_date: expiresAt,
  });

  // Persist refreshed tokens back to DB
  oauth2Client.on('tokens', async (tokens) => {
    try {
      await upsertOAuthConnection(
        userId,
        'google_calendar',
        tokens.access_token!,
        tokens.refresh_token ?? refreshToken,
        tokens.expiry_date ? new Date(tokens.expiry_date) : null,
        conn.provider_account_id ?? undefined
      );
    } catch (err) {
      logger.warn({ err }, 'Failed to persist refreshed Google Calendar tokens');
    }
  });

  const calendarId = opts.calendarId ?? 'primary';
  const maxEvents = opts.maxEvents ?? 3;
  const daysAhead = opts.daysAhead ?? 7;
  const label = opts.label ?? 'Calendar';
  const timeZone = opts.timeZone ?? 'Europe/Copenhagen';

  const now = new Date();
  const cutoff = new Date(now.getTime() + daysAhead * 24 * 60 * 60 * 1000);

  const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
  const resp = await calendar.events.list({
    calendarId,
    timeMin: now.toISOString(),
    timeMax: cutoff.toISOString(),
    maxResults: maxEvents,
    singleEvents: true,
    orderBy: 'startTime',
  });

  const items = resp.data.items ?? [];
  const todayLabel = now.toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone,
  });

  const events: IcsCalendarEvent[] = items.map((item) => {
    const startStr = item.start?.dateTime ?? item.start?.date;
    const allDay = !item.start?.dateTime;
    let timeLabel = 'All day';
    let isToday = false;
    if (startStr) {
      const startDate = new Date(startStr);
      if (!allDay) {
        ({ timeLabel, isToday } = formatDate(startDate, timeZone));
      } else {
        const todayStr = now.toLocaleDateString('en-CA', { timeZone });
        isToday = startStr === todayStr;
      }
    }
    return {
      summary: (item.summary ?? 'No title').slice(0, 40),
      timeLabel,
      isToday,
    };
  });

  const result: IcsCalendarData = { label, today: todayLabel, events };
  cache.set(cacheKey, { data: result, expiresAt: Date.now() + CACHE_TTL_MS });
  return result;
}

export function clearGoogleCalendarCache(userId?: string): void {
  if (userId) {
    for (const key of cache.keys()) {
      if (key.startsWith(`gcal:${userId}:`)) cache.delete(key);
    }
  } else {
    cache.clear();
  }
}
