import { afterEach, describe, expect, it, vi } from 'vitest';
import { notionWidget } from '../widgets/notion';
import { fetchNotionRows } from '../widgets/notion/client';

const databaseId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const sourceId = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const config = { token: 'ntn_PRIVATE_TOKEN', databaseId };
const database = { object: 'database', title: [{ plain_text: 'Tasks' }], data_sources: [{ id: sourceId }] };
const rows = { results: [{ object: 'page', id: 'p1', properties: { Opgave: { type: 'title', title: [{ plain_text: 'Pay bill' }] } } }] };
const region = { widthPx: 250, heightPx: 100 };
afterEach(() => { vi.unstubAllGlobals(); });

describe('Notion widget current API', () => {
  it.each(['ntn_new', 'secret_old'])('accepts and normalizes %s and original database links', (token) => {
    expect(notionWidget.configSchema.parse({ token: ` ${token} `, databaseId: `https://www.notion.so/Tasks-${databaseId.replace(/-/g, '')}?v=private` }))
      .toEqual({ token, databaseId });
  });
  it.each([{ token: 1 }, { token: 'private' }, { databaseId: 'wrong' }, { dataSourceId: 'wrong' }, { maxItems: 11 }, { statusProperty: 1 }, { filterStatus: 'Active' }])('rejects malformed configuration %j', (patch) => {
    expect(notionWidget.configSchema.safeParse({ ...config, ...patch }).success).toBe(false);
  });
  it('discovers the source, infers a renamed title property, and uses bounded requests', async () => {
    const fetchMock = vi.fn(async (url: string, _init?: RequestInit) => new Response(JSON.stringify(url.includes('/databases/') ? database : rows)));
    vi.stubGlobal('fetch', fetchMock);
    expect(await notionWidget.fetch(config, region)).toEqual({ ok: true, data: { databaseName: 'Tasks', rows: [{ id: 'p1', title: 'Pay bill' }] } });
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([`https://api.notion.com/v1/databases/${databaseId}`, `https://api.notion.com/v1/data_sources/${sourceId}/query`]);
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ redirect: 'error', headers: { 'Notion-Version': '2025-09-03' } });
    expect(fetchMock.mock.calls[0][1]?.signal).toBe(fetchMock.mock.calls[1][1]?.signal);
  });
  it('never guesses among multiple sources', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ...database, data_sources: [{ id: sourceId }, { id: databaseId }] }))));
    expect(await notionWidget.fetch(config, region)).toEqual({ ok: false, error: 'Choose a data source ID for this Notion database.' });
  });
  it('queries an explicitly selected child source', async () => {
    const fetchMock = vi.fn(async (url: string) => new Response(JSON.stringify(url.includes('/databases/') ? { ...database, data_sources: [{ id: sourceId }, { id: databaseId }] } : rows)));
    vi.stubGlobal('fetch', fetchMock);
    expect((await notionWidget.fetch({ ...config, dataSourceId: sourceId }, region)).ok).toBe(true);
    expect(fetchMock.mock.calls[1][0]).toContain(`/data_sources/${sourceId}/query`);
  });
  it('sanitizes provider bodies and transport errors', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response('PRIVATE_TOKEN', { status: 403 })).mockRejectedValueOnce(new Error('PRIVATE_TOKEN'));
    vi.stubGlobal('fetch', fetchMock);
    expect(await notionWidget.fetch(config, region)).toEqual({ ok: false, error: 'Share the original Notion database with the connection and check its ID.' });
    expect(await notionWidget.fetch(config, region)).toEqual({ ok: false, error: 'Notion is unavailable. Try again later.' });
  });
  it('rejects oversized responses before parsing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(' '.repeat(256 * 1024 + 1))));
    expect(await notionWidget.fetch(config, region)).toEqual({ ok: false, error: 'Notion returned incomplete or invalid data. Try again later.' });
  });
  it('cancels a stalled body within the request deadline', async () => {
    const controller = new AbortController(); const cancel = vi.fn();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new ReadableStream({ cancel }))));
    const pending = fetchNotionRows(config, controller.signal);
    await Promise.resolve(); await Promise.resolve(); controller.abort();
    await expect(pending).rejects.toMatchObject({ code: 'timeout' });
    expect(cancel).toHaveBeenCalled();
  });
});
