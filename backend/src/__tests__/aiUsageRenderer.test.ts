import { describe, expect, it } from 'vitest';
import { formatEstimate, formatReset, formatResetIn, formatTokens, formatUsd, renderAiUsageWidget } from '../utils/aiUsageRenderer';
import { BmpCanvas } from '../utils/bmpGenerator';
import type { AiProviderView, AiUsageData } from '../aiUsage/types';

const NOW = new Date('2026-10-07T10:00:00Z');
const claude: AiProviderView = {
  provider: 'claude', label: 'Claude', limitsObservedAt: '2026-10-07T09:50:00Z',
  limits: [
    { label: '5h', usedPercent: 58, resetsAt: '2026-10-07T12:20:00Z' },
    { label: '7d', usedPercent: 31, resetsAt: '2026-10-12T08:00:00Z' },
  ],
  today: { tokens: 2_100_000, costUsd: 4.8, partial: false }, monthCostUsd: 45.2,
};
// Claude's own example: 15% of the session, 68% of the week, 83% of input served from cache.
const detailedClaude: AiProviderView = {
  ...claude,
  limits: [
    { label: '5h', usedPercent: 15, resetsAt: '2026-10-07T10:58:00Z' },
    { label: '7d', usedPercent: 68, resetsAt: '2026-10-08T18:00:00Z' },
  ],
  today: { tokens: 283_601, breakdown: { input: 6, output: 795, cacheRead: 234_100, cacheWrite: 49_500 }, costUsd: 0.23, partial: false },
};
const openai: AiProviderView = {
  provider: 'openai', label: 'OpenAI', limitsObservedAt: '2026-10-07T06:00:00Z',
  limits: [{ label: '5h', usedPercent: null, resetsAt: '2026-10-07T09:00:00Z' }, { label: '7d', usedPercent: 49, resetsAt: '2026-10-09T08:00:00Z' }],
  today: null, monthCostUsd: null, adminError: { code: 'invalid_key', message: 'x' },
};

class Recorder {
  texts: Array<{ text: string; x: number; y: number }> = [];
  fills = 0;
  drawText(text: string, x: number, y: number) { this.texts.push({ text, x, y }); }
  drawHLine() { /* recorded via fills only */ }
  fillRect() { this.fills++; }
}

function render(data: AiUsageData | undefined, height = 122, view?: 'full' | 'condensed', width = 250) {
  const canvas = new Recorder();
  renderAiUsageWidget(canvas, { x: 0, y: 0, width, height }, data, { now: NOW, timeZone: 'Europe/Copenhagen', view });
  return canvas;
}

describe('AI usage formatting', () => {
  it('formats tokens, dollars, estimates and reset times compactly', () => {
    expect([formatTokens(950), formatTokens(12_345), formatTokens(2_100_000), formatTokens(150_000_000), formatTokens(3e9)])
      .toEqual(['950', '12.3k', '2.1M', '150M', '3B']);
    expect([formatUsd(4.8), formatUsd(123.4), formatUsd(1530)]).toEqual(['$4.80', '$123', '$1.5k']);
    expect(formatEstimate({ tokens: 1, costUsd: 4.8, partial: true })).toBe('~$4.80+');
    expect(formatEstimate({ tokens: 1, costUsd: null, partial: false })).toBe('');
    expect(formatReset('2026-10-07T12:20:00Z', NOW, 'Europe/Copenhagen')).toBe('14:20');
    expect(formatReset('2026-10-12T08:00:00Z', NOW, 'Europe/Copenhagen')).toBe('Mon');
  });

  it('words a reset as Claude does: minutes ahead, then the time, then weekday and time', () => {
    expect(formatResetIn('2026-10-07T10:58:00Z', NOW, 'Europe/Copenhagen')).toBe('in 58m');
    expect(formatResetIn('2026-10-07T10:00:20Z', NOW, 'Europe/Copenhagen')).toBe('in 1m');
    expect(formatResetIn('2026-10-07T12:20:00Z', NOW, 'Europe/Copenhagen')).toBe('14:20');
    expect(formatResetIn('2026-10-08T18:00:00Z', NOW, 'Europe/Copenhagen')).toBe('Thu 20:00');
  });
});

