import { StrictMode, lazy, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate, Outlet } from 'react-router-dom';
import { ClerkProvider, AuthenticateWithRedirectCallback } from '@clerk/clerk-react';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from './lib/queryClient';
import './index.css';
import App from './App';
import { ProgressBar } from './components/common/LoadingSpinner';

// Lazy-loaded page chunks — each becomes its own JS chunk
const FlashPage = lazy(() => import('./pages/FlashPage').then((m) => ({ default: m.FlashPage })));
const DashboardPage = lazy(() => import('./pages/DashboardPage').then((m) => ({ default: m.DashboardPage })));
const IntegrationsPage = lazy(() => import('./pages/IntegrationsPage').then((m) => ({ default: m.IntegrationsPage })));
const LayoutEditorPage = lazy(() => import('./pages/LayoutEditorPage').then((m) => ({ default: m.LayoutEditorPage })));
const DevicesPage = lazy(() => import('./pages/DevicesPage').then((m) => ({ default: m.DevicesPage })));
const FirmwarePage = lazy(() => import('./pages/FirmwarePage').then((m) => ({ default: m.FirmwarePage })));
const AccountPage = lazy(() => import('./pages/AccountPage').then((m) => ({ default: m.AccountPage })));
const DocsPage = lazy(() => import('./pages/DocsPage').then((m) => ({ default: m.DocsPage })));

const PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as string;

function AccountRoutes() {
  if (!PUBLISHABLE_KEY) {
    return <main className="max-w-xl mx-auto p-8"><h1>Account setup is unavailable</h1><p>Configure VITE_CLERK_PUBLISHABLE_KEY to use the dashboard.</p><a href="/flash">Open the USB firmware installer</a></main>;
  }
  return <ClerkProvider publishableKey={PUBLISHABLE_KEY} signInFallbackRedirectUrl="/dashboard" signUpFallbackRedirectUrl="/dashboard"><Outlet /></ClerkProvider>;
}

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('Root element #root not found in document');
}

createRoot(rootElement).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
          <Suspense fallback={<ProgressBar />}>
            <Routes>
              {/* Public routes — no auth */}
              <Route path="/flash" element={<FlashPage />} />
              <Route element={<AccountRoutes />}>
              <Route path="/sso-callback" element={<AuthenticateWithRedirectCallback />} />

              {/* App shell — protected pages rendered via Outlet */}
              <Route element={<App />}>
                <Route index element={<Navigate to="/dashboard" replace />} />
                <Route path="/dashboard" element={<DashboardPage />} />
                <Route path="/integrations" element={<IntegrationsPage />} />
                <Route path="/layout" element={<LayoutEditorPage />} />
                <Route path="/devices" element={<DevicesPage />} />
                <Route path="/firmware" element={<FirmwarePage />} />
                <Route path="/account" element={<AccountPage />} />
                <Route path="/docs" element={<DocsPage />} />
                <Route path="*" element={<Navigate to="/dashboard" replace />} />
              </Route>
              </Route>
            </Routes>
          </Suspense>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>
);
