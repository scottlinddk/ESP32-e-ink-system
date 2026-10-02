import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearNotionCache, fetchNotionData, NotionSourceError } from '../services/notion';
import { normalizeNotionCredentials, normalizeNotionId } from '../utils/notionCredentials';

const databaseId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const sourceId = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const otherId = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const credentials = { token: 'ntn_PRIVATE_TOKEN', databaseId };
const database = { object: 'database', title: [{ plain_text: 'Tasks' }], data_sources: [{ id: sourceId, name: 'List' }] };
const rows = { results: [{ object: 'page', id: 'row-1', properties: { Opgave: { type: 'title', title: [{ plain_text: 'Buy milk' }] }, Status: { type: 'status', status: { name: 'To do' } } } }] };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

describe('Notion credential normalization', () => {
  it.each(['ntn_current-token', 'secret_legacy_token'])('accepts and trims %s without changing its secret', (token) => {
    expect(normalizeNotionCredentials({ token: ` ${token} `, databaseId: databaseId.toUpperCase(), statusProperty: ' Status ', filterStatus: ' To do ', dataSourceId: '' }))
      .toEqual({ token, databaseId, statusProperty: 'Status', filterStatus: 'To do' });
  });
  it.each([databaseId, databaseId.replace(/-/g, ''), `https://www.notion.so/workspace/Tasks-${databaseId.replace(/-/g, '')}?v=private-view`, `https://example.notion.site/${databaseId}`])('normalizes ID/link %s', (value) => {
    expect(normalizeNotionId(value)).toBe(databaseId);
  });
  it.each([null, [], { token: 12 }, { token: 'Bearer private' }, { token: 'ntn_' }, { token: 'ntn_a\nb' }, { token: `ntn_${'a'.repeat(513)}` },
    { databaseId: {} }, { databaseId: 'https://evil.example/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' }, { databaseId: `https://user:password@notion.so/${databaseId}` },
    { dataSourceId: 1 }, { dataSourceId: 'not-an-id' }, { statusProperty: [] }, { titleProperty: 'x'.repeat(101) }, { filterStatus: 'Active' },
    { maxItems: '4' }, { maxItems: 0 }, { maxItems: 11 }, { maxItems: 1.5 }, { unknown: 'private' }])('rejects malformed credentials without echoing them: %j', (patch) => {
    const value = patch === null || Array.isArray(patch) ? patch : { ...credentials, ...patch };
    expect(() => normalizeNotionCredentials(value)).toThrow();
    try { normalizeNotionCredentials(value); } catch (error) { expect(String(error)).not.toContain('PRIVATE_TOKEN'); }
  });
});

