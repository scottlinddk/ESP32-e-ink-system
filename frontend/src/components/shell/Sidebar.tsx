// =========================================================================
// Sidebar.tsx — left nav panel (mobile: offcanvas)
// =========================================================================
import React from 'react';
import { useApp } from '../../lib/appContext';
import { Icon } from '../ui/Logo';
import { cn } from '../../lib/utils';

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

  return (
    <aside
      className={cn(
        'w-[248px] flex-shrink-0 py-4 px-3 border-r border-divider bg-surface',
        'max-[820px]:fixed max-[820px]:top-16 max-[820px]:bottom-0 max-[820px]:left-0 max-[820px]:z-[70]',
        'max-[820px]:-translate-x-full max-[820px]:transition-transform max-[820px]:duration-[225ms] max-[820px]:ease-[cubic-bezier(0.4,0,0.2,1)] max-[820px]:shadow-3',
        open && 'max-[820px]:translate-x-0',
      )}
    >
      <div className="text-xs uppercase tracking-widest text-fg-3 font-medium px-3 py-1.5">
        {t.navConfig}
      </div>
      {items.map((it) => (
        <button
          key={it.id}
          className={cn(
            'flex items-center gap-3 w-full px-3 py-[10px] border-none bg-transparent text-fg-2 text-sm font-medium text-left rounded-lg cursor-pointer mb-0.5 transition-colors duration-[150ms] hover:bg-[rgba(128,128,128,0.08)] hover:text-fg-1 [&_.material-symbols-outlined]:text-[21px]',
            app.route === it.id && 'bg-accent text-fg-on [&_.material-symbols-outlined]:text-fg-on hover:bg-accent hover:text-fg-on',
          )}
          onClick={() => app.nav(it.id)}
        >
          <Icon name={it.icon} />
          {it.label}
        </button>
      ))}
      <div className="h-px bg-divider my-[10px] mx-1.5" />
      <button
        className={cn(
          'flex items-center gap-3 w-full px-3 py-[10px] border-none bg-transparent text-fg-2 text-sm font-medium text-left rounded-lg cursor-pointer mb-0.5 transition-colors duration-[150ms] hover:bg-[rgba(128,128,128,0.08)] hover:text-fg-1 [&_.material-symbols-outlined]:text-[21px]',
          app.route === 'docs' && 'bg-accent text-fg-on [&_.material-symbols-outlined]:text-fg-on hover:bg-accent hover:text-fg-on',
        )}
        onClick={() => app.nav('docs')}
      >
        <Icon name="help" />
        {t.nav.docs}
      </button>
    </aside>
  );
}
