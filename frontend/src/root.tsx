import { ClerkProvider, SignInButton, SignUpButton, Show, UserButton } from '@clerk/react-router';
import { isRouteErrorResponse, Links, Meta, Outlet, Scripts, ScrollRestoration } from 'react-router';
import type { Route } from './+types/root';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from './lib/queryClient';
import { Logo } from './components/ui/Logo';
import './index.css';

export function HydrateFallback() {
  return (
    <div className="app-init" role="status" aria-label="Loading">
      <div className="app-init__brand">
        <Logo lg />
        <div style={{ textAlign: 'center' }}>
          <p className="app-init__name">ESP32 Display</p>
          <p className="app-init__sub">Real-time data for your e-ink display</p>
        </div>
      </div>
      <span className="spinner spinner--lg" aria-hidden="true" />
    </div>
  );
}

export const links: Route.LinksFunction = () => [
  { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' },
  { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
  {
    rel: 'preconnect',
    href: 'https://fonts.gstatic.com',
    crossOrigin: 'anonymous',
  },
  {
    rel: 'stylesheet',
    href: 'https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200&display=block',
  },
  {
    rel: 'stylesheet',
    href: 'https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,600;9..40,700&family=Roboto+Mono:wght@400;500&display=swap',
  },
];

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>ESP32 Display — Real-time data for your e-ink display</title>
        <meta
          name="description"
          content="Connect your ESP32 e-ink display to live energy prices, weather, and news headlines."
        />
        <Meta />
        <Links />
      </head>
      <body suppressHydrationWarning>
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  return (
    <ClerkProvider
      publishableKey={import.meta.env.VITE_CLERK_PUBLISHABLE_KEY}
      signInFallbackRedirectUrl="/"
      signUpFallbackRedirectUrl="/"
    >
      <QueryClientProvider client={queryClient}>
        <header style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', padding: 'var(--space-3) var(--space-4)', gap: 'var(--space-2)' }}>
          <Show when="signed-out">
            <SignInButton />
            <SignUpButton />
          </Show>
          <Show when="signed-in">
            <UserButton />
          </Show>
        </header>
        <Outlet />
      </QueryClientProvider>
    </ClerkProvider>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let message = 'Oops!';
  let details = 'An unexpected error occurred.';
  let stack: string | undefined;

  if (isRouteErrorResponse(error)) {
    message = error.status === 404 ? '404' : 'Error';
    details =
      error.status === 404 ? 'The requested page could not be found.' : error.statusText || details;
  } else if (import.meta.env.DEV && error && error instanceof Error) {
    details = error.message;
    stack = error.stack;
  }

  return (
    <main className="loadbox" style={{ minHeight: '100vh' }}>
      <h1 style={{ fontWeight: 500 }}>{message}</h1>
      <p className="muted">{details}</p>
      {stack && (
        <pre style={{ fontSize: 12, fontFamily: 'var(--font-mono)', overflowX: 'auto', maxWidth: '100%', padding: 'var(--space-4)' }}>
          {stack}
        </pre>
      )}
    </main>
  );
}
