import { describe, expect, it, vi } from 'vitest';
import { fetchCalendar, parseCalendar } from '../services/calendar';
import { fetchPublicFeed } from '../utils/publicFeedFetch';

vi.mock('../utils/publicFeedFetch', async (original) => ({ ...await original<typeof import('../utils/publicFeedFetch')>(), fetchPublicFeed: vi.fn() }));

const options = { timezone: 'Europe/Copenhagen', days: 7, limit: 10 };
const now = new Date('2026-03-27T12:00:00Z');
const event = (lines: string, uid = 'one') => `BEGIN:VEVENT\nUID:${uid}\nDTSTAMP:20260301T000000Z\n${lines}\nEND:VEVENT`;
const feed = (...events: string[]) => `BEGIN:VCALENDAR\nVERSION:2.0\nPRODID:-//Test//EN\n${events.join('\n')}\nEND:VCALENDAR`;
const parse = (text: string) => parseCalendar(text, options, now);

describe('bounded ICS agenda', () => {
  it('converts UTC and floating times to the selected timezone, unfolds and unescapes text', async () => {
    const result = await parse(feed(event('DTSTART:20260328T100000Z\nDTEND:20260328T110000Z\nSUMMARY:Meet\\, Sam and\n  Alex'), event('DTSTART:20260328T140000\nSUMMARY:Floating', 'two')));
    expect(result.events).toHaveLength(2);
    expect(result.events[0]).toMatchObject({ title: 'Meet, Sam and Alex', start: '2026-03-28T10:00:00.000Z', timeLabel: '11:00', dateLabel: '28 Mar', allDay: false });
    expect(result.events[1]).toMatchObject({ start: '2026-03-28T13:00:00.000Z', timeLabel: '14:00' });
  });
  it('preserves local clock time across daylight saving and applies EXDATE', async () => {
    const result = await parse(feed(event('DTSTART;TZID=Europe/Copenhagen:20260328T090000\nDTEND;TZID=Europe/Copenhagen:20260328T100000\nRRULE:FREQ=DAILY;COUNT=4\nEXDATE;TZID=Europe/Copenhagen:20260330T090000\nSUMMARY:Standup')));
    expect(result.events.map((e) => e.start)).toEqual(['2026-03-28T08:00:00.000Z', '2026-03-29T07:00:00.000Z', '2026-03-31T07:00:00.000Z']);
    expect(result.events.map((e) => e.timeLabel)).toEqual(['09:00', '09:00', '09:00']);
  });
  it('suppresses cancelled occurrences, moves overrides, and finds overrides moved into the window', async () => {
    const result = await parse(feed(
      event('DTSTART:20260328T100000Z\nDTEND:20260328T110000Z\nRRULE:FREQ=DAILY;COUNT=30\nSUMMARY:Daily'),
      event('RECURRENCE-ID:20260329T100000Z\nDTSTART:20260329T100000Z\nSTATUS:CANCELLED'),
      event('RECURRENCE-ID:20260330T100000Z\nDTSTART:20260330T140000Z\nDTEND:20260330T150000Z\nSUMMARY:Moved'),
      event('RECURRENCE-ID:20260420T100000Z\nDTSTART:20260328T080000Z\nDTEND:20260328T090000Z\nSUMMARY:Moved in'),
    ));
    expect(result.events[0].title).toBe('Moved in');
    expect(result.events.some((e) => e.start === '2026-03-29T10:00:00.000Z')).toBe(false);
    expect(result.events.some((e) => e.start === '2026-03-30T10:00:00.000Z')).toBe(false);
    expect(result.events.filter((e) => e.title === 'Moved')).toHaveLength(1);
  });
  it('keeps all-day dates and exclusive end dates in any selected timezone', async () => {
    const text = feed(event('DTSTART;VALUE=DATE:20260327\nDTEND;VALUE=DATE:20260329\nSUMMARY:Trip'), event('DTSTART;VALUE=DATE:20260326\nDTEND;VALUE=DATE:20260327\nSUMMARY:Finished', 'past'));
    const result = await parseCalendar(text, { ...options, timezone: 'Pacific/Honolulu' }, now);
    expect(result.events).toEqual([{ title: 'Trip', start: '2026-03-27', end: '2026-03-29', allDay: true, dateLabel: '27 Mar', timeLabel: 'All day' }]);
  });
  it('includes ongoing events, excludes finished and cancelled masters, and limits sorted results', async () => {
    const result = await parseCalendar(feed(
      event('DTSTART:20260327T110000Z\nDTEND:20260327T130000Z\nSUMMARY:Ongoing'),
      event('DTSTART:20260327T090000Z\nDTEND:20260327T100000Z\nSUMMARY:Finished', 'finished'),
      event('DTSTART:20260328T090000Z\nSTATUS:CANCELLED\nSUMMARY:Cancelled', 'cancelled'),
      event('DTSTART:20260329T090000Z\nSUMMARY:Later', 'later'),
    ), { ...options, limit: 1 }, now);
    expect(result.events.map((e) => e.title)).toEqual(['Ongoing']);
  });
  it('distinguishes a valid empty calendar from errors', async () => {
    expect((await parse('BEGIN:VCALENDAR\nVERSION:2.0\nEND:VCALENDAR')).events).toEqual([]);
  });
  it('handles cancellation messages and cancelled overrides without a DTSTART', async () => {
    const cancellation = feed(event('DTSTART:20260328T100000Z\nSUMMARY:Cancelled')).replace('VERSION:2.0', 'VERSION:2.0\nMETHOD:CANCEL');
    expect((await parse(cancellation)).events).toEqual([]);
    const result = await parse(feed(event('DTSTART:20260328T100000Z\nRRULE:FREQ=DAILY;COUNT=2\nSUMMARY:Daily'), event('RECURRENCE-ID:20260329T100000Z\nSTATUS:CANCELLED')));
    expect(result.events).toHaveLength(1);
    expect(result.events[0].start).toBe('2026-03-28T10:00:00.000Z');
  });
  it.each([
    '<html>not a calendar</html>',
    'BEGIN:VCALENDAR\nVERSION:2.0\nBEGIN:VEVENT\nEND:VCALENDAR',
    feed(event('DTSTART:20260230T100000Z')),
    feed(event('DTSTART;TZID=Invented/Zone:20260328T100000')),
    feed(event('DTSTART:20260328T100000Z\nRRULE:FREQ=SECONDLY')),
    feed(event('DTSTART:20260328T100000Z\nRDATE:20260330T100000Z')),
    feed(event('DTSTART:20260328T100000Z\nRECURRENCE-ID;RANGE=THISANDFUTURE:20260328T100000Z')),
  ])('rejects malformed or unsupported feeds without reflecting private content', async (text) => {
    await expect(parse(text)).rejects.toThrow('Calendar feed is invalid or exceeds supported limits');
  });
  it('rejects oversized feeds and invalid settings', async () => {
    await expect(parse('x'.repeat(1024 * 1024 + 1))).rejects.toThrow('Invalid calendar feed');
    await expect(parseCalendar('', { ...options, limit: 20 })).rejects.toThrow('event limit');
    await expect(parseCalendar('', { ...options, days: 31 })).rejects.toThrow('days');
    await expect(parseCalendar('', { ...options, timezone: 'Nope' })).rejects.toThrow('timezone');
    await expect(parseCalendar('', { ...options, timezone: '+01:00' })).rejects.toThrow('timezone');
  });
  it('cancels parser work', async () => {
    const controller = new AbortController();
    const pending = parseCalendar(feed(event('DTSTART:20260328T100000Z')), options, now, controller.signal);
    controller.abort();
    await expect(pending).rejects.toThrow('cancelled');
  });
  it('bounds dense recurrence expansion instead of blocking the HTTP process', async () => {
    const dense = `DTSTART:20260327T000000Z\nRRULE:FREQ=DAILY;BYHOUR=${Array.from({ length: 24 }, (_, i) => i).join(',')};BYMINUTE=${Array.from({ length: 60 }, (_, i) => i).join(',')}`;
    await expect(parse(feed(event(dense)))).rejects.toThrow(/exceeds supported limits|parsing timed out|parsing failed/);
  });
  it('passes cancellation to safe fetching and never exposes a token in fetch errors', async () => {
    const signal = new AbortController().signal;
    vi.mocked(fetchPublicFeed).mockRejectedValue(new Error('https://secret.example/token-123'));
    await expect(fetchCalendar('https://secret.example/token-123', options, signal)).rejects.toThrow('Calendar unavailable');
    expect(fetchPublicFeed).toHaveBeenCalledWith('https://secret.example/token-123', signal);
  });
});
