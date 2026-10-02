import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiKeysCard } from '../../components/dashboard/ApiKeysCard';
import { STRINGS } from '../strings';

const state = vi.hoisted(() => ({
  lang: 'en' as 'en' | 'da', signedIn: true, userId: 'alice' as string | undefined,
  pending: false, error: false, cached: true, configured: false, mutationPending: false,
  errorProvider: '', refetch: vi.fn(), mutate: vi.fn(),
}));
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({
  getToken: async () => 'clerk-token', isSignedIn: state.signedIn,
  user: state.userId ? { id: state.userId } : undefined,
}) }));
vi.mock('../appContext', () => ({ useApp: () => ({ lang: state.lang, t: STRINGS[state.lang], toast: vi.fn() }) }));
vi.mock('../../hooks/usePreferences', () => ({ useApiKeys: () => ({
  data: state.cached ? (state.configured ? [
    { provider: 'openweathermap', api_key: '****weather' }, { provider: 'newsapi', api_key: '****news' },
  ] : []) : undefined,
  isPending: state.pending, isError: state.error || state.errorProvider === 'api-keys',
  isFetching: false, refetch: state.refetch,
}) }));
vi.mock('@tanstack/react-query', () => ({
  useQuery: ({ queryKey }: { queryKey: string[] }) => ({
    data: state.cached ? { configured: state.configured } : undefined,
    isPending: state.pending, isError: state.error || state.errorProvider === queryKey[1],
    isFetching: false, refetch: state.refetch,
  }),
  useMutation: () => ({ isPending: state.mutationPending, mutate: state.mutate }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));
// Render dialog footers even when closed to verify an already-open form cannot
// save after its status query changes to an error or pending state.
vi.mock('../../components/ui/Dialog', () => ({ Dialog: ({ footer }: { footer: React.ReactNode }) => <div>{footer}</div> }));

const render = () => renderToStaticMarkup(<ApiKeysCard />);
const buttons = (markup: string, label: string) => [...markup.matchAll(/<button\b[^>]*>[\s\S]*?<\/button>/g)]
  .map(([button]) => button)
  .filter((button) => button.replace(/<[^>]+>/g, '').endsWith(label));
const expectMutationButtons = (markup: string, disabled: boolean) => {
  const t = STRINGS[state.lang];
  const labels = [t.addKey, t.updateKey, t.removeKey, t.evCredRemove, t.evCredSave, t.saveKey];
  const matches = labels.flatMap((label) => buttons(markup, label));
  expect(matches.length).toBeGreaterThanOrEqual(9);
  for (const button of matches) expect(button.includes('disabled=""')).toBe(disabled);
};

describe('credential status gating', () => {
  beforeEach(() => {
    state.lang = 'en'; state.signedIn = true; state.userId = 'alice';
    state.pending = false; state.error = false; state.cached = true; state.configured = false;
    state.mutationPending = false; state.errorProvider = '';
    vi.clearAllMocks();
  });

  it.each(['pending', 'empty', 'error', 'cached-error', 'signed-out'])(
    'does not label unknown %s status as unconfigured and blocks every mutation including dialog saves', (mode) => {
      state.pending = mode === 'pending';
      state.error = mode === 'error' || mode === 'cached-error';
      state.cached = mode === 'cached-error' || mode === 'signed-out';
      state.configured = state.cached;
      state.signedIn = mode !== 'signed-out';
      const markup = render();
      expect(markup).not.toContain(STRINGS.en.statusNotConfigured);
      expect(markup).not.toContain(STRINGS.en.evCredNotConfigured);
      expect(markup).not.toContain(STRINGS.en.keyConfigured);
      expect(markup).toContain(state.error ? 'Could not load status' : 'Loading…');
      expectMutationButtons(markup, true);
      expect(buttons(markup, 'Retry')).toHaveLength(state.error ? 5 : 0);
    },
  );

  it('enables adding credentials only after a successful empty status result', () => {
    const markup = render();
    expect(markup).toContain(STRINGS.en.statusNotConfigured);
    expect(buttons(markup, STRINGS.en.addKey)).toHaveLength(5);
    expectMutationButtons(markup, false);
  });

  it('labels saved weather and news keys without claiming successful provider verification', () => {
    state.configured = true;
    const markup = render();
    expect(markup.split(STRINGS.en.keyConfigured)).toHaveLength(3);
    expect(markup).not.toContain(`>${STRINGS.en.statusConnected}<`);
    expect(markup).toContain('****weather');
    expect(markup).toContain('****news');
    expectMutationButtons(markup, false);
  });

  it.each(['monta', 'zaptec', 'notion', 'api-keys'])('isolates %s failures from the other credential sections', (provider) => {
    state.errorProvider = provider;
    const markup = render();
    expect(buttons(markup, 'Retry')).toHaveLength(provider === 'api-keys' ? 2 : 1);
    const addButtons = buttons(markup, STRINGS.en.addKey);
    expect(addButtons.filter((button) => button.includes('disabled=""'))).toHaveLength(provider === 'api-keys' ? 2 : 1);
  });

  it('disables competing actions while a mutation is pending', () => {
    state.configured = true; state.mutationPending = true;
    expectMutationButtons(render(), true);
  });

  it('localizes loading, errors and retry controls in Danish', () => {
    state.lang = 'da'; state.pending = true; state.cached = false;
    expect(render()).toContain('Indlæser…');
    state.pending = false; state.error = true;
    const markup = render();
    expect(markup).toContain('Kunne ikke indlæse status');
    expect(buttons(markup, 'Prøv igen')).toHaveLength(5);
    expect(markup).not.toContain('Could not load status');
    expectMutationButtons(markup, true);
  });
});
