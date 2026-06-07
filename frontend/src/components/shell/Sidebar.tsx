// =========================================================================
// Sidebar.tsx — left nav panel (mobile: offcanvas)
// =========================================================================
import React from 'react';
import { NavLink } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { useApp } from '../../lib/appContext';
import { Icon } from '../ui/Logo';
import { LangToggle } from './AppBar';

export function Sidebar({ open }: { open: boolean }) {
  const app = useApp();
  const t = app.t;

  const items = [
    { id: 'dashboard', icon: 'dashboard', label: t.nav.home },
    { id: 'layout', icon: 'grid_view', label: t.nav.layout },
    { id: 'devices', icon: 'cast', label: t.nav.devices },
    { id: 'firmware', icon: 'download', label: t.nav.firmware },
    { id: 'account', icon: 'person', label: t.nav.account },
  ];

  const linkClass = ({ isActive }: { isActive: boolean }) =>
    cn(
      'flex items-center gap-3 w-full px-3 py-2.5 border-none rounded-md cursor-pointer mb-0.5 no-underline',
      'text-sm font-medium text-left transition-[background,color] duration-[150ms]',
      '[&_.material-symbols-outlined]:text-[21px]',
      isActive
        ? 'bg-accent text-fg-on [&_.material-symbols-outlined]:text-fg-on'
        : 'bg-transparent text-fg2 hover:bg-black/[0.08] hover:text-fg1'
    );

  return (
    <aside
      className={cn(
        'w-[248px] flex-shrink-0 flex flex-col p-4 px-3 border-r border-divider bg-surface',
        // mobile
        'max-[820px]:fixed max-[820px]:top-16 max-[820px]:bottom-0 max-[820px]:left-0 max-[820px]:z-[70]',
        'max-[820px]:shadow-3 max-[820px]:transition-transform max-[820px]:duration-[225ms]',
        open ? 'max-[820px]:translate-x-0' : 'max-[820px]:-translate-x-full'
      )}
    >
      <div className="text-xs uppercase tracking-[0.08em] text-fg3 font-medium px-3 py-1.5">
        {t.navConfig}
      </div>
      {items.map((it) => (
        <NavLink
          key={it.id}
          to={`/${it.id}`}
          className={linkClass}
          onClick={() => app.setNavOpen(false)}
        >
          <Icon name={it.icon} />
          {it.label}
        </NavLink>
      ))}
      <div className="h-px bg-divider my-2.5 mx-1.5" />
      <NavLink
        to="/docs"
        className={linkClass}
        onClick={() => app.setNavOpen(false)}
      >
        <Icon name="help" />
        {t.nav.docs}
      </NavLink>

      {/* Language toggle — mobile only (hidden in AppBar on ≤820px, shown here instead) */}
      <div className="mt-auto hidden max-[820px]:flex items-center gap-3 px-1 pt-3 border-t border-divider">
        <span className="text-xs text-fg3 font-medium flex-1">{app.lang === 'da' ? 'Sprog' : 'Language'}</span>
        <LangToggle />
      </div>
    </aside>
  );
}
