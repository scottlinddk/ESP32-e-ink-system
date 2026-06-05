// =========================================================================
// App.tsx — application root: AppProvider, Clerk auth gate, shell
// =========================================================================
import React, { ReactNode, useEffect } from 'react';
import { useAuth, useUser, useClerk } from '@clerk/react-router';
import { AppProvider, useApp } from './lib/appContext';
import { AppBar } from './components/shell/AppBar';
import { Sidebar } from './components/shell/Sidebar';
import { ToastStack } from './components/ui/Toast';
import { AppLoadingScreen } from './components/common/AppLoadingScreen';
import { LoginPage } from './pages/LoginPage';
import { DashboardPage } from './pages/DashboardPage';
import { DevicesPage } from './pages/DevicesPage';
import { FirmwarePage } from './pages/FirmwarePage';
import { AccountPage } from './pages/AccountPage';
import { DocsPage } from './pages/DocsPage';
import { LayoutEditorPage } from './pages/LayoutEditorPage';

function AppShell() {
  const app = useApp();
  const { isLoaded, isSignedIn } = useAuth();
  const { user: clerkUser } = useUser();
  const { signOut } = useClerk();

  useEffect(() => {
    if (clerkUser) {
      app.setUser({
        name: clerkUser.fullName ?? clerkUser.username ?? '',
        email: clerkUser.primaryEmailAddress?.emailAddress ?? '',
      });
    }
  }, [clerkUser]);

  if (!isLoaded) {
    return <AppLoadingScreen />;
  }

  if (!isSignedIn) {
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
    firmware: <FirmwarePage />,
    account: <AccountPage />,
    docs: <DocsPage />,
    layout: <LayoutEditorPage />,
  };

  return (
    <div className="app">
      <AppBar onMenu={() => app.setNavOpen(!app.navOpen)} onSignOut={signOut} />
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
