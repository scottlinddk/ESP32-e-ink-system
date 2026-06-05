// =========================================================================
// root.tsx — framework root: HTML shell, ClerkProvider, QueryClientProvider
// =========================================================================
import { ClerkProvider } from '@clerk/react-router';
import { clerkMiddleware, rootAuthLoader } from '@clerk/react-router/server';
import { Links, Meta, Outlet, Scripts, ScrollRestoration } from 'react-router';
import type { LoaderFunctionArgs, LinkDescriptor } from 'react-router';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from './lib/queryClient';
import './index.css';

// @clerk/react-router/server reads CLERK_PUBLISHABLE_KEY at runtime.
// Vercel projects set up before SSR migration may only have VITE_CLERK_PUBLISHABLE_KEY,
// so we fall back to that name. Fail fast with a readable message if neither is set
// so the error surfaces as a clear log line instead of FUNCTION_INVOCATION_FAILED.
const clerkPublishableKey =
  process.env.CLERK_PUBLISHABLE_KEY || process.env.VITE_CLERK_PUBLISHABLE_KEY;
if (!clerkPublishableKey) {
  throw new Error(
    'Missing required environment variable: CLERK_PUBLISHABLE_KEY (or VITE_CLERK_PUBLISHABLE_KEY)'
  );
}

export const middleware = [clerkMiddleware({ publishableKey: clerkPublishableKey })];

export async function loader(args: LoaderFunctionArgs) {
  return rootAuthLoader(args);
}

export const links = (): LinkDescriptor[] => [
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
      <body>
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function Root({ loaderData }: { loaderData?: unknown }) {
  return (
    <ClerkProvider
      loaderData={loaderData as Parameters<typeof ClerkProvider>[0]['loaderData']}
      signInFallbackRedirectUrl="/"
      signUpFallbackRedirectUrl="/"
    >
      <QueryClientProvider client={queryClient}>
        <Outlet />
      </QueryClientProvider>
    </ClerkProvider>
  );
}

export function ErrorBoundary({ error }: { error?: unknown }) {
  let message = 'Oops!';
  let details = 'An unexpected error occurred.';
  let stack: string | undefined;

  if (error instanceof Error) {
    details = error.message;
    if (import.meta.env.DEV) {
      stack = error.stack;
    }
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
