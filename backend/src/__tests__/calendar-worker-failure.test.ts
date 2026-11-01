import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { parseCalendar } from '../services/calendar';
import { logger } from '../lib/logger';

// Hoisted above the imports by vitest. A worker that cannot load its dependencies, as when a deployment leaves a module out.
vi.mock('node:worker_threads', () => ({
  Worker: class extends EventEmitter {
    constructor() {
      super();
      queueMicrotask(() => {
        this.emit('error', Object.assign(new Error('Cannot find module /var/task/private/path'), { code: 'MODULE_NOT_FOUND' }));
        this.emit('exit', 1);
      });
    }
    async terminate() { return 1; }
  },
}));

describe('parser worker failures', () => {
  it('reports a worker that cannot start as worker_failed, logging only the error code', async () => {
    const log = vi.spyOn(logger, 'error').mockImplementation(() => undefined as never);
    const error = await parseCalendar('BEGIN:VCALENDAR\nVERSION:2.0\nEND:VCALENDAR', { timezone: 'UTC', days: 7, limit: 5 }).catch((e: unknown) => e);
    expect((error as { reason?: string }).reason).toBe('worker_failed');
    expect(log).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith({ code: 'MODULE_NOT_FOUND' }, 'Calendar parser worker failed');
    expect(JSON.stringify(log.mock.calls)).not.toContain('private');
  });
});
