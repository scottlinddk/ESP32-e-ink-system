import { describe, expect, it } from 'vitest';
import { hashWebhookToken, parseWebhookBearer, parseWebhookPayload, parseWebhookPreferences, webhookDisplayData, WebhookRecord } from '../services/customWebhook';
import { BmpCanvas, renderDisplayData, renderDisplayDataRaw } from '../utils/bmpGenerator';
import { renderWebhookWidget } from '../utils/webhookRenderer';
import type { CustomWebhookData, DisplayLayout } from '../types';

const now = new Date('2026-09-28T12:00:00Z');
const rows = [{ label: 'Kitchen', value: '21.5', unit: '°C' }];
const record: WebhookRecord = {
  user_id: 'owner', token_hash: 'a'.repeat(64), token_created_at: '2026-09-27T12:00:00Z', rows,
  observed_at: '2026-09-28T11:30:00+00:00', received_at: '2026-09-28T11:45:00+00:00',
};

describe('webhook payload boundaries', () => {
  it('keeps values as plain text and assigns receipt time on the server', () => {
    expect(parseWebhookPayload({ rows: [{ label: '  Køkken ', value: '<b>21 & 22</b>', unit: ' °C ' }] }, now)).toEqual({
      rows: [{ label: 'Køkken', value: '<b>21 & 22</b>', unit: '°C' }],
      observed_at: now.toISOString(), received_at: now.toISOString(),
    });
  });

  it('normalizes supported UTC timestamps and Unicode', () => {
    expect(parseWebhookPayload({ rows: [{ label: 'A\u030Arhus', value: '1' }], observed_at: '2026-09-28T11:00:00.1Z' }, now))
      .toEqual({ rows: [{ label: 'Århus', value: '1' }], observed_at: '2026-09-28T11:00:00.100Z', received_at: now.toISOString() });
  });

  it.each([null, [], {}, { rows: [] }, { rows: Array.from({ length: 13 }, (_, i) => ({ label: String(i), value: '1' })) },
    { rows: [null] }, { rows: [{ label: 'a', value: 1 }] }, { rows: [{ label: 'x'.repeat(41), value: '1' }] },
    { rows: [{ label: 'a', value: 'x'.repeat(81) }] }, { rows: [{ label: 'a', value: '1', unit: 'x'.repeat(17) }] },
    { rows: [{ label: 'a', value: 'line\nbreak' }] }, { rows: [{ label: '\ud800', value: '1' }] },
    { rows: [{ label: 'a', value: '\0' }] }, { rows: [{ label: 'a', value: '   ' }] },
    { rows: [{ label: 'a', value: '1', url: 'http://localhost' }] }, { rows, user_id: 'someone-else' },
    { rows: [{ label: 'name', value: '1' }, { label: 'NAME', value: '2' }] }])(
    'rejects malformed/oversized data: %j', (input) => expect(() => parseWebhookPayload(input, now)).toThrow());

  it.each(['2026-09-28T12:00:01Z', '2026-02-30T12:00:00Z', '2026-09-28T24:00:00Z', '2026-09-28',
    '2026-09-28T11:00:00+00:00', 'garbage', '1969-01-01T00:00:00Z'])('rejects invalid/future observation %s', (observed_at) => {
    expect(() => parseWebhookPayload({ rows, observed_at }, now)).toThrow('observed_at');
  });

  it('validates enabled and lifetime preferences', () => {
    expect(parseWebhookPreferences({ show_custom_webhook: true, custom_webhook_ttl_minutes: 1 })).toEqual({ show_custom_webhook: true, custom_webhook_ttl_minutes: 1 });
    expect(parseWebhookPreferences({ unrelated: true })).toEqual({});
    for (const value of [0, 1441, 1.5, '60', null]) expect(() => parseWebhookPreferences({ custom_webhook_ttl_minutes: value })).toThrow();
    expect(() => parseWebhookPreferences({ show_custom_webhook: 'true' })).toThrow();
  });

  it('only accepts the dedicated bearer token format and hashes it deterministically', () => {
    const token = `ewh_${'a'.repeat(64)}`;
    expect(parseWebhookBearer(`Bearer ${token}`)).toBe(token);
    expect(hashWebhookToken(token)).toMatch(/^[a-f0-9]{64}$/);
    expect(hashWebhookToken(token)).not.toContain(token);
    expect(hashWebhookToken(token)).toBe(hashWebhookToken(token));
    for (const header of [undefined, token, 'Bearer clerk-jwt', `Bearer ${token} `, `Basic ${token}`]) expect(parseWebhookBearer(header)).toBeNull();
  });
});

