// =========================================================================
// App.tsx — application root: AppProvider, string-based router, shell
// =========================================================================
import React, { ReactNode } from 'react';
import { AppProvider, useApp } from './lib/appContext';
import { AppBar } from './components/shell/AppBar';
import { Sidebar } from './components/shell/Sidebar';
import { ToastStack } from './components/ui/Toast';
import { LoginPage } from './pages/LoginPage';
import { DashboardPage } from './pages/DashboardPage';
import { DevicesPage } from './pages/DevicesPage';
import { AccountPage } from './pages/AccountPage';
import { DocsPage } from './pages/DocsPage';

function AppShell() {
  const app = useApp();

  if (!app.authed) {
    return (
      <div className="app">
        <LoginPage />
        <ToastStack toasts={app.toasts} dismiss={app.dismiss} />
      </div>
    );
  }

  const pages: Record<string, ReactNode> = {
    dashboard: <DashboardPage />,
    devices: <DevicesPage />,
    account: <AccountPage />,
    docs: <DocsPage />,
  };

  return (
    <div className="app">
      <AppBar onMenu={() => app.setNavOpen(!app.navOpen)} />
      <div className="shell">
        <div
          className={'scrim-nav' + (app.navOpen ? ' is-open' : '')}
          onClick={() => app.setNavOpen(false)}
        />
        <Sidebar open={app.navOpen} />
        <main className="main">{pages[app.route] ?? pages.dashboard}</main>
      </div>
      <ToastStack toasts={app.toasts} dismiss={app.dismiss} />
    </div>
  );
}

export default function App() {
  return (
    <AppProvider>
      <AppShell />
    </AppProvider>
  );
}
