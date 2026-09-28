import type { DisplaySchedule } from '../types';
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

export function parseDisplaySchedule(input: unknown): DisplaySchedule {
  object(input, ['enabled', 'timezone', 'pages', 'quiet_hours'], 'Display schedule');
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
  const time = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
  assert(typeof quiet.start === 'string' && time.test(quiet.start) && typeof quiet.end === 'string' && time.test(quiet.end), 'Quiet hours must use valid HH:MM times.');
  assert(!quiet.enabled || quiet.start !== quiet.end, 'Quiet hours start and end must differ.');
  return { enabled: input.enabled, timezone: input.timezone, pages, quiet_hours: { enabled: quiet.enabled, start: quiet.start, end: quiet.end } };
}