describe('sensor freshness', () => {
  it('expires exactly at the observation plus lifetime boundary, even after a recent upload', () => {
    expect(webhookDisplayData(record, 31, now).state).toBe('fresh');
    const stale = webhookDisplayData(record, 30, now);
    expect(stale.state).toBe('stale');
    expect(stale.expiresAt).toBe('2026-09-28T12:00:00.000Z');
    expect(stale.rows).toEqual(rows);
    expect(webhookDisplayData({ ...record, received_at: now.toISOString() }, 30, now).state).toBe('stale');
  });

  it('never treats revoked, absent, corrupt or future-dated records as current readings', () => {
    for (const value of [null, { ...record, token_hash: null }, { ...record, rows: [] },
      { ...record, observed_at: 'bad' }, { ...record, observed_at: '2026-09-29T00:00:00Z' },
      { ...record, received_at: '2026-09-29T00:00:00Z' }]) {
      expect(webhookDisplayData(value, 60, now)).toEqual({ state: 'unavailable', rows: [], observedAt: null, receivedAt: null, expiresAt: null });
    }
  });

  it('uses safe lifetime defaults for legacy invalid settings', () => {
    expect(webhookDisplayData(record, Number.NaN, now).expiresAt).toBe('2026-09-28T12:30:00.000Z');
  });
});

describe('sensor widget rendering', () => {
  const layout: DisplayLayout = { version: 1, cols: 10, rows: 6, widgets: [{ i: 'custom-webhook', x: 0, y: 0, w: 10, h: 3 }] };

  it('renders visible freshness and plain text through matching BMP/raw pixels', () => {
    const customWebhook = webhookDisplayData(record, 30, now);
    const raw = renderDisplayDataRaw({ customWebhook, nextRefresh: 300000 }, layout);
    const expected = new BmpCanvas();
    expected.drawText('STALE sensors', 2, 2);
    expected.drawText('Kitchen: 21.5 °C', 2, 12);
    expect(raw).toEqual(expected.toRawPixels());
    expect(renderDisplayData({ customWebhook, nextRefresh: 300000 }, layout).subarray(62)).toEqual(raw);
    expect(raw).not.toEqual(renderDisplayDataRaw({ customWebhook: { ...customWebhook, state: 'fresh' }, nextRefresh: 300000 }, layout));
  });

  it('shows unavailable state and leaves disabled widgets blank', () => {
    const unavailable = webhookDisplayData(null, 60, now);
    const expected = new BmpCanvas(); expected.drawText('No sensor data', 2, 2);
    expect(renderDisplayDataRaw({ customWebhook: unavailable, nextRefresh: 300000 }, layout)).toEqual(expected.toRawPixels());
    expect(renderDisplayDataRaw({ nextRefresh: 300000 }, layout).every((byte) => byte === 0xff)).toBe(true);
  });

  it('bounds rows to the widget height', () => {
    const drawn: string[] = [];
    const data: CustomWebhookData = { ...webhookDisplayData(record, 60, now), rows: Array(12).fill(rows[0]) };
    renderWebhookWidget({ drawText(text) { drawn.push(text); } }, { x: 0, y: 0, width: 100, height: 20 }, data);
    expect(drawn).toEqual(['Sensors', 'Kitchen: 21.5 °C']);
  });
});
