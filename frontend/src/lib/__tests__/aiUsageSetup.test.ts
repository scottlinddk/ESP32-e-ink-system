import { describe, expect, it } from 'vitest';
import { aiUsageSetup, machineName } from '../aiUsageSetup';
import { updateWidgetOptions, widgetOptionKind } from '../widgetOptions';

describe('AI usage collector setup', () => {
  it('uses the deployed HTTPS origin and the display time zone', () => {
    const setup = aiUsageSetup('https://eink.example.com', 'Europe/Copenhagen', 'Work Laptop');
    expect(setup.endpoint).toBe('https://eink.example.com/api/ai-usage/ingest');
    expect(setup.needsHttpsHost).toBe(false);
    expect(setup.init).toContain('--url https://eink.example.com/api/ai-usage/ingest');
    expect(setup.init).toContain('--machine work-laptop --timezone Europe/Copenhagen');
    expect(setup.init).toContain('PASTE_YOUR_AI_USAGE_TOKEN_HERE');
    expect(JSON.parse(setup.statusLine).statusLine.command).toMatch(/collector\.ts statusline$/);
  });

  it.each([undefined, 'http://eink.example.com', 'http://localhost:5173', 'https://127.0.0.1', 'https://user:pw@eink.example.com'])(
    'falls back to a placeholder for %s', (origin) => {
      const setup = aiUsageSetup(origin, 'UTC');
      expect(setup.needsHttpsHost).toBe(true);
      expect(setup.endpoint).toBe('https://YOUR-DISPLAY-HOST/api/ai-usage/ingest');
    });

  it('normalizes machine names to what the server accepts', () => {
    expect(machineName('Scott’s MacBook Pro')).toBe('scott-s-macbook-pro');
    expect(machineName('---')).toBe('laptop');
    expect(machineName('a'.repeat(40))).toHaveLength(32);
  });

  it('offers a view option for the AI usage widget only', () => {
    expect(widgetOptionKind('ai-usage')).toBe('ai-usage');
    const layout = { version: 1 as const, cols: 10 as const, rows: 6 as const, widgets: [{ i: 'ai-usage', x: 0, y: 0, w: 10, h: 2 }] };
    expect(updateWidgetOptions(layout, 'ai-usage', { view: 'condensed' }).widgets[0].options).toEqual({ view: 'condensed' });
  });
});
