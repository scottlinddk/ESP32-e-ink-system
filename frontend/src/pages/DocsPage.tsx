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
    <div className="max-w-[760px] mx-auto px-6 pt-6 pb-20 animate-fade-up max-[820px]:px-4 max-[820px]:pt-5 max-[820px]:pb-16">
      <header className="mb-5">
        <h1 className="text-h2 font-light tracking-tight m-0 mb-1.5">{t.nav.docs}</h1>
        <p className="text-fg2 text-body m-0">{t.docsSub}</p>
      </header>
      <div className="flex flex-col gap-4">
        {steps.map((s, i) => (
          <Card key={i} flat>
            <div className="flex gap-4 items-start">
              <div className="w-12 h-12 rounded-md bg-black/[0.10] text-fg2 flex items-center justify-center flex-shrink-0 [&_.material-symbols-outlined]:text-[24px]">
                <Icon name={s.icon} />
              </div>
              <div>
                <h3 className="text-h6 font-medium m-0 mt-0.5 mb-1">
                  {i + 1}. {s.title}
                </h3>
                <p className="text-sm text-fg2 m-0">{s.body}</p>
                {s.link && (
                  <Link
                    to={s.link.to}
                    className="inline-block mt-2 text-sm text-accent font-medium no-underline hover:underline"
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