describe('AI usage widget', () => {
  it('draws stacked quota windows with the billed month, and marks stale or failed sources', () => {
    const texts = render({ providers: [claude, openai] }).texts.map((entry) => entry.text);
    expect(texts).toEqual(expect.arrayContaining(['CLAUDE', '2.1M ~$4.80', 'Session', '58%', 'Resets 14:20', 'Weekly', '31%', 'Resets Mon 10:00', 'API month $45.20']));
    // A reset window reads "reset", a stale report shows its age, a rejected key says so.
    expect(texts).toEqual(expect.arrayContaining(['OPENAI 4h', 'reset', '49%', 'API: check key']));
    // The reset window's old reset time (09:00 UTC, 11:00 local) is not drawn.
    expect(texts.join(' ')).not.toContain('11:00');
  });

  it('adds the token breakdown and cache hit rate to the detailed view when there is room', () => {
    const texts = render({ providers: [detailedClaude] }).texts.map((entry) => entry.text);
    expect(texts).toEqual(expect.arrayContaining([
      'Session', 'Resets in 58m', '15%', 'Weekly', 'Resets Thu 20:00', '68%',
      'Input', '6', 'Output', '795', 'Cache rd', '234k', 'Cache wr', '49.5k', 'Cache hit 83%', 'API month $45.20',
    ]));
  });

  it('keeps the breakdown out of the condensed view', () => {
    const texts = render({ providers: [detailedClaude] }, 122, 'condensed').texts.map((entry) => entry.text);
    expect(texts).toEqual(expect.arrayContaining(['Session', 'Resets in 58m', '15%', 'Weekly', '68%', 'API month $45.20']));
    expect(texts).not.toContain('Input');
    expect(texts).not.toContain('Cache hit 83%');
  });

  it('drops the breakdown before the quota windows when the widget is too short for it', () => {
    // 52px holds the header, two stacked windows and the month, but not the token grid.
    const texts = render({ providers: [detailedClaude] }, 54).texts.map((entry) => entry.text);
    expect(texts).toEqual(expect.arrayContaining(['Session', 'Weekly', 'API month $45.20']));
    expect(texts).not.toContain('Input');
  });

  it('falls back to inline bars, then to one line per provider, as the widget gets shorter', () => {
    const inline = render({ providers: [claude, openai] }, 45).texts.map((entry) => entry.text);
    expect(inline).toEqual(expect.arrayContaining(['5h', '58%', '14:20', '7d', '31%']));
    expect(inline).not.toContain('Session');
    expect(render({ providers: [claude, openai] }, 24).texts.map((entry) => entry.text))
      .toEqual(['Claude 5h 58% 7d 31%', '~$4.80', 'OpenAI 5h reset 7d 49%*']);
  });

  it('never draws outside its bounds on the real canvas', () => {
    const canvas = new BmpCanvas();
    // No clip here: the renderer itself must keep to the widget area.
    renderAiUsageWidget(canvas, { x: 0, y: 0, width: 125, height: 61 }, { providers: [claude, openai] }, { now: NOW, timeZone: 'UTC' });
    const raw = canvas.toRawPixels();
    const stride = Math.ceil(250 / 8);
    const outside: string[] = [];
    let inside = 0;
    for (let y = 0; y < 122; y++) for (let x = 0; x < 250; x++) {
      const black = (raw[y * stride + Math.floor(x / 8)] & (0x80 >> (x % 8))) === 0;
      if (black && (x >= 125 || y >= 61)) outside.push(`${x},${y}`);
      if (black && x < 125 && y < 61) inside++;
    }
    expect(outside).toEqual([]);
    expect(inside).toBeGreaterThan(0);
  });

  it('explains an empty or failed source instead of drawing zeros', () => {
    expect(render({ providers: [] }).texts.map((entry) => entry.text)).toEqual(['AI usage: no source']);
    expect(render(undefined).texts.map((entry) => entry.text)).toEqual(['AI usage: unavailable']);
  });
});
