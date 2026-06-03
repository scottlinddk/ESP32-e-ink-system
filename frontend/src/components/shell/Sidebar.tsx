// =========================================================================
// Sidebar.tsx — left nav panel (mobile: offcanvas)
// =========================================================================
import React from 'react';
import { useApp } from '../../lib/appContext';
import { Icon } from '../ui/Logo';

export function Sidebar({ open }: { open: boolean }) {
  const app = useApp();
  const t = app.t;

  const items = [
    { id: 'dashboard', icon: 'dashboard', label: t.nav.home },
    { id: 'devices', icon: 'cast', label: t.nav.devices },
    { id: 'firmware', icon: 'download', label: t.nav.firmware },
    { id: 'account', icon: 'person', label: t.nav.account },
  ];

  return (
    <aside className={'sidebar' + (open ? ' is-open' : '')}>
      <div className="nav-label">{t.navConfig}</div>
      {items.map((it) => (
        <button
          key={it.id}
          className={'navitem' + (app.route === it.id ? ' is-active' : '')}
          onClick={() => app.nav(it.id)}
        >
          <Icon name={it.icon} />
          {it.label}
        </button>
      ))}
      <div className="nav-sep" />
      <button
        className={'navitem' + (app.route === 'docs' ? ' is-active' : '')}
        onClick={() => app.nav('docs')}
      >
        <Icon name="help" />
        {t.nav.docs}
      </button>
    </aside>
  );
}
