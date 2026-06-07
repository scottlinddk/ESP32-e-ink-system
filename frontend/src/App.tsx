// =========================================================================
// App.tsx — layout route: AppProvider, Clerk auth gate, shell + Outlet
// =========================================================================
import React, { useEffect } from 'react';
import { Outlet } from 'react-router-dom';
import { useAuth, useUser, useClerk } from '@clerk/clerk-react';
import { AppProvider, useApp } from './lib/appContext';
import { AppBar } from './components/shell/AppBar';
import { Sidebar } from './components/shell/Sidebar';
import { ToastStack } from './components/ui/Toast';
import { ProgressBar } from './components/common/LoadingSpinner';
import { LoginPage } from './pages/LoginPage';

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
    return <ProgressBar />;
  }

  if (!isSignedIn) {
    return (
      <div className="min-h-full flex flex-col bg-bg text-fg1">
        <LoginPage />
        <ToastStack toasts={app.toasts} dismiss={app.dismiss} />
      </div>
    );
  }

  return (
    <div className="min-h-full flex flex-col bg-bg text-fg1">
      <AppBar onMenu={() => app.setNavOpen(!app.navOpen)} onSignOut={signOut} />
      <div className="flex-1 flex min-h-0">
        {/* Mobile nav scrim */}
        {app.navOpen && (
          <div
            className="hidden max-[820px]:block fixed inset-x-0 bottom-0 top-16 bg-black/40 z-[65]"
            onClick={() => app.setNavOpen(false)}
          />
        )}
        <Sidebar open={app.navOpen} />
        <main className="flex-1 min-w-0 overflow-y-auto">
          <Outlet />
        </main>
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
