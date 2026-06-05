// =========================================================================
// AppBar.tsx — sticky top bar: brand, crumb, lang/theme toggles, user menu
// =========================================================================
import React, { useState, useEffect, useRef } from 'react';
import { useApp } from '../../lib/appContext';
import { Logo, Icon } from '../ui/Logo';
import { IconButton } from '../ui/button';
import { cn } from '../../lib/utils';

export function LangToggle() {
  const app = useApp();
  return (
    <div
      className="inline-flex border border-[var(--color-border)] rounded-full overflow-hidden h-[34px]"
      role="group"
      aria-label="Language"
    >
      <button
        className={cn(
          'border-none bg-transparent text-fg-2 text-xs font-medium tracking-[0.04em] px-3 cursor-pointer transition-all',
          app.lang === 'da' && 'bg-accent text-fg-on',
        )}
        onClick={() => app.setLang('da')}
        aria-pressed={app.lang === 'da'}
      >
        DA
      </button>
      <button
        className={cn(
          'border-none bg-transparent text-fg-2 text-xs font-medium tracking-[0.04em] px-3 cursor-pointer transition-all',
          app.lang === 'en' && 'bg-accent text-fg-on',
        )}
        onClick={() => app.setLang('en')}
        aria-pressed={app.lang === 'en'}
      >
        EN
      </button>
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

  const crumb = t.crumbs[app.route];

  return (
    <header className="sticky top-0 z-40 h-16 flex-shrink-0 flex items-center gap-4 px-5 bg-surface border-b border-divider">
      <button
        className="inline-flex items-center justify-center w-10 h-10 rounded-full border-none bg-transparent text-fg-2 cursor-pointer transition-colors hover:bg-[rgba(128,128,128,0.12)] hover:text-fg-1 [&_.material-symbols-outlined]:text-[22px] hidden max-[820px]:inline-flex"
        onClick={onMenu}
        aria-label="Menu"
      >
        <Icon name="menu" />
      </button>
      <div
        className="flex items-center gap-[10px] cursor-pointer select-none"
        onClick={() => app.nav('dashboard')}
      >
        <Logo />
        <span className="font-medium text-base tracking-[-0.01em]">{t.product}</span>
      </div>
      {crumb && (
        <div className="text-fg-3 text-sm flex items-center gap-2 [&_.material-symbols-outlined]:text-[18px]">
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
        <LangToggle />
        <ThemeToggle />
        <div className="relative" ref={ref}>
          <button
            className="flex items-center gap-2 px-1.5 py-1 pl-1 border border-[var(--color-border)] bg-surface rounded-full cursor-pointer text-fg-1 transition-colors hover:bg-[rgba(128,128,128,0.06)]"
            onClick={() => setMenuOpen((o) => !o)}
            aria-haspopup="true"
            aria-expanded={menuOpen}
          >
            <span className="w-[30px] h-[30px] rounded-full flex-shrink-0 bg-accent text-fg-on flex items-center justify-center text-xs font-medium">
              {initials}
            </span>
            <span className="text-sm max-w-[160px] overflow-hidden text-ellipsis whitespace-nowrap hidden sm:block">
              {app.user.email}
            </span>
            <Icon name="expand_more" />
          </button>
          {menuOpen && (
            <div
              className="absolute right-0 top-[calc(100%+8px)] min-w-[200px] bg-surface border border-[var(--color-border)] rounded-lg shadow-3 p-1.5 z-[60] animate-pop"
              role="menu"
            >
              <div className="px-[10px] py-2 border-b border-divider mb-1">
                <div className="text-sm font-medium">{app.user.name}</div>
                <div className="text-xs text-fg-3">
                  {t.signedInAs} {app.user.email}
                </div>
              </div>
              <button
                className="flex items-center gap-[10px] w-full px-[10px] py-[9px] border-none bg-transparent text-fg-1 text-sm text-left rounded cursor-pointer hover:bg-[rgba(128,128,128,0.1)] [&_.material-symbols-outlined]:text-[19px] [&_.material-symbols-outlined]:text-fg-3"
                role="menuitem"
                onClick={() => {
                  app.nav('account');
                  setMenuOpen(false);
                }}
              >
                <Icon name="person" />
                {t.menuProfile}
              </button>
              <button
                className="flex items-center gap-[10px] w-full px-[10px] py-[9px] border-none bg-transparent text-fg-1 text-sm text-left rounded cursor-pointer hover:bg-[rgba(128,128,128,0.1)] [&_.material-symbols-outlined]:text-[19px] [&_.material-symbols-outlined]:text-fg-3"
                role="menuitem"
                onClick={() => {
                  app.nav('account');
                  setMenuOpen(false);
                }}
              >
                <Icon name="settings" />
                {t.menuSettings}
              </button>
              <button
                className="flex items-center gap-[10px] w-full px-[10px] py-[9px] border-none bg-transparent text-error text-sm text-left rounded cursor-pointer hover:bg-[rgba(128,128,128,0.1)] [&_.material-symbols-outlined]:text-[19px] [&_.material-symbols-outlined]:text-error"
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
