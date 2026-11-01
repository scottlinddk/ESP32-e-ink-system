import { describe, expect, it, vi } from 'vitest';
import { CalendarUnavailableError, fetchCalendar, parseCalendar } from '../services/calendar';
import { FeedStatusError, fetchPublicFeed } from '../utils/publicFeedFetch';

// Parser/error mapping tests bypass the download cache; its behavior has separate coverage.
vi.mock('../services/calendarFeed', () => ({ fetchCalendarFeed: async (url: string, signal?: AbortSignal) => (await fetchPublicFeed(url, signal)).text }));

vi.mock('../utils/publicFeedFetch', async (original) => ({ ...await original<typeof import('../utils/publicFeedFetch')>(), fetchPublicFeed: vi.fn() }));

const options = { timezone: 'Europe/Copenhagen', days: 7, limit: 10 };
const now = new Date('2026-03-27T12:00:00Z');
const event = (lines: string, uid = 'one') => `BEGIN:VEVENT\nUID:${uid}\nDTSTAMP:20260301T000000Z\n${lines}\nEND:VEVENT`;
const feed = (...events: string[]) => `BEGIN:VCALENDAR\nVERSION:2.0\nPRODID:-//Test//EN\n${events.join('\n')}\nEND:VCALENDAR`;
const parse = (text: string) => parseCalendar(text, options, now);

