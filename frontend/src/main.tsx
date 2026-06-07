import { StrictMode, lazy, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { ClerkProvider, AuthenticateWithRedirectCallback } from '@clerk/clerk-react';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from './lib/queryClient';
import './index.css';
import App from './App';
import { ProgressBar } from './components/common/LoadingSpinner';

// Lazy-loaded page chunks — each becomes its own JS chunk
const FlashPage = lazy(() => import('./pages/FlashPage').then((m) => ({ default: m.FlashPage })));
const DashboardPage = lazy(() => import('./pages/DashboardPage').then((m) => ({ default: m.DashboardPage })));
const LayoutEditorPage = lazy(() => import('./pages/LayoutEditorPage').then((m) => ({ default: m.LayoutEditorPage })));
const DevicesPage = lazy(() => import('./pages/DevicesPage').then((m) => ({ default: m.DevicesPage })));
const FirmwarePage = lazy(() => import('./pages/FirmwarePage').then((m) => ({ default: m.FirmwarePage })));
const AccountPage = lazy(() => import('./pages/AccountPage').then((m) => ({ default: m.AccountPage })));
const DocsPage = lazy(() => import('./pages/DocsPage').then((m) => ({ default: m.DocsPage })));

const PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as string;

if (!PUBLISHABLE_KEY) {
  throw new Error('Missing VITE_CLERK_PUBLISHABLE_KEY environment variable');
}

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('Root element #root not found in document');
}

createRoot(rootElement).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <ClerkProvider
          publishableKey={PUBLISHABLE_KEY}
          signInFallbackRedirectUrl="/dashboard"
          signUpFallbackRedirectUrl="/dashboard"
        >
          <Suspense fallback={<ProgressBar />}>
            <Routes>
              {/* Public routes — no auth */}
              <Route path="/flash" element={<FlashPage />} />
              <Route path="/sso-callback" element={<AuthenticateWithRedirectCallback />} />

              {/* App shell — protected pages rendered via Outlet */}
              <Route element={<App />}>
                <Route index element={<Navigate to="/dashboard" replace />} />
                <Route path="/dashboard" element={<DashboardPage />} />
                <Route path="/layout" element={<LayoutEditorPage />} />
                <Route path="/devices" element={<DevicesPage />} />
                <Route path="/firmware" element={<FirmwarePage />} />
                <Route path="/account" element={<AccountPage />} />
                <Route path="/docs" element={<DocsPage />} />
                <Route path="*" element={<Navigate to="/dashboard" replace />} />
              </Route>
            </Routes>
          </Suspense>
        </ClerkProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>
);
