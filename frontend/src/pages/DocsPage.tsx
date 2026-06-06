// =========================================================================
// DocsPage.tsx
// =========================================================================
import React from 'react';
import { Link } from 'react-router-dom';
import { useApp } from '../lib/appContext';
import { Card } from '../components/ui/card';
import { Icon } from '../components/ui/Logo';

export function DocsPage() {
  const app = useApp();
  const t = app.t;

  const steps = [
    { icon: 'usb', title: t.docsStep1Title, body: t.docsStep1Body },
    { icon: 'cast', title: t.docsStep2Title, body: t.docsStep2Body, link: { to: '/flash', label: t.docsFlashLink } },
    { icon: 'wifi', title: t.docsStep3Title, body: t.docsStep3Body },
    { icon: 'settings_ethernet', title: t.docsStep4Title, body: t.docsStep4Body },
    { icon: 'key', title: t.docsStep5Title, body: t.docsStep5Body },
    { icon: 'vpn_key', title: t.docsStep6Title, body: t.docsStep6Body },
    { icon: 'tune', title: t.docsStep7Title, body: t.docsStep7Body },
  ];

  return (
    <div className="page" style={{ maxWidth: 760 }}>
      <header className="page__head">
        <h1 className="page__title">{t.nav.docs}</h1>
        <p className="page__sub">{t.docsSub}</p>
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
                {s.link && (
                  <Link
                    to={s.link.to}
                    style={{
                      display: 'inline-block',
                      marginTop: 8,
                      fontSize: 'var(--fs-sm)',
                      color: 'var(--color-accent)',
                      textDecoration: 'none',
                      fontWeight: 500,
                    }}
                  >
                    {s.link.label} →
                  </Link>
                )}
              </div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
