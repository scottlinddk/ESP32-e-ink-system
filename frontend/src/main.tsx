import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { ClerkProvider, AuthenticateWithRedirectCallback } from '@clerk/clerk-react';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from './lib/queryClient';
import './index.css';
import App from './App';
import { FlashPage } from './pages/FlashPage';

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
        <ClerkProvider publishableKey={PUBLISHABLE_KEY} signInFallbackRedirectUrl="/" signUpFallbackRedirectUrl="/">
          <Routes>
            {/* Public route — no Clerk auth required */}
            <Route path="/flash" element={<FlashPage />} />

            {/* OAuth callback — completes the Clerk sign-in handshake */}
            <Route path="/sso-callback" element={<AuthenticateWithRedirectCallback />} />

            {/* All other routes go through the Clerk-guarded app shell */}
            <Route path="*" element={<App />} />
          </Routes>
        </ClerkProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>
);
