import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DisplayLanguageCard } from '../../components/dashboard/DisplayLanguageCard';
import { DISPLAY_LANGUAGES, DISPLAY_LANGUAGE_EXAMPLES, DISPLAY_LANGUAGE_NAMES, displayLanguageOf } from '../displayLanguage';
import { STRINGS } from '../strings';

const session = vi.hoisted(() => ({ lang: 'en' as 'en' | 'da' }));
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'alice' }, isSignedIn: true, getToken: async () => 'auth' }) }));
vi.mock('../appContext', () => ({ useApp: () => ({ t: STRINGS[session.lang], lang: session.lang, toast: vi.fn() }) }));
beforeEach(() => { session.lang = 'en'; });

describe('display language values', () => {
  it('offers English and Danish, each named in itself', () => {
    expect(DISPLAY_LANGUAGES).toEqual(['en', 'da']);
    expect(DISPLAY_LANGUAGE_NAMES).toEqual({ en: 'English', da: 'Dansk' });
    expect(Object.keys(DISPLAY_LANGUAGE_EXAMPLES)).toEqual(['en', 'da']);
  });

  it('falls back to English for anything that is not a supported language', () => {
    expect(displayLanguageOf('da')).toBe('da');
    expect(displayLanguageOf('en')).toBe('en');
    for (const value of [undefined, null, '', 'fr', 'DA', 1, {}]) expect(displayLanguageOf(value)).toBe('en');
  });
});

function render(preferences: Record<string, unknown> | undefined, deviceId: string | null = 'kitchen') {
  const client = new QueryClient();
  if (preferences) client.setQueryData(deviceId ? ['preferences', 'alice', deviceId] : ['preferences', 'alice'], preferences);
  const html = renderToStaticMarkup(<QueryClientProvider client={client}><DisplayLanguageCard deviceId={deviceId ?? undefined} /></QueryClientProvider>);
  client.clear();
  return html;
}

describe('DisplayLanguageCard', () => {
  it('selects the language saved for the device and shows an example of it', () => {
    const html = render({ display_language: 'da' });
    expect(html).toContain('Display language');
    expect(html).toContain('<option value="en">English</option>');
    expect(html).toMatch(/<option value="da" selected="">Dansk<\/option>/);
    expect(html).toContain('Spot: 1,25 kr/kWh');
    expect(html).toContain('lang="da"');
  });

  it('shows English for a device that never chose a language, and keeps saving disabled until it changes', () => {
    const html = render({});
    expect(html).toMatch(/<option value="en" selected="">English<\/option>/);
    expect(html).toContain('Spot: 1.25 DKK/kWh');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Save language/);
  });

  it('does not offer a choice without a device, because the language belongs to a device', () => {
    expect(render({}, null)).toMatch(/<fieldset[^>]*disabled=""/);
  });

  it('is localized', () => {
    session.lang = 'da';
    const html = render({});
    expect(html).toContain('Skærmens sprog');
    expect(html).toContain('Gem sprog');
    expect(html).toContain('Vælg sproget for teksten i widgets på denne enhed.');
  });
});
