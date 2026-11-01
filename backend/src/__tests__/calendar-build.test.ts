import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { build } from 'esbuild';
import { copyFile, cp, mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { Worker } from 'node:worker_threads';

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
      packages: 'external', external: ['./calendarWorker.bundle.cjs'], keepNames: true,
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

it('starts the deployed worker using only explicitly included assets', async () => {
  // Outside the checkout: missing worker dependencies cannot resolve from its node_modules.
  const directory = await mkdtemp(join(tmpdir(), 'calendar-deployment-'));
  let worker: Worker | undefined;
  try {
    const backend = resolve(__dirname, '../..');
    const config = JSON.parse(await readFile(resolve(backend, '../vercel.json'), 'utf8'));
    const includes: string = config.services.backend.functions['api/index.ts'].includeFiles;
    expect(includes).toBe('{src/services/calendarWorker.bundle.cjs}');
    for (const asset of includes.slice(1, -1).split(',')) {
      const relative = asset.replace(/\/\*\*$/, '');
      const source = resolve(backend, relative);
      // Mirror backend-relative assets and workspace-level node_modules in the function.
      const destination = resolve(directory, 'backend', relative);
      await mkdir(resolve(destination, '..'), { recursive: true });
      await cp(source, destination, { recursive: true });
    }
    worker = new Worker(join(directory, 'backend/src/services/calendarWorker.bundle.cjs'), {
      workerData: {
        text: 'BEGIN:VCALENDAR\nVERSION:2.0\nBEGIN:VEVENT\nUID:outlook\nDTSTART;TZID="Romance Standard Time":20260328T090000\nRRULE:FREQ=DAILY;COUNT=2\nSUMMARY:Planning\nEND:VEVENT\nEND:VCALENDAR',
        timezone: 'Europe/Copenhagen', days: 7, limit: 5, now: Date.parse('2026-03-27T12:00:00Z'),
      },
    });
    const message = await new Promise<any>((resolve, reject) => {
      worker!.once('message', resolve);
      worker!.once('error', reject);
      worker!.once('exit', (code) => reject(new Error(`Worker exited before replying (${code})`)));
    });
    expect(message.error).toBeUndefined();
    expect(message.result.events.map((event: { start: string }) => event.start)).toEqual([
      '2026-03-28T08:00:00.000Z', '2026-03-29T07:00:00.000Z',
    ]);
  } finally {
    await worker?.terminate();
    await rm(directory, { recursive: true, force: true });
  }
});

it('keeps the committed worker bundle in step with calendarWorker.cjs and node-ical', async () => {
  // @ts-expect-error: plain ESM build script without type declarations
  const { buildCalendarWorker, bundlePath } = await import('../../scripts/build-calendar-worker.mjs');
  const committed = await readFile(bundlePath, 'utf8');
  // Stale: run `npm run build:calendar-worker -w backend` and commit the result.
  expect(committed === await buildCalendarWorker()).toBe(true);
  // Only Node built-ins are loaded at run time.
  const modules = [...committed.matchAll(/require\("([^"]+)"\)/g)].map((match) => match[1]);
  expect(modules.filter((name) => !name.startsWith('node:'))).toEqual([]);
});
