// =========================================================================
// AppBar.tsx — sticky top bar: brand, crumb, lang/theme toggles, user menu
// =========================================================================
import React, { useState, useEffect, useRef } from 'react';
import { useApp } from '../../lib/appContext';
import { Logo, Icon } from '../ui/Logo';
import { IconButton } from '../ui/button';

export function LangToggle() {
  const app = useApp();
  return (
    <div className="langtoggle" role="group" aria-label="Language">
      <button
        className={app.lang === 'da' ? 'is-active' : ''}
        onClick={() => app.setLang('da')}
        aria-pressed={app.lang === 'da'}
      >
        DA
      </button>
      <button
        className={app.lang === 'en' ? 'is-active' : ''}
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
      label={app.theme === 'dark' ? 'Light mode' : 'Dark mode'}
      onClick={app.toggleTheme}
    />
  );
}

export function AppBar({ onMenu }: { onMenu: () => void }) {
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
    .split(' ')
    .map((s) => s[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  const crumb = t.crumbs[app.route];

  return (
    <header className="appbar">
      <button
        className="iconbtn appbar__menu-btn"
        onClick={onMenu}
        aria-label="Menu"
      >
        <Icon name="menu" />
      </button>
      <div className="appbar__brand" onClick={() => app.nav('dashboard')}>
        <Logo />
        <span className="appbar__brand-name">{t.product}</span>
      </div>
      {crumb && (
        <div className="appbar__crumb">
          <Icon name="chevron_right" />
          {crumb}
        </div>
      )}
      <div className="appbar__spacer" />
      <div className="appbar__actions">
        <IconButton
          icon={app.online ? 'cloud_done' : 'cloud_off'}
          label={
            app.online
              ? 'Connection: online (click to simulate offline)'
              : 'Connection: offline (click to restore)'
          }
          onClick={() => {
            const next = !app.online;
            app.setOnline(next);
            app.toast({
              type: next ? 'info' : 'warning',
              title: next ? 'Back online' : 'Offline mode (demo)',
            });
          }}
        />
        <LangToggle />
        <ThemeToggle />
        <div className="usermenu" ref={ref}>
          <button
            className="usermenu__btn"
            onClick={() => setMenuOpen((o) => !o)}
            aria-haspopup="true"
            aria-expanded={menuOpen}
          >
            <span className="avatar">{initials}</span>
            <span className="usermenu__email">{app.user.email}</span>
            <Icon name="expand_more" />
          </button>
          {menuOpen && (
            <div className="menu" role="menu">
              <div className="menu__head">
                <div className="menu__name">{app.user.name}</div>
                <div className="menu__sub">
                  {t.signedInAs} {app.user.email}
                </div>
              </div>
              <button
                className="menu__item"
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
                className="menu__item"
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
                className="menu__item is-danger"
                role="menuitem"
                onClick={app.signOut}
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
