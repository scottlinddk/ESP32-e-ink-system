// =========================================================================
// AppBar.tsx — sticky top bar: brand, crumb, lang/theme toggles, user menu
// =========================================================================
import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { useApp } from '../../lib/appContext';
import { Logo, Icon } from '../ui/Logo';
import { IconButton } from '../ui/button';

export function LangToggle() {
  const app = useApp();
  return (
    <div
      className="inline-flex border border-border rounded-pill overflow-hidden h-[34px]"
      role="group"
      aria-label="Language"
    >
      {(['da', 'en'] as const).map((l) => (
        <button
          key={l}
          className={cn(
            'border-none text-xs font-medium tracking-[0.04em] px-3 cursor-pointer transition-all duration-[150ms]',
            app.lang === l ? 'bg-accent text-fg-on' : 'bg-transparent text-fg2'
          )}
          onClick={() => app.setLang(l)}
          aria-pressed={app.lang === l}
        >
          {l.toUpperCase()}
        </button>
      ))}
    </div>
  );
}

export function ThemeToggle() {
  const app = useApp();
  return (
    <IconButton
      icon={app.theme === 'dark' ? 'light_mode' : 'dark_mode'}
      label={app.theme === 'dark' ? app.t.themeLight : app.t.themeDark}
      onClick={app.toggleTheme}
    />
  );
}

export function AppBar({
  onMenu,
  onSignOut,
}: {
  onMenu: () => void;
  onSignOut: () => void;
}) {
  const app = useApp();
  const t = app.t;
  const navigate = useNavigate();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const initials = app.user.name
    ? app.user.name.split(' ').map((s) => s[0]).slice(0, 2).join('').toUpperCase()
    : '?';

  const crumbKey = location.pathname.slice(1) || 'dashboard';
  const crumb = t.crumbs[crumbKey];

  return (
    <header className="sticky top-0 z-40 h-16 flex-shrink-0 flex items-center gap-4 px-5 bg-surface border-b border-divider">
      {/* Mobile menu button */}
      <IconButton
        icon="menu"
        label="Menu"
        className="hidden max-[820px]:inline-flex"
        onClick={onMenu}
      />

      <div
        className="flex items-center gap-2.5 cursor-pointer select-none"
        onClick={() => navigate('/dashboard')}
      >
        <Logo />
        <span className="font-medium text-base tracking-[-0.01em] max-[480px]:hidden">{t.product}</span>
      </div>

      {crumb && (
        <div className="text-fg3 text-sm flex items-center gap-2 max-[820px]:hidden [&_.material-symbols-outlined]:text-[18px]">
          <Icon name="chevron_right" />
          {crumb}
        </div>
      )}

      <div className="flex-1" />

      <div className="flex items-center gap-2">
        <IconButton
          icon={app.online ? 'cloud_done' : 'cloud_off'}
          label={app.online ? t.connOnline : t.connOffline}
          onClick={() => {
            const next = !app.online;
            app.setOnline(next);
            app.toast({
              type: next ? 'info' : 'warning',
              title: next ? t.toastOnline : t.toastOffline,
            });
          }}
        />
        <span className="max-[820px]:hidden"><LangToggle /></span>
        <ThemeToggle />

        {/* User menu */}
        <div className="relative" ref={ref}>
          <button
            className="flex items-center gap-2 py-1 pr-1.5 pl-1 border border-border bg-surface rounded-pill cursor-pointer text-fg1 transition-[background] duration-[150ms] hover:bg-black/[0.06] [&_.material-symbols-outlined]:text-[18px] [&_.material-symbols-outlined]:text-fg3"
            onClick={() => setMenuOpen((o) => !o)}
            aria-haspopup="true"
            aria-expanded={menuOpen}
          >
            <span className="w-[30px] h-[30px] rounded-full flex-shrink-0 bg-accent text-fg-on flex items-center justify-center text-xs font-medium">
              {initials}
            </span>
            <span className="text-sm max-w-[160px] overflow-hidden text-ellipsis whitespace-nowrap max-[820px]:hidden">
              {app.user.email}
            </span>
            <Icon name="expand_more" />
          </button>

          {menuOpen && (
            <div
              className="absolute right-0 top-[calc(100%+8px)] min-w-[200px] bg-surface border border-border rounded-md shadow-3 p-1.5 z-[60] animate-pop"
              role="menu"
            >
              <div className="px-2.5 py-2 border-b border-divider mb-1">
                <div className="text-sm font-medium">{app.user.name}</div>
                <div className="text-xs text-fg3">
                  {t.signedInAs} {app.user.email}
                </div>
              </div>
              {[
                { icon: 'person', label: t.menuProfile, route: 'account' },
                { icon: 'settings', label: t.menuSettings, route: 'account' },
              ].map((item) => (
                <button
                  key={item.label}
                  className="flex items-center gap-2.5 w-full px-2.5 py-[9px] border-none bg-transparent text-fg1 text-sm text-left rounded-sm cursor-pointer hover:bg-black/[0.10] [&_.material-symbols-outlined]:text-[19px] [&_.material-symbols-outlined]:text-fg3"
                  role="menuitem"
                  onClick={() => {
                    navigate('/' + item.route);
                    setMenuOpen(false);
                  }}
                >
                  <Icon name={item.icon} />
                  {item.label}
                </button>
              ))}
              <button
                className="flex items-center gap-2.5 w-full px-2.5 py-[9px] border-none bg-transparent text-error text-sm text-left rounded-sm cursor-pointer hover:bg-black/[0.10] [&_.material-symbols-outlined]:text-[19px] [&_.material-symbols-outlined]:text-error"
                role="menuitem"
                onClick={onSignOut}
              >
                <Icon name="logout" />
                {t.menuLogout}
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
