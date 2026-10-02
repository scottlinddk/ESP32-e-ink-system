import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DisplayCard } from '../../components/dashboard/DisplayCard';
import { STRINGS } from '../strings';

const settings = vi.hoisted(() => ({ language: 'da', source: 'newsapi', lang: 'en' as 'en' | 'da' }));
vi.mock('../../hooks/usePreferences', () => ({
  usePreferences: () => ({ data: { show_news: true, show_weather: false, news_source: settings.source, news_language: settings.language, news_feed_url: 'https://example.com/rss' }, isPending: false, isError: false }),
  useSavePreferences: () => ({ isPending: false, mutateAsync: vi.fn() }),
}));
vi.mock('../appContext', () => ({ useApp: () => ({ t: STRINGS[settings.lang], lang: settings.lang, online: true, toast: vi.fn() }) }));
beforeEach(() => { settings.language = 'da'; settings.source = 'newsapi'; settings.lang = 'en'; });
const render = () => renderToStaticMarkup(<DisplayCard />);

describe('NewsAPI coverage guidance', () => {
  it.each(['da', 'fi'])('preserves saved %s selection and suggests RSS without silently changing coverage', (language) => {
    settings.language = language;
    const html = render();
    expect(html).toContain(`value="${language}" selected=""`);
    expect(html).toContain('NewsAPI does not support Danish or Finnish coverage');
    expect(html).toContain('Select RSS / Atom and a public feed');
    expect(html).toContain('English (United States)');
    expect(html).toContain('German (Germany)');
    expect(html).toContain('Swedish (Sweden)');
    expect(html).toContain('Norwegian (Norway)');
  });
  it('does not warn when RSS serves Danish coverage', () => {
    settings.source = 'rss';
    const html = render();
    expect(html).not.toContain('NewsAPI does not support');
    expect(html).toContain('value="https://example.com/rss"');
  });
  it.each(['en', 'de', 'sv', 'no'])('preserves supported %s coverage without warning', (language) => {
    settings.language = language;
    const html = render();
    expect(html).toContain(`value="${language}" selected=""`);
    expect(html).not.toContain('NewsAPI does not support');
  });
  it('offers the same choices and warning in Danish', () => {
    settings.lang = 'da';
    const html = render();
    expect(html).toContain('NewsAPI understøtter ikke dansk eller finsk dækning');
    expect(html).toContain('Vælg RSS / Atom');
    expect(html).toContain('Tysk (Tyskland)');
  });
});
