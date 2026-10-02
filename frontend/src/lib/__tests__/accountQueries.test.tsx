import React from 'react';
import { renderToString } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useApiKeys, usePreferences, useSavePreferences } from '../../hooks/usePreferences';
import { useDisplayPreview } from '../../hooks/useDisplayPreview';
import { savePreferences } from '../api';
import type { UserPreferences } from '../../types';

const auth = vi.hoisted(() => ({ userId: 'alice' }));
vi.mock('../../hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: auth.userId }, isSignedIn: true, getToken: async () => `token-${auth.userId}` }),
}));
vi.mock('../api', () => ({
  getPreferences: vi.fn(), getApiKeys: vi.fn(), savePreferences: vi.fn(), saveApiKey: vi.fn(), getPreviewData: vi.fn(),
}));

const preferences = (note: string) => ({ custom_text: note }) as UserPreferences;

describe('account-scoped dashboard queries', () => {
  beforeEach(() => { auth.userId = 'alice'; vi.clearAllMocks(); });

  function probe(client: QueryClient, deviceId?: string) {
    let mutation: ReturnType<typeof useSavePreferences> | undefined;
    function Contents() {
      const prefs = usePreferences(deviceId);
      const keys = useApiKeys();
      const preview = useDisplayPreview();
      mutation = useSavePreferences(deviceId);
      return <div>{JSON.stringify({ note: prefs.data?.custom_text, keys: keys.data, preview: preview.data })}</div>;
    }
    const markup = renderToString(<QueryClientProvider client={client}><Contents /></QueryClientProvider>);
    return { markup, mutation: mutation! };
  }

  it('never displays the previous account\'s cached notes, keys or preview after switching', () => {
    const client = new QueryClient();
    client.setQueryData(['preferences', 'alice'], preferences('ALICE_PRIVATE_NOTE'));
    client.setQueryData(['api-keys', 'alice'], [{ provider: 'newsapi', api_key: 'ALICE_MASKED_KEY' }]);
    client.setQueryData(['preview', 'alice', undefined], { customWebhook: { rows: [{ value: 'ALICE_SENSOR' }] } });
    expect(probe(client).markup).toContain('ALICE_PRIVATE_NOTE');
    expect(probe(client).markup).toContain('ALICE_MASKED_KEY');
    expect(probe(client).markup).toContain('ALICE_SENSOR');

    auth.userId = 'bob';
    expect(probe(client).markup).not.toContain('ALICE');
    client.setQueryData(['preferences', 'bob'], preferences('BOB_NOTE'));
    expect(probe(client).markup).toContain('BOB_NOTE');
    client.clear();
  });

  it('keeps an in-flight save in its original account cache and preserves prefix invalidation', async () => {
    const client = new QueryClient();
    client.setQueryData(['preferences', 'alice'], preferences('old Alice'));
    client.setQueryData(['preferences', 'bob'], preferences('Bob unchanged'));
    let finish!: (value: { preferences: UserPreferences }) => void;
    vi.mocked(savePreferences).mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const saving = probe(client).mutation.mutateAsync(preferences('updated Alice'));
    await vi.waitFor(() => expect(savePreferences).toHaveBeenCalledWith('token-alice', preferences('updated Alice')));
    auth.userId = 'bob';
    expect(probe(client).markup).toContain('Bob unchanged');
    finish({ preferences: preferences('updated Alice') });
    await saving;
    expect(client.getQueryData(['preferences', 'alice'])).toEqual(preferences('updated Alice'));
    expect(client.getQueryData(['preferences', 'bob'])).toEqual(preferences('Bob unchanged'));
    expect(client.getQueryData(['preferences'])).toBeUndefined();

    await client.invalidateQueries({ queryKey: ['preferences'] });
    expect(client.getQueryState(['preferences', 'alice'])?.isInvalidated).toBe(true);
    expect(client.getQueryState(['preferences', 'bob'])?.isInvalidated).toBe(true);
    client.clear();
  });

  it('separates two device caches from account defaults and keeps a late save on the captured device', async () => {
    const client = new QueryClient();
    client.setQueryData(['preferences', 'alice'], preferences('Shared'));
    client.setQueryData(['preferences', 'alice', 'kitchen'], preferences('Kitchen'));
    client.setQueryData(['preferences', 'alice', 'office'], preferences('Office'));
    expect(probe(client, 'kitchen').markup).toContain('Kitchen');
    expect(probe(client, 'office').markup).toContain('Office');
    expect(probe(client, 'missing').markup).not.toMatch(/Kitchen|Office|Shared/);
    let finish!: (result: { preferences: UserPreferences }) => void;
    vi.mocked(savePreferences).mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const pending = probe(client, 'kitchen').mutation.mutateAsync({ display_timezone: 'UTC' });
    await vi.waitFor(() => expect(savePreferences).toHaveBeenCalledWith('token-alice', { display_timezone: 'UTC' }, 'kitchen'));
    expect(probe(client, 'office').markup).toContain('Office');
    finish({ preferences: preferences('Updated kitchen') });
    await pending;
    expect(client.getQueryData(['preferences', 'alice', 'kitchen'])).toEqual(preferences('Updated kitchen'));
    expect(client.getQueryData(['preferences', 'alice', 'office'])).toEqual(preferences('Office'));
    expect(client.getQueryData(['preferences', 'alice'])).toEqual(preferences('Shared'));
    auth.userId = 'bob';
    expect(probe(client, 'kitchen').markup).not.toContain('kitchen');
    client.clear();
  });
});
