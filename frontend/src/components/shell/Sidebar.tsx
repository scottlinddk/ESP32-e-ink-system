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
    { id: 'integrations', icon: 'hub', label: t.nav.integrations },
    { id: 'layout', icon: 'grid_view', label: t.nav.layout },
    { id: 'devices', icon: 'cast', label: t.nav.devices },
    { id: 'firmware', icon: 'download', label: t.nav.firmware },
    { id: 'account', icon: 'person', label: t.nav.account },
  ];

  const linkClass = ({ isActive }: { isActive: boolean }) =>
    cn(
      'workspace-nav-link flex items-center gap-3 w-full px-3 py-2.5 border-none rounded-md cursor-pointer mb-1 no-underline',
      'text-[13px] font-medium text-left transition-[background,color] duration-[150ms]',
      '[&_.material-symbols-outlined]:text-[20px]',
      isActive
        ? 'workspace-nav-link--active'
        : 'bg-transparent text-fg2'
    );

  return (
    <aside
      className={cn(
        'workspace-sidebar w-[212px] flex-shrink-0 flex flex-col p-5 px-3 border-r border-divider bg-surface overflow-y-auto',
        'min-[821px]:sticky min-[821px]:top-16 min-[821px]:h-[calc(100dvh-64px)]',
        // mobile
        'max-[820px]:fixed max-[820px]:top-16 max-[820px]:bottom-0 max-[820px]:left-0 max-[820px]:z-[70]',
        'max-[820px]:shadow-3 max-[820px]:transition-transform max-[820px]:duration-[225ms]',
        open ? 'max-[820px]:translate-x-0' : 'max-[820px]:-translate-x-full'
      )}
    >
      <div className="workspace-switcher flex items-center gap-2.5 rounded-lg p-3 mb-7">
        <span className="workspace-mark flex items-center justify-center w-8 h-8 rounded-md shrink-0">
          <Icon name="developer_board" className="text-[19px]" />
        </span>
        <div className="min-w-0">
          <div className="text-xs font-semibold text-fg1">{app.lang === 'da' ? 'Mit arbejdsområde' : 'My workspace'}</div>
          <div className="text-[11px] text-fg3 mt-0.5">ESP32 · e-ink</div>
        </div>
      </div>
      <div className="text-[10px] uppercase tracking-[0.12em] text-fg3 font-semibold px-3 pb-3">
        {t.navConfig}
      </div>
      <nav aria-label={t.navConfig}>
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
      </nav>
      <div className="workspace-help mt-auto pt-8">
        <div className="px-3 mb-2 text-[10px] uppercase tracking-[0.12em] text-fg3 font-semibold">
          {app.lang === 'da' ? 'Hjælp og vejledning' : 'Help & resources'}
        </div>
        <NavLink
          to="/docs"
          className={linkClass}
          onClick={() => app.setNavOpen(false)}
        >
          <Icon name="help" />
          {t.nav.docs}
          <Icon name="north_east" className="ml-auto !text-[15px]" />
        </NavLink>
        <div className="mx-3 mt-4 pt-4 border-t border-divider text-[11px] leading-relaxed text-fg3">
          {app.lang === 'da' ? 'Dit overblik. På dit display.' : 'Your information. On your display.'}
        </div>
      </div>

      {/* Language toggle — mobile only (hidden in AppBar on ≤820px, shown here instead) */}
      <div className="mt-5 hidden max-[820px]:flex items-center gap-3 px-1 pt-3 border-t border-divider">
        <span className="text-xs text-fg3 font-medium flex-1">{app.lang === 'da' ? 'Sprog' : 'Language'}</span>
        <LangToggle />
      </div>
    </aside>
  );
}
