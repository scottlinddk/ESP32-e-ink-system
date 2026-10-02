import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDraftPreview, EMPTY_DRAFT_PREVIEW } from '../draftPreview';
import { fetchDraftPreviewBmp } from '../api';
import type { DisplayLayout } from '../../types';
import { previewHeaders } from './previewFixtures';

beforeEach(() => {
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:draft');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('draft preview lifecycle', () => {
  it('reports loading and success, then releases pixels when the layout changes', async () => {
    const publish = vi.fn();
    const preview = createDraftPreview(publish);
    await preview.render(async () => new Blob(['bmp']));
    expect(publish.mock.calls.map(([state]) => state.status)).toEqual(['loading', 'success']);
    preview.reset();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:draft');
    expect(publish).toHaveBeenLastCalledWith(EMPTY_DRAFT_PREVIEW);
  });

  it('ignores an old request completing after a newer layout request', async () => {
    const publish = vi.fn();
    const preview = createDraftPreview(publish);
    let complete!: (value: Blob) => void;
    let firstSignal!: AbortSignal;
    const first = preview.render((signal) => {
      firstSignal = signal;
      return new Promise((resolve) => { complete = resolve; });
    });
    await preview.render(async () => new Blob(['current']));
    complete(new Blob(['old']));
    await first;
    expect(firstSignal.aborted).toBe(true);
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    expect(publish.mock.calls.map(([state]) => state.status)).toEqual(['loading', 'loading', 'success']);
    preview.dispose();
  });

  it('reports failures and supports a successful retry', async () => {
    const publish = vi.fn();
    const preview = createDraftPreview(publish);
    await preview.render(async () => { throw new Error('offline'); });
    expect(publish).toHaveBeenLastCalledWith({ status: 'error', error: 'offline', imageUrl: null });
    await preview.render(async () => new Blob(['retry']));
    expect(publish).toHaveBeenLastCalledWith({ status: 'success', error: null, imageUrl: 'blob:draft' });
    preview.dispose();
  });

  it.each(['reset', 'dispose'] as const)('cancels pending work on %s and does not publish late results', async (action) => {
    const publish = vi.fn();
    const preview = createDraftPreview(publish);
    let fail!: (error: Error) => void;
    let requestSignal!: AbortSignal;
    const pending = preview.render((signal) => {
      requestSignal = signal;
      return new Promise((_resolve, reject) => { fail = reject; });
    });
    preview[action]();
    publish.mockClear();
    fail(new Error('late failure'));
    await pending;
    expect(requestSignal.aborted).toBe(true);
    expect(publish).not.toHaveBeenCalled();
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });
});

describe('draft preview API', () => {
  const layout: DisplayLayout = { version: 1, cols: 10, rows: 6, widgets: [] };
  it('sends the authenticated draft and passes cancellation to fetch', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(new Blob(['bmp']), { headers: previewHeaders('', true) }));
    vi.stubGlobal('fetch', fetchMock);
    const signal = new AbortController().signal;
    expect((await fetchDraftPreviewBmp('user-token', layout, signal)).size).toBe(3);
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/api/image/preview/draft'), {
      method: 'POST', body: JSON.stringify({ layout }), signal,
      headers: { Authorization: 'Bearer user-token', 'Content-Type': 'application/json' },
    });
  });

  it('exposes actionable layout validation errors for retry', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'Widgets must not overlap.' }), { status: 400 })));
    await expect(fetchDraftPreviewBmp('user-token', layout)).rejects.toThrow('Widgets must not overlap.');
  });
});
