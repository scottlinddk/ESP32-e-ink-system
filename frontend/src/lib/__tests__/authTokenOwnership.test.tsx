import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuth } from '../../hooks/useAuth';

const session = vi.hoisted(() => ({
  renderedUser: 'alice' as string | undefined,
  currentUser: 'alice' as string | undefined,
  signedIn: true,
  getToken: vi.fn<[], Promise<string | null>>(),
}));
vi.mock('@clerk/clerk-react', () => ({
  useAuth: () => ({ isLoaded: true, isSignedIn: session.signedIn, getToken: session.getToken, signOut: vi.fn() }),
  useUser: () => ({ user: session.renderedUser ? { id: session.renderedUser } : undefined }),
  useClerk: () => ({ get user() { return session.currentUser ? { id: session.currentUser } : null; } }),
}));

function auth(client = new QueryClient()) {
  let result!: ReturnType<typeof useAuth>;
  function Probe() { result = useAuth(); return null; }
  renderToStaticMarkup(<QueryClientProvider client={client}><Probe /></QueryClientProvider>);
  return result;
}

beforeEach(() => {
  session.renderedUser = 'alice'; session.currentUser = 'alice'; session.signedIn = true;
  session.getToken.mockReset().mockResolvedValue('alice-token');
});

describe('token account ownership', () => {
  it('allows the current account token', async () => {
    await expect(auth().getToken()).resolves.toBe('alice-token');
  });

  it.each(['bob', undefined])('rejects a token if the active account changes to %s before Clerk resolves it', async (nextUser) => {
    let finish!: (token: string) => void;
    session.getToken.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const pending = auth().getToken();
    session.currentUser = nextUser;
    finish('new-session-token');
    await expect(pending).resolves.toBeNull();
  });

  it('rejects an old callback invoked after an account switch without requesting a token', async () => {
    const original = auth();
    session.currentUser = 'bob';
    await expect(original.getToken()).resolves.toBeNull();
    expect(session.getToken).not.toHaveBeenCalled();
  });

  it('allows a new route to reuse the same account\'s pending query without a retry', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    let finish!: (token: string) => void;
    session.getToken.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const dashboard = auth(client);
    const first = client.fetchQuery({ queryKey: ['preferences', 'alice'], queryFn: dashboard.getToken });
    // The original rendered tree has gone away. The new route joins its query.
    const integrations = auth(client);
    const second = client.fetchQuery({ queryKey: ['preferences', 'alice'], queryFn: integrations.getToken });
    finish('alice-token');
    await expect(first).resolves.toBe('alice-token');
    await expect(second).resolves.toBe('alice-token');
    expect(session.getToken).toHaveBeenCalledTimes(1);
    client.clear();
  });

  it('does not request tokens when signed out', async () => {
    session.signedIn = false;
    await expect(auth().getToken()).resolves.toBeNull();
    expect(session.getToken).not.toHaveBeenCalled();
  });
});
