import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DisplayRefreshIntervalCard } from '../../components/dashboard/DisplayRefreshIntervalCard';
import { formatRefreshInterval, isSelectableRefreshInterval, REFRESH_INTERVAL_OPTIONS, refreshIntervalChoices } from '../refreshInterval';
import { STRINGS } from '../strings';

const session = vi.hoisted(() => ({ lang: 'en' as 'en' | 'da' }));
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'alice' }, isSignedIn: true, getToken: async () => 'auth' }) }));
vi.mock('../appContext', () => ({ useApp: () => ({ t: STRINGS[session.lang], lang: session.lang, toast: vi.fn() }) }));
beforeEach(() => { session.lang = 'en'; });

describe('refresh interval options', () => {
  it('offers every 5 minutes from 5 to 60', () => {
    expect(REFRESH_INTERVAL_OPTIONS).toEqual([5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60]);
    expect(isSelectableRefreshInterval(30)).toBe(true);
    for (const minutes of [0, 1, 4, 7, 65, 1440]) expect(isSelectableRefreshInterval(minutes)).toBe(false);
  });
  it('keeps an off-grid saved value visible in sorted order', () => {
    expect(refreshIntervalChoices(30)).toEqual(REFRESH_INTERVAL_OPTIONS);
    expect(refreshIntervalChoices(undefined)).toEqual(REFRESH_INTERVAL_OPTIONS);
    expect(refreshIntervalChoices(2)[0]).toBe(2);
    expect(refreshIntervalChoices(1440).at(-1)).toBe(1440);
    expect(refreshIntervalChoices(1440)).toHaveLength(REFRESH_INTERVAL_OPTIONS.length + 1);
  });
  it('formats hours in both languages', () => {
    expect(formatRefreshInterval(15, false)).toBe('15 min');
    expect(formatRefreshInterval(60, false)).toBe('1 hour');
    expect(formatRefreshInterval(60, true)).toBe('1 time');
    expect(formatRefreshInterval(1440, true)).toBe('24 timer');
  });
});

function render(minutes: number) {
  const client = new QueryClient();
  client.setQueryData(['preferences', 'alice', 'kitchen'], { refresh_interval_minutes: minutes });
  const html = renderToStaticMarkup(<QueryClientProvider client={client}><DisplayRefreshIntervalCard deviceId="kitchen" /></QueryClientProvider>);
  client.clear();
  return html;
}

describe('DisplayRefreshIntervalCard', () => {
  it('lists the 5-minute steps and selects the saved device value', () => {
    const html = render(45);
    expect(html).toContain('Refresh every');
    expect(html).toContain('<option value="5">5 min</option>');
    expect(html).toContain('<option value="60">1 hour</option>');
    expect(html).toMatch(/<option value="45" selected="">45 min<\/option>/);
    expect(html).not.toContain('(current)');
  });
  it('marks a legacy off-grid value as current instead of hiding it', () => {
    expect(render(1440)).toMatch(/<option value="1440" selected="">24 hours \(current\)<\/option>/);
  });
  it('is localized', () => {
    session.lang = 'da';
    const html = render(30);
    expect(html).toContain('Opdatér hver');
    expect(html).toContain('Gem interval');
  });
});
