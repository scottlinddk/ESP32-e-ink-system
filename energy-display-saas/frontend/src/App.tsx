import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { ClerkProvider } from '@clerk/clerk-react';
import { QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { queryClient } from './lib/queryClient';
import { Navbar } from './components/common/Navbar';
import { ProtectedRoute } from './components/auth/ProtectedRoute';
import { LoginPage } from './components/auth/LoginPage';
import { SignUpPage } from './components/auth/SignUpPage';
import { HomePage } from './pages/HomePage';
import { DashboardPage } from './pages/DashboardPage';
import { SetupPage } from './pages/SetupPage';

const CLERK_PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;

if (!CLERK_PUBLISHABLE_KEY) {
  console.warn(
    '[App] VITE_CLERK_PUBLISHABLE_KEY is not set. Auth features will not work. ' +
      'Create a .env file with your Clerk publishable key.'
  );
}

export default function App() {
  return (
    <ClerkProvider
      publishableKey={CLERK_PUBLISHABLE_KEY ?? 'pk_test_placeholder'}
      afterSignOutUrl="/"
    >
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <div className="min-h-screen flex flex-col">
            <Navbar />
            <main className="flex-1">
              <Routes>
                <Route path="/" element={<HomePage />} />
                <Route path="/login/*" element={<LoginPage />} />
                <Route path="/signup/*" element={<SignUpPage />} />
                <Route
                  path="/dashboard"
                  element={
                    <ProtectedRoute>
                      <DashboardPage />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/setup"
                  element={
                    <ProtectedRoute>
                      <SetupPage />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="*"
                  element={
                    <div className="flex min-h-[calc(100vh-56px)] items-center justify-center">
                      <div className="text-center">
                        <h1 className="text-4xl font-bold">404</h1>
                        <p className="mt-2 text-muted-foreground">Page not found</p>
                        <a href="/" className="mt-4 inline-block text-primary underline">
                          Go home
                        </a>
                      </div>
                    </div>
                  }
                />
              </Routes>
            </main>
          </div>
        </BrowserRouter>
        {import.meta.env.DEV && <ReactQueryDevtools initialIsOpen={false} />}
      </QueryClientProvider>
    </ClerkProvider>
  );
}
