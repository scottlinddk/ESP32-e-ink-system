import { describe, it, expect, vi, beforeEach } from 'vitest';
import { zaptecWidget } from '../widgets/zaptec/index';
import { WidgetRegistry } from '../registry';
import type { ZaptecData } from '../widgets/zaptec/types';

describe('zaptecWidget', () => {
  describe('meta', () => {
    it('has correct id and category', () => {
      expect(zaptecWidget.meta.id).toBe('zaptec');
      expect(zaptecWidget.meta.category).toBe('ev');
      expect(zaptecWidget.meta.requiresOauth).toBe('zaptec');
    });
  });

  describe('configSchema', () => {
    it('parses valid config with defaults', () => {
      const result = zaptecWidget.configSchema.safeParse({
        username: 'user@example.com',
        password: 'secret',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.showChargerStatus).toBe(true);
        expect(result.data.showActiveSession).toBe(true);
        expect(result.data.showInstallationInfo).toBe(false);
      }
    });

    it('parses explicit field values', () => {
      const result = zaptecWidget.configSchema.safeParse({
        username: 'user@example.com',
        password: 'secret',
        showChargerStatus: false,
        showActiveSession: false,
        showInstallationInfo: true,
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.showInstallationInfo).toBe(true);
        expect(result.data.showChargerStatus).toBe(false);
      }
    });

    it('rejects missing username', () => {
      const result = zaptecWidget.configSchema.safeParse({ password: 'secret' });
      expect(result.success).toBe(false);
    });

    it('rejects empty password', () => {
      const result = zaptecWidget.configSchema.safeParse({ username: 'u@example.com', password: '' });
      expect(result.success).toBe(false);
    });
  });

  describe('render', () => {
    const region = { widthPx: 250, heightPx: 40 };
    const typography = { xs: 7, sm: 8, base: 9, lg: 12, xl: 16 };

    it('renders Zaptec header', () => {
      const data: ZaptecData = { chargers: [], activeSession: null, installationName: null };
      const result = zaptecWidget.render(data, region, typography);
      const texts = result.elements.filter((e) => e.kind === 'text').map((e) => (e as { text: string }).text);
      expect(texts.some((t) => t.includes('Zaptec'))).toBe(true);
    });

    it('includes installation name in header when set', () => {
      const data: ZaptecData = {
        chargers: [],
        activeSession: null,
        installationName: 'Home Garage',
      };
      const result = zaptecWidget.render(data, region, typography);
      const texts = result.elements.filter((e) => e.kind === 'text').map((e) => (e as { text: string }).text);
      expect(texts.some((t) => t.includes('Home Garage'))).toBe(true);
    });

    it('renders charger availability counts', () => {
      const data: ZaptecData = {
        chargers: [
          { id: '1', name: 'C1', operatingMode: 1 }, // disconnected = available
          { id: '2', name: 'C2', operatingMode: 3 }, // charging
          { id: '3', name: 'C3', operatingMode: 5 }, // finished, still occupied
          { id: '4', name: 'C4', operatingMode: 2 }, // requesting, still occupied
        ],
        activeSession: null,
        installationName: null,
      };
      const result = zaptecWidget.render(data, region, typography);
      const texts = result.elements.filter((e) => e.kind === 'text').map((e) => (e as { text: string }).text);
      expect(texts.some((t) => t.includes('1 avail') && t.includes('1 charging'))).toBe(true);
    });

    it('renders active session details', () => {
      const bigRegion = { widthPx: 250, heightPx: 60 };
      const data: ZaptecData = {
        chargers: [],
        activeSession: {
          id: 's1',
          energyDeliveredKwh: 4.2,
          startDateTime: new Date().toISOString(),
          chargerName: 'Garage',
        },
        installationName: null,
      };
      const result = zaptecWidget.render(data, bigRegion, typography);
      const texts = result.elements.filter((e) => e.kind === 'text').map((e) => (e as { text: string }).text);
      expect(texts.some((t) => t.includes('4.2') && t.includes('Garage'))).toBe(true);
    });

    it('returns correct region', () => {
      const data: ZaptecData = { chargers: [], activeSession: null, installationName: null };
      const result = zaptecWidget.render(data, region, typography);
      expect(result.region).toEqual(region);
    });
  });

  describe('fetch', () => {
    beforeEach(() => {
      vi.restoreAllMocks();
    });

    it('returns error on auth failure', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('Unauthorized', { status: 401 })));
      const result = await zaptecWidget.fetch(
        { username: 'u@e.com', password: 'pw', showChargerStatus: true, showActiveSession: true, showInstallationInfo: false },
        { widthPx: 250, heightPx: 40 }
      );
      expect(result.ok).toBe(false);
    });

    it('returns ok result with mocked API', async () => {
      const tokenResponse = { access_token: 'test_token', expires_in: 3600 };
      const chargersResponse = {
        data: [{ id: 'c1', name: 'Charger A', operatingMode: 1 }], pages: 1, totalCount: 1,
      };

      vi.stubGlobal(
        'fetch',
        vi.fn().mockImplementation(async (url: string) => {
          if (String(url).includes('/oauth/token')) {
            return new Response(JSON.stringify(tokenResponse));
          }
          if (String(url).includes('/api/chargers')) {
            return new Response(JSON.stringify(chargersResponse));
          }
          return new Response('Not found', { status: 404 });
        })
      );

      const result = await zaptecWidget.fetch(
        { username: 'u@e.com', password: 'pw', showChargerStatus: true, showActiveSession: false, showInstallationInfo: false },
        { widthPx: 250, heightPx: 40 }
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.chargers).toHaveLength(1);
        expect(result.data.chargers[0].name).toBe('Charger A');
        expect(result.data.chargers[0].operatingMode).toBe(1);
      }
    });
  });
});

describe('zaptecWidget registry integration', () => {
  it('can be registered and retrieved', () => {
    const registry = new WidgetRegistry();
    registry.register(zaptecWidget);
    expect(registry.get('zaptec')).toBe(zaptecWidget);
  });
});
