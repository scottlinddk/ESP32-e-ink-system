import { describe, it, expect, vi, beforeEach } from 'vitest';
import { montaWidget } from '../widgets/monta/index';
import { WidgetRegistry } from '../registry';
import type { MontaData } from '../widgets/monta/types';

describe('montaWidget', () => {
  describe('meta', () => {
    it('has correct id and category', () => {
      expect(montaWidget.meta.id).toBe('monta');
      expect(montaWidget.meta.category).toBe('ev');
      expect(montaWidget.meta.requiresOauth).toBe('monta');
    });
  });

  describe('configSchema', () => {
    it('parses valid config', () => {
      const result = montaWidget.configSchema.safeParse({
        clientId: 'client_abc',
        clientSecret: 'secret_xyz',
        showChargerStatus: true,
        showActiveSession: false,
        showTodayStats: true,
      });
      expect(result.success).toBe(true);
    });

    it('applies defaults for booleans', () => {
      const result = montaWidget.configSchema.safeParse({
        clientId: 'client_abc',
        clientSecret: 'secret_xyz',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.showChargerStatus).toBe(true);
        expect(result.data.showActiveSession).toBe(true);
        expect(result.data.showTodayStats).toBe(false);
      }
    });

    it('rejects missing clientId', () => {
      const result = montaWidget.configSchema.safeParse({
        clientSecret: 'secret_xyz',
        showChargerStatus: true,
        showActiveSession: true,
        showTodayStats: false,
      });
      expect(result.success).toBe(false);
    });

    it('rejects empty clientSecret', () => {
      const result = montaWidget.configSchema.safeParse({
        clientId: 'client_abc',
        clientSecret: '',
        showChargerStatus: true,
        showActiveSession: true,
        showTodayStats: false,
      });
      expect(result.success).toBe(false);
    });
  });

  describe('render', () => {
    const region = { widthPx: 250, heightPx: 40 };
    const typography = { xs: 7, sm: 8, base: 9, lg: 12, xl: 16 };

    it('renders header text', () => {
      const data: MontaData = { chargePoints: [], activeSessions: [], todayKwh: null };
      const result = montaWidget.render(data, region, typography);
      const texts = result.elements.filter((e) => e.kind === 'text').map((e) => (e as { text: string }).text);
      expect(texts.some((t) => t.includes('Monta'))).toBe(true);
    });

    it('renders charger status when chargePoints present', () => {
      const data: MontaData = {
        chargePoints: [
          { id: '1', state: 'available', name: 'CP1' },
          { id: '2', state: 'charging', name: 'CP2' },
          { id: '3', state: 'offline', name: 'CP3' },
        ],
        activeSessions: [],
        todayKwh: null,
      };
      const result = montaWidget.render(data, region, typography);
      const texts = result.elements.filter((e) => e.kind === 'text').map((e) => (e as { text: string }).text);
      expect(texts.some((t) => t.includes('1 avail') && t.includes('1 charging'))).toBe(true);
    });

    it('renders active session energy and duration', () => {
      const data: MontaData = {
        chargePoints: [],
        activeSessions: [{ id: 's1', energyDeliveredKwh: 7.5, startedAt: new Date().toISOString(), durationMin: 45 }],
        todayKwh: null,
      };
      const result = montaWidget.render(data, region, typography);
      const texts = result.elements.filter((e) => e.kind === 'text').map((e) => (e as { text: string }).text);
      expect(texts.some((t) => t.includes('7.5') && t.includes('45'))).toBe(true);
    });

    it('renders today stats when todayKwh provided and space available', () => {
      const bigRegion = { widthPx: 250, heightPx: 80 };
      const data: MontaData = { chargePoints: [], activeSessions: [], todayKwh: 23.4 };
      const result = montaWidget.render(data, bigRegion, typography);
      const texts = result.elements.filter((e) => e.kind === 'text').map((e) => (e as { text: string }).text);
      expect(texts.some((t) => t.includes('23.4'))).toBe(true);
    });

    it('returns region unchanged', () => {
      const data: MontaData = { chargePoints: [], activeSessions: [], todayKwh: null };
      const result = montaWidget.render(data, region, typography);
      expect(result.region).toEqual(region);
    });
  });

  describe('fetch', () => {
    beforeEach(() => {
      vi.restoreAllMocks();
    });

    it('returns error result on auth failure', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401, text: async () => 'Unauthorized' }));
      const result = await montaWidget.fetch(
        { clientId: 'x', clientSecret: 'y', showChargerStatus: true, showActiveSession: true, showTodayStats: false },
        { widthPx: 250, heightPx: 40 }
      );
      expect(result.ok).toBe(false);
    });

    it('returns ok result with mocked successful API', async () => {
      const tokenResponse = { access_token: 'test_token', expires_in: 3600 };
      const chargePointsResponse = {
        data: [{ id: 'cp1', state: 'Available', name: 'Charger 1' }],
      };
      const chargesResponse = { data: [] };

      let callCount = 0;
      vi.stubGlobal(
        'fetch',
        vi.fn().mockImplementation(async (url: string) => {
          callCount++;
          if (String(url).includes('/auth/token')) {
            return { ok: true, json: async () => tokenResponse };
          }
          if (String(url).includes('/charges')) {
            return { ok: true, json: async () => chargesResponse };
          }
          if (String(url).includes('/charge-points')) {
            return { ok: true, json: async () => chargePointsResponse };
          }
          return { ok: false, status: 404, text: async () => 'Not found' };
        })
      );

      const result = await montaWidget.fetch(
        { clientId: 'cid', clientSecret: 'csec', showChargerStatus: true, showActiveSession: true, showTodayStats: false },
        { widthPx: 250, heightPx: 40 }
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.chargePoints).toHaveLength(1);
        expect(result.data.chargePoints[0].state).toBe('available');
      }
    });
  });
});

describe('montaWidget registry integration', () => {
  it('can be registered and retrieved', () => {
    const registry = new WidgetRegistry();
    registry.register(montaWidget);
    expect(registry.get('monta')).toBe(montaWidget);
    expect(registry.has('monta')).toBe(true);
  });
});