describe('bounded ICS agenda', () => {
  it('carries the description on one line, shortened, and leaves it out when empty', async () => {
    const long = 'x'.repeat(300);
    const result = await parse(feed(
      event('DTSTART:20260328T100000Z\nDTEND:20260328T110000Z\nSUMMARY:Run\nDESCRIPTION:Quick jog\\nto start\\, the day', 'one'),
      event(`DTSTART:20260328T120000Z\nDTEND:20260328T130000Z\nSUMMARY:Long\nDESCRIPTION:${long}`, 'two'),
      event('DTSTART:20260328T140000Z\nDTEND:20260328T150000Z\nSUMMARY:None', 'three'),
    ));
    expect(result.events[0].description).toBe('Quick jog to start, the day');
    expect(result.events[1].description).toHaveLength(200);
    expect(result.events[2]).not.toHaveProperty('description');
  });
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
  it.each([['20260115', '2026-01-14T12:00:00Z', '2026-01-15T08:00:00.000Z'],
    ['20260715', '2026-07-14T12:00:00Z', '2026-07-15T07:00:00.000Z']])('maps known Outlook Windows zones in %s', async (date, reference, expected) => {
    const text = feed(event(`DTSTART;TZID="Romance Standard Time":${date}T090000\nDTEND;TZID=Romance Standard Time:${date}T100000\nSUMMARY:Outlook`));
    const result = await parseCalendar(text, options, new Date(reference));
    expect(result.events[0]).toMatchObject({ start: expected, timeLabel: '09:00' });
  });
  it('keeps Outlook recurrence wall time and exclusions across spring DST', async () => {
    const result = await parse(feed(event('DTSTART;TZID=Romance Standard Time:20260328T090000\nDTEND;TZID=Romance Standard Time:20260328T100000\nRRULE:FREQ=DAILY;COUNT=4\nEXDATE;TZID="Romance Standard Time":20260330T090000\nSUMMARY:Outlook')));
    expect(result.events.map((e) => e.start)).toEqual(['2026-03-28T08:00:00.000Z', '2026-03-29T07:00:00.000Z', '2026-03-31T07:00:00.000Z']);
    expect(result.events.map((e) => e.timeLabel)).toEqual(['09:00', '09:00', '09:00']);
  });
  it('keeps Outlook recurrence wall time across autumn DST', async () => {
    const text = feed(event('DTSTART;TZID=Romance Standard Time:20261024T090000\nRRULE:FREQ=DAILY;COUNT=3\nSUMMARY:Outlook'));
    const result = await parseCalendar(text, options, new Date('2026-10-23T12:00:00Z'));
    expect(result.events.map((e) => e.start)).toEqual(['2026-10-24T07:00:00.000Z', '2026-10-25T08:00:00.000Z', '2026-10-26T08:00:00.000Z']);
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
    expect(result.events).toEqual([{ title: 'Trip', start: '2026-03-27', end: '2026-03-29', allDay: true, dateLabel: '27 Mar', timeLabel: 'All day',
      day: '2026-03-27', endDay: '2026-03-28', startMinute: null, endMinute: null }]);
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
    feed(event('DTSTART;TZID=Invented Standard Time:20260328T100000')),
    feed(event('DTSTART;TZID="tzone://Microsoft/Custom":20260328T100000')),
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

describe('one broken event in an otherwise valid feed', () => {
  const good = event('DTSTART:20260328T100000Z\nDTEND:20260328T110000Z\nSUMMARY:Good', 'good');
  const titles = async (text: string) => (await parse(text)).events.map((e) => e.title);
  // Long-lived Google feeds can hold one such legacy event; it must not blank the calendar.
  it.each([
    ['a garbled UNTIL', 'DTSTART:20230101T154000Z\nRRULE:FREQ=WEEKLY;UNTIL=230108T154000'],
    ['an invalid BYDAY', 'DTSTART:20230101T154000Z\nRRULE:FREQ=WEEKLY;BYDAY=XX'],
    ['INTERVAL=0', 'DTSTART:20230101T154000Z\nRRULE:FREQ=WEEKLY;INTERVAL=0'],
    ['an end before its start', 'DTSTART:20260328T150000Z\nDTEND:20260328T140000Z'],
    ['an unsupported RDATE', 'DTSTART:20260328T150000Z\nRDATE:20260330T100000Z'],
    ['an unknown timezone', 'DTSTART;TZID=Customized Time Zone:20260328T100000'],
    ['an invalid date', 'DTSTART:20260230T100000Z'],
  ])('leaves out an event with %s and keeps the rest', async (_name, lines) => {
    expect(await titles(feed(event(`${lines}\nSUMMARY:Bad`, 'bad'), good))).toEqual(['Good']);
    expect(await titles(feed(good, event(`${lines}\nSUMMARY:Bad`, 'bad')))).toEqual(['Good']);
  });
  it('keeps a valid recurring event with its overrides when another event breaks the parser', async () => {
    const master = event('DTSTART:20260327T100000Z\nDTEND:20260327T110000Z\nRRULE:FREQ=DAILY;COUNT=3\nSUMMARY:Daily', 'daily');
    const moved = event('RECURRENCE-ID:20260328T100000Z\nDTSTART:20260328T150000Z\nDTEND:20260328T160000Z\nSUMMARY:Moved', 'daily');
    const broken = event('DTSTART:20230101T154000Z\nRRULE:FREQ=WEEKLY;UNTIL=230108T154000\nSUMMARY:Bad', 'bad');
    const clean = await parse(feed(master, moved));
    expect(clean.events.map((e) => e.title)).toEqual(['Moved', 'Daily']);
    expect((await parse(feed(master, broken, moved))).events).toEqual(clean.events);
  });
  it('still reports why when every event is broken', async () => {
    vi.mocked(fetchPublicFeed).mockResolvedValue({ text: feed(event('DTSTART:20230101T154000Z\nRRULE:FREQ=WEEKLY;BYDAY=XX', 'bad')), url: 'https://x.example/a' });
    const error = await fetchCalendar('https://x.example/a', options).catch((e: unknown) => e) as CalendarUnavailableError;
    expect(error.reason).toBe('parse_error');
  });
});

describe('why a calendar is unavailable', () => {
  const reasonOf = async (text: string) => {
    vi.mocked(fetchPublicFeed).mockResolvedValue({ text, url: 'https://secret.example/token-123' });
    const error = await fetchCalendar('https://secret.example/token-123', options).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CalendarUnavailableError);
    return (error as CalendarUnavailableError).reason;
  };
  const start = 'DTSTART:20260328T100000Z\nDTEND:20260328T110000Z\nSUMMARY:x';
  it.each([
    ['too_many_events', feed(...Array.from({ length: 501 }, (_, i) => event(start, `u${i}`)))],
    ['unsupported_recurrence', feed(event(`${start}\nRDATE:20260401T100000Z`))],
    ['unknown_timezone', feed(event('DTSTART;TZID=Customized Time Zone:20260328T100000\nSUMMARY:x'))],
    ['event_missing_uid_or_start', feed('BEGIN:VEVENT\nDTSTART:20260328T100000Z\nEND:VEVENT')],
    ['malformed_line', feed(event(start, 'a'), '', event(start, 'b'))],
    ['not_an_ics_feed', '<html>Sign in</html>'],
  ])('reports %s', async (reason, text) => {
    expect(await reasonOf(text)).toBe(reason);
  });
  it('reports the HTTP status and never the feed URL', async () => {
    vi.mocked(fetchPublicFeed).mockRejectedValue(new FeedStatusError(404));
    const error = await fetchCalendar('https://secret.example/token-123', options).catch((e: unknown) => e) as CalendarUnavailableError;
    expect(error.reason).toBe('http_404');
    vi.mocked(fetchPublicFeed).mockRejectedValue(new Error('getaddrinfo ENOTFOUND secret.example'));
    const dns = await fetchCalendar('https://secret.example/token-123', options).catch((e: unknown) => e) as CalendarUnavailableError;
    expect(dns.reason).toBe('unknown');
    expect(`${dns.message} ${dns.reason}`).not.toContain('secret');
  });
});

describe('day range and event fields', () => {
  const range = { from: '2026-03-23', to: '2026-04-05' };
  const ranged = (text: string, extra: Partial<typeof options> & { range?: { from: string; to: string }; maxEvents?: number } = {}) => parseCalendar(text, { ...options, range, maxEvents: 50, ...extra }, now);

  it('describes the local day, last day and minutes of timed and all-day events', async () => {
    const result = await ranged(feed(
      event('DTSTART:20260328T223000Z\nDTEND:20260328T233000Z\nSUMMARY:Late'),
      event('DTSTART;VALUE=DATE:20260330\nDTEND;VALUE=DATE:20260402\nSUMMARY:Trip', 'trip'),
    ));
    // 22:30Z to 23:30Z is 23:30 to 00:30 in Copenhagen, so the event runs into the next day.
    expect(result.events.find((e) => e.title === 'Late')).toMatchObject({ day: '2026-03-28', startMinute: 23 * 60 + 30, endDay: '2026-03-29', endMinute: 30 });
    expect(result.events.find((e) => e.title === 'Trip')).toMatchObject({ allDay: true, day: '2026-03-30', endDay: '2026-04-01', startMinute: null, endMinute: null });
  });
  it('lets an event that ends at midnight belong to the day before', async () => {
    // 20:00Z to 23:00Z is 21:00 to 00:00 in Copenhagen: the end is exclusive.
    const result = await ranged(feed(event('DTSTART:20260328T200000Z\nDTEND:20260328T230000Z\nSUMMARY:Until midnight')));
    expect(result.events[0]).toMatchObject({ day: '2026-03-28', startMinute: 21 * 60, endDay: '2026-03-28', endMinute: 1440 });
  });
  it('spans midnight with the end on the next day', async () => {
    const result = await ranged(feed(event('DTSTART:20260328T210000Z\nDTEND:20260329T050000Z\nSUMMARY:Night')));
    expect(result.events[0]).toMatchObject({ day: '2026-03-28', startMinute: 22 * 60, endDay: '2026-03-29', endMinute: 7 * 60 });
  });
  it('keeps what ended earlier today and what lies before today inside the range', async () => {
    const result = await ranged(feed(
      event('DTSTART:20260327T070000Z\nDTEND:20260327T080000Z\nSUMMARY:Earlier today', 'a'),
      event('DTSTART:20260324T070000Z\nDTEND:20260324T080000Z\nSUMMARY:Last week', 'b'),
      event('DTSTART:20260322T070000Z\nDTEND:20260322T080000Z\nSUMMARY:Before the range', 'c'),
      event('DTSTART:20260406T070000Z\nDTEND:20260406T080000Z\nSUMMARY:After the range', 'd'),
    ));
    expect(result.events.map((e) => e.title)).toEqual(['Last week', 'Earlier today']);
  });
  it('includes an event that began before the range and is still on at its start', async () => {
    const result = await ranged(feed(event('DTSTART;VALUE=DATE:20260320\nDTEND;VALUE=DATE:20260325\nSUMMARY:Long trip')));
    expect(result.events[0]).toMatchObject({ day: '2026-03-20', endDay: '2026-03-24' });
  });
  it('expands recurrences across the range and honours exclusions', async () => {
    const result = await ranged(feed(event('DTSTART:20260320T090000Z\nDTEND:20260320T100000Z\nRRULE:FREQ=DAILY\nEXDATE:20260325T090000Z\nSUMMARY:Daily')));
    const days = result.events.map((e) => e.day);
    expect(days[0]).toBe('2026-03-23');
    expect(days).not.toContain('2026-03-25');
    expect(days[days.length - 1]).toBe('2026-04-05');
    expect(days).toHaveLength(13);
  });
  it('limits the count to maxEvents, keeping the earliest', async () => {
    const days = Array.from({ length: 5 }, (_, n) => event(`DTSTART:2026032${3 + n}T090000Z\nSUMMARY:Day ${n}`, `u${n}`));
    expect((await ranged(feed(...days), { maxEvents: 3 })).events.map((e) => e.title)).toEqual(['Day 0', 'Day 1', 'Day 2']);
  });
  it('reports today, the minute of the day and the configured horizon', async () => {
    const result = await ranged('BEGIN:VCALENDAR\nVERSION:2.0\nEND:VCALENDAR');
    expect(result).toMatchObject({ timezone: 'Europe/Copenhagen', today: '2026-03-27', nowMinute: 13 * 60, days: 7, limit: 10, events: [] });
  });
  it('keeps the upcoming-only behaviour without a range', async () => {
    const result = await parse(feed(event('DTSTART:20260327T090000Z\nDTEND:20260327T100000Z\nSUMMARY:Finished'), event('DTSTART:20260327T150000Z\nSUMMARY:Later', 'b')));
    expect(result.events.map((e) => e.title)).toEqual(['Later']);
    expect(result.events[0]).toMatchObject({ day: '2026-03-27', startMinute: 16 * 60 });
  });
  it.each([
    [{ range: { from: '2026-03-28', to: '2026-03-27' } }],
    [{ range: { from: '2026-02-30', to: '2026-03-27' } }],
    [{ range: { from: '2026-01-01', to: '2026-12-31' } }],
    [{ range: { from: 'x', to: 'y' } }],
    [{ maxEvents: 0 }],
    [{ maxEvents: 301 }],
    [{ maxEvents: 1.5 }],
  ])('rejects invalid options %j', async (extra) => {
    const valid = 'BEGIN:VCALENDAR\nVERSION:2.0\nEND:VCALENDAR';
    await expect(ranged(valid)).resolves.toBeDefined();
    await expect(ranged(valid, extra as never)).rejects.toThrow(/Calendar (range|event count)/);
  });
});

