import type { UserPreferences } from '../types';
import { LayoutValidationError, parseDisplayLayout } from './layoutValidation';
import { DisplaySchedule, parseDisplaySchedule, ScheduleValidationError } from './scheduleValidation';

export const TEMPLATE_MAX_BYTES = 8192;
export const TEMPLATE_SETTING_KEYS = [
  'show_energy_price', 'show_weather', 'show_news', 'show_air_quality', 'show_monta', 'show_zaptec', 'show_notion',
  'energy_price_location', 'weather_location', 'news_language', 'refresh_interval_minutes', 'layout', 'monta_fields', 'zaptec_fields', 'display_profile', 'display_schedule',
] as const;

export type TemplateSettings = Partial<UserPreferences> & {
  display_profile?: { width: number; height: number; rotation: 0 | 90 | 180 | 270; colorMode: 'bw' };
  display_schedule?: DisplaySchedule | null;
};
export interface DisplayTemplate {
  format: 'esp32-eink-template';
  version: 1;
  settings: TemplateSettings;
}

export class TemplateValidationError extends Error {
  constructor(message: string) { super(message); this.name = 'TemplateValidationError'; }
}
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function exactKeys(value: Record<string, unknown>, allowed: readonly string[], name: string) {
  if (Object.keys(value).some((key) => !allowed.includes(key))) throw new TemplateValidationError(`${name} contains unsupported fields.`);
}
function check(condition: boolean, message: string): asserts condition {
  if (!condition) throw new TemplateValidationError(message);
}

/** Strict, bounded data format. No credentials, private URLs or account/device IDs. */
export function parseDisplayTemplate(input: unknown): DisplayTemplate {
  check(Buffer.byteLength(JSON.stringify(input) ?? '', 'utf8') <= TEMPLATE_MAX_BYTES, 'Templates must be at most 8 KiB.');
  check(record(input), 'A template must be a JSON object.');
  exactKeys(input, ['format', 'version', 'settings'], 'Template');
  check(input.format === 'esp32-eink-template', 'Unsupported template format.');
  check(input.version === 1, 'Unsupported template version; this app supports version 1.');
  check(record(input.settings), 'Template settings must be an object.');
  exactKeys(input.settings, TEMPLATE_SETTING_KEYS, 'Settings');
  check(Object.keys(input.settings).length > 0, 'A template must contain at least one setting.');
  const settings: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input.settings)) {
    if (key.startsWith('show_')) {
      check(typeof value === 'boolean', `${key} must be a boolean.`);
    } else if (key === 'energy_price_location') {
      check(value === 'DK1' || value === 'DK2', 'Electricity area must be DK1 or DK2.');
    } else if (key === 'weather_location') {
      check(typeof value === 'string' && value.length <= 64, 'Weather location must be latitude,longitude.');
      const parts = value.split(',');
      const coordinate = /^[-+]?(?:\d+(?:\.\d*)?|\.\d+)$/;
      check(parts.length === 2 && parts.every((part) => coordinate.test(part.trim()))
        && Math.abs(Number(parts[0])) <= 90 && Math.abs(Number(parts[1])) <= 180, 'Weather coordinates are outside valid latitude/longitude ranges.');
    } else if (key === 'news_language') {
      check(typeof value === 'string' && ['da', 'en', 'de', 'sv', 'no', 'fi'].includes(value), 'Unsupported news language.');
    } else if (key === 'refresh_interval_minutes') {
      check(typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 1440, 'Refresh interval must be 1–1440 whole minutes.');
    } else if (key === 'layout') {
      try { settings[key] = value === null ? null : parseDisplayLayout(value); } catch (error) {
        if (error instanceof LayoutValidationError) throw new TemplateValidationError(error.message);
        throw error;
      }
      continue;
    } else if (key === 'display_schedule') {
      try { settings[key] = value === null ? null : parseDisplaySchedule(value); } catch (error) {
        if (error instanceof ScheduleValidationError || error instanceof LayoutValidationError) throw new TemplateValidationError(error.message);
        throw error;
      }
      continue;
    } else if (key === 'monta_fields' || key === 'zaptec_fields') {
      const allowed = ['charger_status', 'active_session', key === 'monta_fields' ? 'today_stats' : 'installation_info'];
      check(Array.isArray(value) && value.length <= allowed.length
        && value.every((field) => typeof field === 'string' && allowed.includes(field))
        && new Set(value).size === value.length, `${key} must contain supported, unique fields.`);
    } else if (key === 'display_profile') {
      check(record(value), 'Display profile must be an object.');
      exactKeys(value, ['width', 'height', 'rotation', 'colorMode'], 'Display profile');
      check(typeof value.width === 'number' && Number.isInteger(value.width) && value.width >= 64 && value.width <= 1600
        && typeof value.height === 'number' && Number.isInteger(value.height) && value.height >= 64 && value.height <= 1600
        && value.width * value.height <= 1920000, 'Display dimensions must be 64–1600 pixels and at most 1,920,000 pixels total.');
      check([0, 90, 180, 270].includes(value.rotation as number), 'Display rotation must be 0, 90, 180 or 270.');
      check(value.colorMode === 'bw', 'Only monochrome display profiles are supported.');
    }
    settings[key] = value;
  }
  return { format: 'esp32-eink-template', version: 1, settings: settings as TemplateSettings };
}

/** Deliberately whitelist fields, even when the database row contains future secrets. */
export function exportDisplayTemplate(preferences: UserPreferences): DisplayTemplate {
  const row = preferences as unknown as Record<string, unknown>;
  const settings: Record<string, unknown> = {};
  for (const key of TEMPLATE_SETTING_KEYS) if (row[key] !== undefined) settings[key] = row[key];
  return parseDisplayTemplate({ format: 'esp32-eink-template', version: 1, settings });
}

export const STARTER_TEMPLATES = [
  { id: 'energy-focus', name: 'Electricity focus', template: parseDisplayTemplate({
    format: 'esp32-eink-template', version: 1, settings: { show_energy_price: true, layout: { version: 1, cols: 10, rows: 6, widgets: [
      { i: 'energy', x: 0, y: 0, w: 10, h: 5 }, { i: 'status', x: 0, y: 5, w: 10, h: 1, static: true },
    ] } },
  }) },
  { id: 'household', name: 'Household overview', template: parseDisplayTemplate({
    format: 'esp32-eink-template', version: 1, settings: { show_energy_price: true, show_weather: true, show_news: true, layout: { version: 1, cols: 10, rows: 6, widgets: [
      { i: 'energy', x: 0, y: 0, w: 10, h: 2 }, { i: 'weather', x: 0, y: 2, w: 10, h: 2 },
      { i: 'news', x: 0, y: 4, w: 10, h: 1 }, { i: 'status', x: 0, y: 5, w: 10, h: 1, static: true },
    ] } },
  }) },
];
