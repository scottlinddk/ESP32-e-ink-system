import { ClerkProvider, SignInButton, SignUpButton, Show, UserButton } from '@clerk/react-router';
import { isRouteErrorResponse, Links, Meta, Outlet, Scripts, ScrollRestoration } from 'react-router';
import type { Route } from './+types/root';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from './lib/queryClient';
import { Logo } from './components/ui/Logo';
import './index.css';

export function HydrateFallback() {
  return (
    <div
      className="fixed inset-0 flex flex-col items-center justify-center gap-6 bg-bg z-[100] animate-app-enter"
      role="status"
      aria-label="Loading"
    >
      <div className="flex flex-col items-center gap-3 animate-fade-up">
        <Logo lg />
        <div style={{ textAlign: 'center' }}>
          <p className="text-lg font-medium tracking-tight text-fg-1 m-0">ESP32 Display</p>
          <p className="text-xs text-fg-3 m-0">Real-time data for your e-ink display</p>
        </div>
      </div>
      <div
        className="w-40 h-[3px] bg-[rgba(128,128,128,0.15)] rounded-full overflow-hidden animate-fade-up"
        aria-hidden="true"
      >
        <div className="h-full w-1/2 bg-accent rounded-full animate-progress" />
      </div>
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
        <header className="flex justify-end items-center p-3 gap-2">
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
    <main className="flex flex-col items-center justify-center gap-3 py-12 px-4 text-fg-2 text-sm min-h-screen">
      <h1 style={{ fontWeight: 500 }}>{message}</h1>
      <p className="text-fg-2 text-sm m-0">{details}</p>
      {stack && (
        <pre className="text-xs font-mono overflow-x-auto max-w-full p-4">
          {stack}
        </pre>
      )}
    </main>
  );
}
