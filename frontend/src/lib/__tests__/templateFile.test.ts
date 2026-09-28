import { afterEach, describe, expect, it, vi } from 'vitest';
import { readTemplateFile } from '../templateFile';
import { importDisplayTemplate, validateDisplayTemplate } from '../api';

const template = { format: 'esp32-eink-template' as const, version: 1 as const, settings: { show_weather: false } };
afterEach(() => { vi.unstubAllGlobals(); });

describe('template file review', () => {
  it('reads a JSON document for server validation', async () => {
    expect(await readTemplateFile(new Blob([JSON.stringify(template)]))).toEqual(template);
  });
  it('rejects a file larger than the limit before reading it', async () => {
    const text = vi.fn();
    await expect(readTemplateFile({ size: 8193, text } as unknown as Blob)).rejects.toThrow('8 KiB');
    expect(text).not.toHaveBeenCalled();
  });
  it('explains malformed JSON', async () => {
    await expect(readTemplateFile(new Blob(['{broken']))).rejects.toThrow('valid JSON');
  });
  it('keeps validation and save as separate requests with identical reviewed settings', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ template }))).mockResolvedValueOnce(new Response(JSON.stringify({ preferences: template.settings })));
    vi.stubGlobal('fetch', fetchMock);
    const reviewed = await validateDisplayTemplate('token', template);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toContain('/templates/validate');
    await importDisplayTemplate('token', reviewed.template);
    expect(fetchMock.mock.calls[1][0]).toContain('/templates/import');
    expect(fetchMock.mock.calls[0][1].body).toBe(fetchMock.mock.calls[1][1].body);
  });
});
