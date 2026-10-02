import type { NotionData, NotionRow } from './types';
import { normalizeNotionCredentials, normalizeNotionId, type NotionCredentials } from './credentials';
export type { NotionCredentials } from './credentials';

const MAX_RESPONSE_BYTES = 256 * 1024;
const MESSAGES = {
  invalid_configuration: 'Check the Notion database, property and filter settings.',
  invalid_token: 'Notion rejected the integration token. Save a current token.',
  access_denied: 'Share the original Notion database with the connection and check its ID.',
  data_source_required: 'Choose a data source ID for this Notion database.',
  invalid_data_source: 'The selected data source does not belong to this database.',
  invalid_response: 'Notion returned incomplete or invalid data. Try again later.',
  rate_limited: 'Notion request limit reached. Try again later.',
  timeout: 'Notion did not respond in time. Try again.',
  unavailable: 'Notion is unavailable. Try again later.',
} as const;
export type NotionSourceErrorCode = keyof typeof MESSAGES;
export class NotionSourceError extends Error {
  constructor(readonly code: NotionSourceErrorCode) { super(MESSAGES[code]); this.name = 'NotionSourceError'; }
}

async function request(path: string, token: string, signal: AbortSignal, body?: object): Promise<Record<string, unknown>> {
  const response = await fetch(`https://api.notion.com/v1/${path}`, {
    method: body ? 'POST' : 'GET', signal, redirect: 'error',
    headers: { Authorization: `Bearer ${token}`, 'Notion-Version': '2025-09-03', 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (signal.aborted) { void response.body?.cancel().catch(() => {}); signal.throwIfAborted(); }
  if (!response.ok) {
    void response.body?.cancel().catch(() => {});
    throw new NotionSourceError(response.status === 401 ? 'invalid_token' : response.status === 403 || response.status === 404 ? 'access_denied'
      : response.status === 429 ? 'rate_limited' : response.status === 400 ? 'invalid_configuration' : 'unavailable');
  }
  if (!response.body || Number(response.headers.get('content-length')) > MAX_RESPONSE_BYTES) {
    void response.body?.cancel().catch(() => {});
    throw new NotionSourceError('invalid_response');
  }
  const reader = response.body.getReader();
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', cancel, { once: true });
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      signal.throwIfAborted();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_RESPONSE_BYTES) { cancel(); throw new NotionSourceError('invalid_response'); }
      chunks.push(value);
    }
  } finally { signal.removeEventListener('abort', cancel); reader.releaseLock(); }
  let json: unknown;
  try { json = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new NotionSourceError('invalid_response'); }
  if (!json || typeof json !== 'object' || Array.isArray(json)) throw new NotionSourceError('invalid_response');
  return json as Record<string, unknown>;
}

function text(items: unknown, limit: number): string {
  if (!Array.isArray(items)) throw new NotionSourceError('invalid_response');
  let result = '';
  for (const item of items) {
    if (!item || typeof item.plain_text !== 'string') throw new NotionSourceError('invalid_response');
    result += item.plain_text;
    if (result.length >= limit) break;
  }
  return result.slice(0, limit);
}

export async function fetchNotionRows(credentials: NotionCredentials, signal: AbortSignal = AbortSignal.timeout(10_000)): Promise<NotionData> {
  try {
    signal.throwIfAborted();
    let creds: NotionCredentials;
    try { creds = normalizeNotionCredentials(credentials); }
    catch { throw new NotionSourceError('invalid_configuration'); }

    const database = await request(`databases/${creds.databaseId}`, creds.token, signal);
    if (database.object !== 'database' || !Array.isArray(database.data_sources) || !database.data_sources.length) throw new NotionSourceError('invalid_response');
    const sources = database.data_sources.map((source: unknown) => {
      if (!source || typeof source !== 'object' || !('id' in source) || typeof source.id !== 'string') throw new NotionSourceError('invalid_response');
      try { return normalizeNotionId(source.id); } catch { throw new NotionSourceError('invalid_response'); }
    });
    if (!creds.dataSourceId && sources.length > 1) throw new NotionSourceError('data_source_required');
    const sourceId = creds.dataSourceId ?? sources[0];
    if (!sources.includes(sourceId)) throw new NotionSourceError('invalid_data_source');
    const response = await request(`data_sources/${sourceId}/query`, creds.token, signal, {
      page_size: creds.maxItems ?? 4,
      ...(creds.filterStatus && creds.statusProperty ? { filter: { property: creds.statusProperty, status: { equals: creds.filterStatus } } } : {}),
    });
    if (!Array.isArray(response.results) || response.results.length > (creds.maxItems ?? 4)) throw new NotionSourceError('invalid_response');
    const rows: NotionRow[] = response.results.map((page) => {
      if (!page || page.object !== 'page' || typeof page.id !== 'string' || !page.properties || typeof page.properties !== 'object' || Array.isArray(page.properties)) throw new NotionSourceError('invalid_response');
      const properties = page.properties as Record<string, Record<string, unknown>>;
      const title = creds.titleProperty ? properties[creds.titleProperty] : Object.values(properties).find((property) => property?.type === 'title');
      const row: NotionRow = { id: page.id.slice(0, 64), title: title?.type === 'title' ? text(title.title, 40) || '(Untitled)' : '(Untitled)' };
      const status = creds.statusProperty ? properties[creds.statusProperty] : undefined;
      if (status) {
        let subtitle: unknown;
        if (status.type === 'status' || status.type === 'select') subtitle = (status[status.type] as { name?: unknown } | null)?.name;
        else if (status.type === 'rich_text') subtitle = text(status.rich_text, 80);
        else if (status.type === 'date') subtitle = (status.date as { start?: unknown } | null)?.start;
        else if (status.type === 'checkbox') subtitle = status.checkbox === true ? '✓' : undefined;
        if (subtitle !== undefined && typeof subtitle !== 'string') throw new NotionSourceError('invalid_response');
        if (subtitle) row.subtitle = subtitle.slice(0, 80);
      }
      return row;
    });
    const data: NotionData = { rows, ...(database.title ? { databaseName: text(database.title, 40) } : {}) };
    signal.throwIfAborted();
    return data;
  } catch (error) {
    if (signal.aborted) throw new NotionSourceError('timeout');
    if (error instanceof NotionSourceError) throw error;
    throw new NotionSourceError('unavailable');
  }
}
