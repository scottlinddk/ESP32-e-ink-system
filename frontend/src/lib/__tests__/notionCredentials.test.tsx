import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ApiKeysCard } from '../../components/dashboard/ApiKeysCard';
import { notionCredentialsForSave } from '../notionCredentials';
import { STRINGS } from '../strings';
const state = vi.hoisted(() => ({ lang: 'en' as 'en' | 'da' }));
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'alice' }, isSignedIn: true, getToken: async () => 'token' }) }));
vi.mock('../appContext', () => ({ useApp: () => ({ lang: state.lang, t: STRINGS[state.lang], toast: vi.fn() }) }));
vi.mock('../../hooks/usePreferences', () => ({ useApiKeys: () => ({ data: [], isPending: false, isError: false }) }));
vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({ data: { configured: false }, isPending: false, isError: false }),
  useMutation: () => ({ mutate: vi.fn(), isPending: false }), useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));
vi.mock('../../components/ui/Dialog', () => ({ Dialog: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));

describe('Notion integration form', () => {
  it.each(['ntn_current', 'secret_previous'])('saves a trimmed %s token and optional explicit source', (token) => {
    expect(notionCredentialsForSave({ token: ` ${token} `, databaseId: ' https://notion.so/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa ', dataSourceId: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', statusProperty: ' Status ', filterStatus: ' Active ' }))
      .toEqual({ token, databaseId: 'https://notion.so/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', dataSourceId: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', statusProperty: 'Status', filterStatus: 'Active' });
  });
  it('omits empty optional settings and unknown draft keys', () => {
    expect(notionCredentialsForSave({ token: 'ntn_current', databaseId: 'database', dataSourceId: '  ', unknown: 'private' })).toEqual({ token: 'ntn_current', databaseId: 'database' });
  });
  it.each<Record<string, string>>([{ token: 'ntn_' }, { token: 'ntn_a b' }, { token: 'ntn_' + 'a'.repeat(512) }, { databaseId: '' }, { dataSourceId: 'wrong' }, { statusProperty: 'a'.repeat(101) }, { filterStatus: 'Active' }])('blocks malformed/incomplete drafts %j', (patch) => {
    expect(() => notionCredentialsForSave({ token: 'ntn_current', databaseId: 'database', ...patch })).toThrow();
  });
  it.each(['en', 'da'] as const)('renders modern token and data source instructions in %s', (lang) => {
    state.lang = lang;
    const html = renderToStaticMarkup(<ApiKeysCard />);
    expect(html).toContain('ntn_'); expect(html).toContain('secret_');
    expect(html).toContain('id="notion-source-id"');
    expect(html).toContain('Copy data source ID');
    expect(html).toContain(STRINGS[lang].notionDataSourceId);
    expect(html).not.toContain('Token must start');
  });
});
