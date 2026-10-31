import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { build } from 'esbuild';
import { copyFile, mkdir, mkdtemp, readdir, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';

describe('deployed calendar parser', () => {
  let directory: string;
  let parseCalendar: typeof import('../services/calendar').parseCalendar;

  beforeAll(async () => {
    // Keep node_modules resolvable, as it is in the deployed function.
    const root = resolve(__dirname, '../../.validation');
    await mkdir(root, { recursive: true });
    directory = await mkdtemp(join(root, 'calendar-build-'));
    const services = resolve(__dirname, '../services');
    // Worker entrypoints are deployment assets, independent of the application bundle.
    for (const file of await readdir(services)) {
      if (file.endsWith('.cjs')) await copyFile(join(services, file), join(directory, file));
    }
    const outfile = join(directory, 'calendar.cjs');
    await build({
      entryPoints: [join(services, 'calendar.ts')], outfile,
      bundle: true, platform: 'node', format: 'cjs', target: 'node22',
      packages: 'external', external: ['./calendarWorker.cjs'], keepNames: true,
    });
    ({ parseCalendar } = require(outfile));
  });
  afterAll(async () => { if (directory) await rm(directory, { recursive: true, force: true }); });

  it('parses a valid feed after bundling with function-name preservation', async () => {
    const result = await parseCalendar('BEGIN:VCALENDAR\nVERSION:2.0\nEND:VCALENDAR',
      { timezone: 'UTC', days: 7, limit: 5 }, new Date('2026-03-27T12:00:00Z'));
    expect(result).toMatchObject({ timezone: 'UTC', today: '2026-03-27', events: [] });
  });

  it('loads Outlook timezone mappings in the deployed worker', async () => {
    const text = 'BEGIN:VCALENDAR\nVERSION:2.0\nBEGIN:VEVENT\nUID:outlook\nDTSTART;TZID="Romance Standard Time":20260328T090000\nSUMMARY:Planning\nEND:VEVENT\nEND:VCALENDAR';
    const result = await parseCalendar(text, { timezone: 'Europe/Copenhagen', days: 7, limit: 5 }, new Date('2026-03-27T12:00:00Z'));
    expect(result.events[0]).toMatchObject({ title: 'Planning', start: '2026-03-28T08:00:00.000Z', timeLabel: '09:00' });
  });
});
