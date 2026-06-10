import { Client } from '@notionhq/client';
import type { PageObjectResponse } from '@notionhq/client/build/src/api-endpoints';
import { CacheEntry } from '../types/index';
import { NotionData, NotionRow } from '../types/index';

const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes
const cache = new Map<string, CacheEntry<NotionData>>();

function isCacheValid<T>(entry: CacheEntry<T>): boolean {
  return Date.now() < entry.expiresAt;
}

function extractTitle(page: PageObjectResponse, propName: string): string {
  const prop = page.properties[propName];
  if (!prop) return '(Untitled)';
  if (prop.type === 'title') {
    return prop.title.map((t) => t.plain_text).join('') || '(Untitled)';
  }
  return '(Untitled)';
}

function extractText(page: PageObjectResponse, propName: string): string | undefined {
  const prop = page.properties[propName];
  if (!prop) return undefined;
  switch (prop.type) {
    case 'select': return prop.select?.name ?? undefined;
    case 'status': return prop.status?.name ?? undefined;
    case 'rich_text': return prop.rich_text.map((t) => t.plain_text).join('') || undefined;
    case 'date': return prop.date?.start ?? undefined;
    case 'checkbox': return prop.checkbox ? '✓' : undefined;
    default: return undefined;
  }
}

function parseDatabaseId(raw: string): string {
  const clean = raw.replace(/-/g, '').replace(/^.*\/([a-f0-9]{32})(\?.*)?$/, '$1');
  if (/^[a-f0-9]{32}$/i.test(clean)) {
    return `${clean.slice(0, 8)}-${clean.slice(8, 12)}-${clean.slice(12, 16)}-${clean.slice(16, 20)}-${clean.slice(20)}`;
  }
  return raw;
}

export interface NotionCredentials {
  token: string;
  databaseId: string;
  titleProperty?: string;
  statusProperty?: string;
  filterStatus?: string;
  maxItems?: number;
}

export async function fetchNotionData(
  userId: string,
  creds: NotionCredentials
): Promise<NotionData> {
  const cacheKey = `notion:${userId}`;
  const cached = cache.get(cacheKey);
  if (cached && isCacheValid(cached)) {
    return cached.data;
  }

  const client = new Client({ auth: creds.token, notionVersion: '2025-09-03' });
  const dbId = parseDatabaseId(creds.databaseId);
  const titleProp = creds.titleProperty ?? 'Name';
  const maxItems = creds.maxItems ?? 4;

  const filter =
    creds.filterStatus && creds.statusProperty
      ? { property: creds.statusProperty, status: { equals: creds.filterStatus } }
      : undefined;

  const response = await client.dataSources.query({
    data_source_id: dbId,
    ...(filter ? { filter } : {}),
    page_size: maxItems,
  });

  const rows: NotionRow[] = response.results
    .filter((p): p is PageObjectResponse => (p as PageObjectResponse).object === 'page' && 'properties' in p)
    .map((page: PageObjectResponse) => ({
      id: page.id,
      title: extractTitle(page, titleProp).slice(0, 40),
      subtitle: creds.statusProperty ? extractText(page, creds.statusProperty) : undefined,
    }));

  const result: NotionData = { rows };
  cache.set(cacheKey, { data: result, expiresAt: Date.now() + CACHE_TTL_MS });
  return result;
}

export function clearNotionCache(userId?: string): void {
  if (userId) {
    cache.delete(`notion:${userId}`);
  } else {
    cache.clear();
  }
}
