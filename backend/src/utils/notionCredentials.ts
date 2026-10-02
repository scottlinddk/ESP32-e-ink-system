export interface NotionCredentials {
  token: string;
  databaseId: string;
  dataSourceId?: string;
  titleProperty?: string;
  statusProperty?: string;
  filterStatus?: string;
  maxItems?: number;
}

/** Normalize an ID or original Notion database link, never an arbitrary fetch URL. */
export function normalizeNotionId(raw: string): string {
  let value = raw.trim();
  if (value.length > 2048) throw new Error('Use a Notion database ID or link.');
  if (/^https:\/\//i.test(value)) {
    const url = new URL(value);
    if (url.username || url.password || !/^(?:[a-z0-9-]+\.)*notion\.(?:so|site)$/i.test(url.hostname)) {
      throw new Error('Use an original Notion database link.');
    }
    value = decodeURIComponent(url.pathname.split('/').filter(Boolean).pop() ?? '');
    value = value.match(/(?:^|-)([a-f0-9]{32}|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/i)?.[1] ?? '';
  }
  if (!/^(?:[a-f0-9]{32}|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/i.test(value)) {
    throw new Error('Use a 32-character Notion ID or original database link.');
  }
  const id = value.replace(/-/g, '').toLowerCase();
  return `${id.slice(0, 8)}-${id.slice(8, 12)}-${id.slice(12, 16)}-${id.slice(16, 20)}-${id.slice(20)}`;
}

/** Validate untrusted route input and return only normalized, supported fields. */
export function normalizeNotionCredentials(input: unknown): NotionCredentials {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Notion credentials must be an object.');
  const value = input as Record<string, unknown>;
  const allowed = ['token', 'databaseId', 'dataSourceId', 'titleProperty', 'statusProperty', 'filterStatus', 'maxItems'];
  if (Object.keys(value).some((key) => !allowed.includes(key))) throw new Error('Unsupported Notion credential field.');
  if (typeof value.token !== 'string' || value.token.trim().length > 512 || !/^(ntn_|secret_)[A-Za-z0-9_-]+$/.test(value.token.trim())) {
    throw new Error('Use a Notion integration token beginning with ntn_ or secret_.');
  }
  if (typeof value.databaseId !== 'string') throw new Error('Notion credentials require a database ID or link.');
  let databaseId: string;
  try { databaseId = normalizeNotionId(value.databaseId); }
  catch { throw new Error('Use a valid Notion database ID or original database link.'); }
  const result: NotionCredentials = { token: value.token.trim(), databaseId };
  if (value.dataSourceId !== undefined && value.dataSourceId !== '') {
    if (typeof value.dataSourceId !== 'string') throw new Error('Use a valid Notion data source ID.');
    try { result.dataSourceId = normalizeNotionId(value.dataSourceId); }
    catch { throw new Error('Use a valid Notion data source ID.'); }
  }
  for (const key of ['titleProperty', 'statusProperty', 'filterStatus'] as const) {
    if (value[key] === undefined) continue;
    if (typeof value[key] !== 'string' || value[key].length > 100 || /[\x00-\x1f\x7f]/.test(value[key])) {
      throw new Error('Notion property and filter names must be text of at most 100 characters.');
    }
    if (value[key].trim()) result[key] = value[key].trim();
  }
  if (result.filterStatus && !result.statusProperty) throw new Error('A status filter requires its property name.');
  if (value.maxItems !== undefined) {
    if (typeof value.maxItems !== 'number' || !Number.isInteger(value.maxItems) || value.maxItems < 1 || value.maxItems > 10) {
      throw new Error('Notion maxItems must be a whole number from 1 to 10.');
    }
    result.maxItems = value.maxItems;
  }
  return result;
}
