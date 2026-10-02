import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { homeAssistantSetup } from '../homeAssistantSetup';
import { CustomWebhookCard } from '../../components/dashboard/CustomWebhookCard';

const state = vi.hoisted(() => ({
  userId: 'alice' as string | undefined, signedIn: true, lang: 'en',
  preferences: { data: { display_timezone: 'Europe/Copenhagen' } as unknown, isLoading: false, isError: false, refetch: vi.fn() },
  status: { data: { configured: true, state: 'fresh', observedAt: '2026-10-02T10:00:00Z', rowCount: 2 } as unknown, isLoading: false, isError: false, refetch: vi.fn() },
  save: { isPending: false, mutateAsync: vi.fn() },
}));
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ getToken: async () => 'clerk-token', user: state.userId ? { id: state.userId } : undefined, isSignedIn: state.signedIn }) }));
vi.mock('../../hooks/usePreferences', () => ({ usePreferences: () => state.preferences, useSavePreferences: () => state.save }));
vi.mock('../appContext', () => ({ useApp: () => ({ lang: state.lang }) }));
vi.mock('@tanstack/react-query', () => ({ useQuery: () => state.status, useQueryClient: () => ({ invalidateQueries: vi.fn() }) }));
vi.mock('../api', () => ({ createCustomWebhookToken: vi.fn(), deleteCustomWebhookToken: vi.fn(), getCustomWebhookStatus: vi.fn() }));

describe('Home Assistant configuration examples', () => {
  it('uses the current HTTPS origin and fixed ingest path without credentials, query strings or proxy config', () => {
    const result = homeAssistantSetup('https://display.example:8443/layout?token=SECRET');
    expect(result.endpoint).toBe('https://display.example:8443/api/custom-webhook/ingest');
    expect(result.needsHttpsHost).toBe(false);
    expect(result.secrets).toContain('eink_webhook_url: "https://display.example:8443/api/custom-webhook/ingest"');
    expect(JSON.stringify(result)).not.toContain('SECRET');
    expect(result.secrets).toContain('Bearer PASTE_YOUR_INTEGRATION_TOKEN_HERE');
    expect(result.restCommand).toContain('authorization: !secret eink_webhook_authorization');
    expect(result.restCommand).toContain('| to_json');
    expect(result.restCommand).toContain('verify_ssl: true');
    expect(result.automation).toContain('minutes: "/5"');
    expect(result.automation).toContain('action: rest_command.update_eink_sensors');
  });

  it.each([undefined, '', 'not a URL', 'http://display.example', 'https://localhost', 'https://dev.localhost',
    'https://127.0.0.1:5173', 'https://127.4.5.6', 'https://[::1]', 'https://user:password@display.example',
    'javascript:alert(1)'])('shows an explicit deployment placeholder for %s', (origin) => {
    const result = homeAssistantSetup(origin);
    expect(result.needsHttpsHost).toBe(true);
    expect(result.endpoint).toBe('https://YOUR-DISPLAY-HOST/api/custom-webhook/ingest');
    expect(result.secrets).not.toContain('password');
  });

  it.each(['https://192.168.1.50', 'https://display.local', 'https://[2001:db8::1234]', 'https://[fd00::1234]'])(
    'accepts a deployed HTTPS host %s whose reachability the user controls', (origin) => {
      expect(homeAssistantSetup(origin)).toMatchObject({ needsHttpsHost: false, endpoint: `${origin}/api/custom-webhook/ingest` });
    });
});

describe('Home Assistant setup card', () => {
  beforeEach(() => {
    state.userId = 'alice'; state.signedIn = true; state.lang = 'en';
    state.preferences = { data: { display_timezone: 'Europe/Copenhagen' }, isLoading: false, isError: false, refetch: vi.fn() };
    state.status = { data: { configured: true, state: 'fresh', observedAt: '2026-10-02T10:00:00Z', rowCount: 2 }, isLoading: false, isError: false, refetch: vi.fn() };
    state.save.isPending = false;
  });
  afterEach(() => { vi.unstubAllGlobals(); });
  const render = () => renderToStaticMarkup(<MemoryRouter><CustomWebhookCard /></MemoryRouter>);

  it('maps source settings to Custom sensors and includes directly usable setup guidance', () => {
    const markup = render();
    expect(markup).toContain('Custom sensors');
    expect(markup).toContain('href="/layout"');
    expect(markup).toContain('next fetch or Bluetooth transfer');
    expect(markup).toContain('secrets.yaml');
    expect(markup).toContain('configuration.yaml');
    expect(markup).toContain('automations.yaml');
    expect(markup).toContain('longer than five minutes');
    expect(markup).toContain('home-assistant.io/integrations/rest_command/');
    expect(markup).toContain('home-assistant.io/docs/configuration/secrets/');
    expect(markup).toContain('PASTE_YOUR_INTEGRATION_TOKEN_HERE');
    expect(markup).not.toContain('clerk-token');
    expect(markup).not.toContain('id="custom-webhook-token"');
  });

  it('localizes controls, state, errors and setup instructions in Danish', () => {
    state.lang = 'da'; state.preferences.isError = true; state.status.isError = true;
    const markup = render();
    expect(markup).toContain('Home Assistant og egne sensorer');
    expect(markup).toContain('Udskift token');
    expect(markup).toContain('Tilbagekald token');
    expect(markup).toContain('Opdatér status');
    expect(markup).toContain('Gem sensorindstillinger');
    expect(markup).toContain('Kunne ikke indlæse sensorindstillinger');
    expect(markup).toContain('Målingerne er friske');
    expect(markup).toContain('Opsæt Home Assistant trin for trin');
    expect(markup).not.toContain('Show sensor readings');
    expect(markup).not.toContain('Save sensor settings');
  });

  it('remounts all token and dirty preference state on account changes', () => {
    expect(CustomWebhookCard().key).toBe('alice');
    state.userId = 'bob';
    expect(CustomWebhookCard().key).toBe('bob');
    state.userId = undefined;
    expect(CustomWebhookCard().key).toBe('signed-out');
  });

  it.each(['loading', 'error', 'signed-out'])('blocks token mutation when status is %s, including cached data', (mode) => {
    state.status.isLoading = mode === 'loading';
    state.status.isError = mode === 'error';
    state.signedIn = mode !== 'signed-out';
    const markup = render();
    expect(markup).toMatch(/<button[^>]*disabled=""[^>]*>Replace token<\/button>/);
    expect(markup).toMatch(/<button[^>]*disabled=""[^>]*>Revoke token<\/button>/);
  });

  it.each(['loading', 'error', 'missing', 'saving'])('blocks preference changes while %s', (mode) => {
    state.preferences.isLoading = mode === 'loading';
    state.preferences.isError = mode === 'error';
    if (mode === 'missing') state.preferences.data = undefined;
    state.save.isPending = mode === 'saving';
    expect(render()).toContain('<fieldset disabled=""');
  });
});