describe('Notion database discovery and fetching', () => {
  beforeEach(() => clearNotionCache());
  afterEach(() => { clearNotionCache(); vi.unstubAllGlobals(); vi.useRealTimers(); });
  function setup(db = database, items = rows) {
    const fetchMock = vi.fn(async (url: string, _init?: RequestInit) => json(url.includes('/databases/') ? db : items));
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }
  it('retrieves a database then queries its distinct data source with the current version and inferred title', async () => {
    const fetchMock = setup();
    const result = await fetchNotionData('alice', { ...credentials, statusProperty: 'Status', filterStatus: 'To do', maxItems: 3 });
    expect(result).toEqual({ databaseName: 'Tasks', rows: [{ id: 'row-1', title: 'Buy milk', subtitle: 'To do' }] });
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([`https://api.notion.com/v1/databases/${databaseId}`, `https://api.notion.com/v1/data_sources/${sourceId}/query`]);
    expect(fetchMock.mock.calls[1][1]).toMatchObject({ method: 'POST', redirect: 'error', headers: { 'Notion-Version': '2025-09-03', Authorization: 'Bearer ntn_PRIVATE_TOKEN' } });
    expect(JSON.parse(fetchMock.mock.calls[1][1]!.body as string)).toEqual({ page_size: 3, filter: { property: 'Status', status: { equals: 'To do' } } });
  });
  it('requires an explicit source for multi-source databases and verifies it belongs to the database', async () => {
    const fetchMock = setup({ ...database, data_sources: [{ id: sourceId, name: 'First' }, { id: otherId, name: 'Second' }] });
    await expect(fetchNotionData('alice', credentials)).rejects.toMatchObject({ code: 'data_source_required' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await expect(fetchNotionData('alice', { ...credentials, dataSourceId: databaseId })).rejects.toMatchObject({ code: 'invalid_data_source' });
    await expect(fetchNotionData('alice', { ...credentials, dataSourceId: otherId })).resolves.toMatchObject({ rows: [{ title: 'Buy milk' }] });
    expect(fetchMock.mock.calls.at(-1)?.[0]).toContain(`/data_sources/${otherId}/query`);
  });
  it('isolates users, credentials, database/source and property settings in cache identity', async () => {
    const fetchMock = setup();
    await fetchNotionData('alice', credentials);
    await fetchNotionData('alice', credentials);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    for (const patch of [{ token: 'ntn_rotated' }, { databaseId: otherId }, { dataSourceId: sourceId }, { titleProperty: 'Other' }, { statusProperty: 'Status' }, { maxItems: 2 }]) {
      await fetchNotionData('alice', { ...credentials, ...patch });
    }
    await fetchNotionData('bob', credentials);
    expect(fetchMock).toHaveBeenCalledTimes(16);
    clearNotionCache('bob');
    await fetchNotionData('bob', credentials);
    expect(fetchMock).toHaveBeenCalledTimes(18);
  });
  it('expires cached results after 15 minutes', async () => {
    vi.useFakeTimers(); const fetchMock = setup();
    await fetchNotionData('alice', credentials);
    vi.advanceTimersByTime(15 * 60 * 1000 + 1);
    await fetchNotionData('alice', credentials);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });
  it.each([[401, 'invalid_token'], [403, 'access_denied'], [404, 'access_denied'], [400, 'invalid_configuration'], [429, 'rate_limited'], [503, 'unavailable']] as const)('maps HTTP %d to a safe diagnostic without response text', async (status, code) => {
    const fetchMock = vi.fn(async () => json({ message: 'PRIVATE_TOKEN secret database title' }, status)); vi.stubGlobal('fetch', fetchMock);
    await expect(fetchNotionData('alice', credentials)).rejects.toMatchObject({ code });
    try { await fetchNotionData('alice', credentials); } catch (error) {
      expect(error).toBeInstanceOf(NotionSourceError); expect(String(error)).not.toContain('PRIVATE_TOKEN');
    }
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it.each([null, {}, { ...database, data_sources: [] }, { ...database, data_sources: [{ id: 'not-an-id' }] }])('rejects malformed discovery data %j', async (value) => {
    vi.stubGlobal('fetch', vi.fn(async () => json(value)));
    await expect(fetchNotionData('alice', credentials)).rejects.toMatchObject({ code: 'invalid_response' });
  });
  it.each([null, { results: [{}] }, { results: [{ ...rows.results[0], properties: [] }] }, { results: [{ ...rows.results[0], properties: { Name: { type: 'title', title: [{ plain_text: {} }] } } }] }])('rejects malformed rows %j', async (value) => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => json(url.includes('/databases/') ? database : value)));
    await expect(fetchNotionData('alice', credentials)).rejects.toMatchObject({ code: 'invalid_response' });
  });
  it('rejects oversized streamed bodies and does not cache failures', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(' '.repeat(256 * 1024 + 1))).mockResolvedValueOnce(json(database)).mockResolvedValueOnce(json(rows));
    vi.stubGlobal('fetch', fetchMock);
    await expect(fetchNotionData('alice', credentials)).rejects.toMatchObject({ code: 'invalid_response' });
    await expect(fetchNotionData('alice', credentials)).resolves.toMatchObject({ rows: [{ title: 'Buy milk' }] });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
  it('cancels a stalled body under the same deadline and returns a safe timeout', async () => {
    const controller = new AbortController(); const cancel = vi.fn();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new ReadableStream({ cancel }))));
    const pending = fetchNotionData('alice', credentials, controller.signal);
    await Promise.resolve(); await Promise.resolve();
    controller.abort(new Error('PRIVATE_TOKEN'));
    await expect(pending).rejects.toMatchObject({ code: 'timeout' });
    expect(cancel).toHaveBeenCalled();
  });
});
