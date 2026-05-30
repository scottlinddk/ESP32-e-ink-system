// =========================================================================
// DocsPage.tsx
// =========================================================================
import React from 'react';
import { useApp } from '../lib/appContext';
import { Card } from '../components/ui/card';
import { Icon } from '../components/ui/Logo';

export function DocsPage() {
  const app = useApp();
  const t = app.t;

  const steps =
    app.lang === 'da'
      ? [
          {
            icon: 'cast',
            title: 'Par dit display',
            body: "Indtast enheds-ID'et bag på dit display under Enheder.",
          },
          {
            icon: 'key',
            title: 'Tilføj API-nøgler',
            body: 'Hent gratis nøgler hos OpenWeatherMap og NewsAPI, og indsæt dem på oversigten.',
          },
          {
            icon: 'tune',
            title: 'Vælg hvad der vises',
            body: 'Slå elpris, vejr og nyheder til, og se forhåndsvisningen opdatere.',
          },
        ]
      : [
          {
            icon: 'cast',
            title: 'Pair your display',
            body: 'Enter the device ID printed on the back of your display under Devices.',
          },
          {
            icon: 'key',
            title: 'Add API keys',
            body: 'Get free keys from OpenWeatherMap and NewsAPI, then paste them on the dashboard.',
          },
          {
            icon: 'tune',
            title: 'Choose what shows',
            body: 'Toggle energy price, weather and news, and watch the preview update.',
          },
        ];

  return (
    <div className="page" style={{ maxWidth: 760 }}>
      <header className="page__head">
        <h1 className="page__title">{t.nav.docs}</h1>
        <p className="page__sub">
          {app.lang === 'da' ? 'Kom i gang på tre trin.' : 'Get set up in three steps.'}
        </p>
      </header>
      <div className="stack">
        {steps.map((s, i) => (
          <Card key={i} flat>
            <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
              <div className="device__glyph">
                <Icon name={s.icon} />
              </div>
              <div>
                <h3
                  style={{
                    margin: '2px 0 4px',
                    fontSize: 'var(--fs-h6)',
                    fontWeight: 500,
                  }}
                >
                  {i + 1}. {s.title}
                </h3>
                <p className="muted" style={{ margin: 0 }}>
                  {s.body}
                </p>
              </div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
