import type { DisplaySchedule, TimedLayout } from '../types';
import { parseDisplayLayout } from './layoutValidation';

export type { DisplaySchedule } from '../types';
export class ScheduleValidationError extends Error {
  constructor(message: string) { super(message); this.name = 'ScheduleValidationError'; }
}
function object(value: unknown, allowed: string[], name: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).some((key) => !allowed.includes(key))) throw new ScheduleValidationError(`${name} has an invalid shape or unsupported fields.`);
}
function assert(value: boolean, message: string): asserts value {
  if (!value) throw new ScheduleValidationError(message);
}

const TIME = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
export const MAX_TIMED_LAYOUTS = 24;
export const MIN_TIMED_SECONDS = 10;
export const MAX_TIMED_SECONDS = 86399;

function parseTimedLayouts(value: unknown, pageIds: Set<string>): TimedLayout[] {
  assert(Array.isArray(value) && value.length <= MAX_TIMED_LAYOUTS, `A schedule supports at most ${MAX_TIMED_LAYOUTS} timed layouts.`);
  const ids = new Set<string>();
  return value.map((rule) => {
    object(rule, ['id', 'layout_id', 'start', 'duration_seconds'], 'Timed layout');
    assert(typeof rule.id === 'string' && /^[a-zA-Z0-9_-]{1,48}$/.test(rule.id) && !ids.has(rule.id), 'Timed layout IDs must be unique and contain 1–48 letters, digits, underscores or hyphens.');
    assert(typeof rule.layout_id === 'string' && pageIds.has(rule.layout_id), 'A timed layout must show one of the saved layouts.');
    assert(typeof rule.start === 'string' && TIME.test(rule.start), 'A timed layout needs a valid HH:MM start time.');
    assert(typeof rule.duration_seconds === 'number' && Number.isInteger(rule.duration_seconds)
      && rule.duration_seconds >= MIN_TIMED_SECONDS && rule.duration_seconds <= MAX_TIMED_SECONDS,
    `A timed layout lasts ${MIN_TIMED_SECONDS}–${MAX_TIMED_SECONDS} whole seconds.`);
    ids.add(rule.id);
    return { id: rule.id, layout_id: rule.layout_id, start: rule.start, duration_seconds: rule.duration_seconds };
  });
}

export function parseDisplaySchedule(input: unknown): DisplaySchedule {
  object(input, ['enabled', 'timezone', 'pages', 'quiet_hours', 'timed_layouts'], 'Display schedule');
  assert(typeof input.enabled === 'boolean', 'Schedule enabled must be a boolean.');
  assert(typeof input.timezone === 'string' && input.timezone.length <= 64 && /^[A-Za-z_]+(?:\/[A-Za-z0-9_+\-]+)*$/.test(input.timezone), 'Choose a valid IANA time zone.');
  try { new Intl.DateTimeFormat('en', { timeZone: input.timezone }); }
  catch { throw new ScheduleValidationError('Choose a valid IANA time zone.'); }
  assert(Array.isArray(input.pages) && input.pages.length <= 12, 'A schedule supports at most 12 pages.');
  assert(!input.enabled || input.pages.length > 0, 'An enabled schedule needs at least one page.');
  const ids = new Set<string>();
  const pages = input.pages.map((page) => {
    object(page, ['id', 'name', 'duration_seconds', 'layout'], 'Scheduled page');
    assert(typeof page.id === 'string' && /^[a-zA-Z0-9_-]{1,48}$/.test(page.id) && !ids.has(page.id), 'Page IDs must be unique and contain 1–48 letters, digits, underscores or hyphens.');
    assert(typeof page.name === 'string' && page.name.trim().length >= 1 && page.name.length <= 80, 'Page names must contain 1–80 characters.');
    assert(typeof page.duration_seconds === 'number' && Number.isInteger(page.duration_seconds)
      && page.duration_seconds >= 60 && page.duration_seconds <= 86400, 'Page duration must be 60–86400 whole seconds.');
    ids.add(page.id);
    return { id: page.id, name: page.name, duration_seconds: page.duration_seconds, layout: parseDisplayLayout(page.layout) };
  });
  object(input.quiet_hours, ['enabled', 'start', 'end'], 'Quiet hours');
  const quiet = input.quiet_hours;
  assert(typeof quiet.enabled === 'boolean', 'Quiet hours enabled must be a boolean.');
  assert(typeof quiet.start === 'string' && TIME.test(quiet.start) && typeof quiet.end === 'string' && TIME.test(quiet.end), 'Quiet hours must use valid HH:MM times.');
  assert(!quiet.enabled || quiet.start !== quiet.end, 'Quiet hours start and end must differ.');
  const timed = input.timed_layouts === undefined ? [] : parseTimedLayouts(input.timed_layouts, ids);
  return {
    enabled: input.enabled, timezone: input.timezone, pages, quiet_hours: { enabled: quiet.enabled, start: quiet.start, end: quiet.end },
    ...(timed.length ? { timed_layouts: timed } : {}),
  };
}
