// =========================================================================
// DocsPage.tsx
// =========================================================================
import React from 'react';
import { Link } from 'react-router';
import { useApp } from '../lib/appContext';
import { Card } from '../components/ui/card';
import { Icon } from '../components/ui/Logo';

export function DocsPage() {
  const app = useApp();
  const t = app.t;

  const steps = [
    { icon: 'usb',               title: t.docsStep1Title, body: t.docsStep1Body },
    { icon: 'cast',              title: t.docsStep2Title, body: t.docsStep2Body, link: '/flash', linkLabel: t.docsStep2Link },
    { icon: 'wifi',              title: t.docsStep3Title, body: t.docsStep3Body },
    { icon: 'settings_ethernet', title: t.docsStep4Title, body: t.docsStep4Body },
    { icon: 'key',               title: t.docsStep5Title, body: t.docsStep5Body },
    { icon: 'vpn_key',           title: t.docsStep6Title, body: t.docsStep6Body },
    { icon: 'tune',              title: t.docsStep7Title, body: t.docsStep7Body },
  ];

  return (
    <div className="max-w-[760px] mx-auto px-6 pt-8 pb-20 animate-page-enter">
      <header className="mb-5">
        <h1 className="text-[2rem] font-light tracking-tight m-0 mb-1.5">{t.nav.docs}</h1>
        <p className="text-fg-2 text-base m-0">{t.docsSub}</p>
      </header>
      <div className="flex flex-col gap-4">
        {steps.map((s, i) => (
          <Card key={i} flat>
            <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
              <div className="w-12 h-12 rounded-lg bg-[rgba(128,128,128,0.1)] text-fg-2 flex items-center justify-center [&_.material-symbols-outlined]:text-2xl flex-shrink-0">
                <Icon name={s.icon} />
              </div>
              <div>
                <h3 className="text-base font-medium m-0 mb-1">
                  {i + 1}. {s.title}
                </h3>
                <p className="text-fg-2 text-sm m-0">
                  {s.body}
                </p>
                {s.link && s.linkLabel && (
                  <Link
                    to={s.link}
                    className="inline-block mt-2 text-sm font-medium text-blue-600 hover:underline"
                  >
                    {s.linkLabel} →
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
