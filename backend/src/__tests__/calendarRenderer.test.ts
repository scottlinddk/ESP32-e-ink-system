import { describe, expect, it } from 'vitest';
import type { CalendarData, CalendarEvent, WidgetOptions } from '../types';
import type { Bounds, DrawingCanvas } from '../utils/zoomCanvas';
import { renderCalendarWidget, type CalendarSource } from '../utils/calendarRenderer';
import { renderDisplayDataRaw } from '../utils/bmpGenerator';
import type { DisplayLanguage } from '../utils/displayLanguage';
import { allDayEvent, calendarData, timedEvent } from './calendarFixtures';

interface Text { text: string; x: number; y: number; black: boolean }
interface Fill { x: number; y: number; w: number; h: number; black: boolean }

/** Records what a view draws, without pixels, so a test can ask what is on the screen. */
function recorder(width = 250, height = 122) {
  const texts: Text[] = [];
  const fills: Fill[] = [];
  const canvas: DrawingCanvas = {
    width, height,
    setPixel() {},
    withClip(_bounds: Bounds, draw: () => void) { draw(); },
    drawHLine() {},
    fillRect(x, y, w, h, black = true) { fills.push({ x, y, w, h, black }); },
    drawText(text, x, y, _maxWidth, _scale, black = true) {
      // Bold text is the same string drawn a pixel apart; it counts once.
      const last = texts[texts.length - 1];
      if (last && last.text === text && last.y === y && x === last.x + 1 && last.black === black) return;
      texts.push({ text, x, y, black });
    },
    drawWrappedText(text, x, y, _w, lineH = 10) { texts.push({ text, x, y, black: true }); return y + lineH; },
  };
  return { canvas, texts, fills, strings: () => texts.map((entry) => entry.text) };
}

function draw(source: CalendarSource, options?: WidgetOptions, size: [number, number] = [250, 122], language: DisplayLanguage = 'en') {
  const out = recorder(...size);
  renderCalendarWidget(out.canvas, { x: 0, y: 0, width: size[0], height: size[1] }, source, options, language);
  return out;
}
const withData = (events: CalendarEvent[], overrides: Partial<CalendarData> = {}): CalendarSource => ({ data: calendarData(events, overrides) });
const tomorrow = '2026-10-16';
/** Under 70 pixels tall the list shows one row per event instead of cards. */
const ROWS: [number, number] = [250, 69];

describe('list view', () => {
  const events = [
    allDayEvent('Restaffald'),
    timedEvent('Earlier', 5 * 60, 6 * 60),
    timedEvent('D-draaber', 6 * 60, 9 * 60),
    timedEvent('Dinner', 18 * 60, 19 * 60),
    allDayEvent('Fase 5', tomorrow),
    timedEvent('Konsultation', 8 * 60, 8 * 60 + 30, tomorrow),
  ];

  it('groups events under a heading per day, all-day first, and hides what has ended', () => {
    const { strings } = draw(withData(events), { view: 'list' }, ROWS);
    expect(strings()).toEqual(['Today, Thu 15 Oct', '#', 'Restaffald', '06:00', 'D-draaber', '09:00', '18:00', 'Dinner', '19:00']);
    expect(strings()).not.toContain('05:00 Earlier');
  });
  it('is the default view', () => {
    expect(draw(withData(events)).strings()).toEqual(draw(withData(events), { view: 'list' }).strings());
  });
  it('draws day headings in bold', () => {
    const calls: string[] = [];
    const canvas = { ...recorder().canvas, drawText: (text: string, x: number) => { calls.push(`${text}@${x}`); } } as DrawingCanvas;
    renderCalendarWidget(canvas, { x: 0, y: 0, width: 250, height: 122 }, withData(events), { view: 'list' });
    expect(calls.slice(0, 2)).toEqual(['Today, Thu 15 Oct@2', 'Today, Thu 15 Oct@3']);
  });
  describe('cards', () => {
    const tall: [number, number] = [250, 200];
    it('show the title, then the time range, beside a bar', () => {
      const { strings, fills } = draw(withData(events), { view: 'list' }, tall);
      expect(strings()).toEqual(['Today, Thu 15 Oct', 'Restaffald', 'All day', 'D-draaber', '06:00 - 09:00', 'Dinner', '18:00 - 19:00',
        'Tomorrow, Fri 16 Oct', 'Fase 5', 'All day', 'Konsultation', '08:00 - 08:30']);
      expect(fills.filter((fill) => fill.black && fill.w === 2).length).toBe(5);
    });
    it('give a zero-length event just its start', () => {
      expect(draw(withData([timedEvent('Ping', 9 * 60, 9 * 60)]), { view: 'list' }, tall).strings()).toContain('09:00');
    });
    it('show an event that runs past midnight with the end on its own clock', () => {
      const night = { ...timedEvent('Night', 22 * 60, 7 * 60), endDay: tomorrow };
      expect(draw(withData([night]), { view: 'list' }, tall).strings()).toContain('22:00 - 07:00');
    });
    it('are used from 70 pixels of height, rows below', () => {
      expect(draw(withData(events), { view: 'list' }, [250, 70]).strings()).toContain('06:00 - 09:00');
      const rows = draw(withData(events), { view: 'list' }, [250, 69]).strings();
      expect(rows).toContain('06:00');
      expect(rows).not.toContain('06:00 - 09:00');
    });
    it('flow into columns on a wide widget, repeating the heading of a day that carries on', () => {
      const many = Array.from({ length: 8 }, (_, n) => timedEvent(`Event ${n}`, 9 * 60 + n * 30, 9 * 60 + n * 30 + 20));
      const { texts } = draw(withData(many, { limit: 10 }), { view: 'list' }, [520, 100]);
      const headings = texts.filter((entry) => entry.text === 'Today, Thu 15 Oct');
      expect(headings).toHaveLength(2);
      expect(headings[1].x).toBeGreaterThan(headings[0].x + 100);
      expect(texts.find((entry) => entry.text === 'Event 7')!.x).toBeGreaterThan(headings[1].x - 1);
    });
    it('stop when the last column is full', () => {
      const many = Array.from({ length: 8 }, (_, n) => timedEvent(`Event ${n}`, 9 * 60 + n * 30, 9 * 60 + n * 30 + 20));
      expect(draw(withData(many, { limit: 10 }), { view: 'list' }, [250, 100]).strings().join('|')).not.toContain('Event 7');
    });
  });
  it('stops at the chosen number of rows and at the configured limit', () => {
    expect(draw(withData(events), { view: 'list', items: 1 }, ROWS).strings()).toEqual(['Today, Thu 15 Oct', '#', 'Restaffald']);
    expect(draw(withData(events, { limit: 2 }), { view: 'list', items: 5 }, ROWS).strings()).toEqual(['Today, Thu 15 Oct', '#', 'Restaffald', '06:00', 'D-draaber', '09:00']);
  });
  it('shows only the configured number of days', () => {
    const later = [allDayEvent('Next week', '2026-10-21')];
    expect(draw(withData(later, { days: 7 }), { view: 'list' }, ROWS).strings()).toEqual(['Wed 21 Oct', '#', 'Next week']);
    expect(draw(withData(later, { days: 3 }), { view: 'list' }).strings()).toEqual(['No upcoming events']);
  });
  it('keeps an event that began earlier under today', () => {
    const { strings } = draw(withData([allDayEvent('Trip', '2026-10-13', '2026-10-16')]), { view: 'list' }, ROWS);
    expect(strings()).toEqual(['Today, Thu 15 Oct', '#', 'Trip']);
  });
  it('keeps a long title on one line between the start and end pills', () => {
    const title = 'A very long appointment title that will not fit on one line of the widget at all';
    expect(draw(withData([timedEvent(title, 10 * 60, 11 * 60)]), { view: 'list' }, ROWS).strings()).toEqual(['Today, Thu 15 Oct', '10:00', title, '11:00']);
  });
  it('leaves the end pill out of a narrow widget', () => {
    expect(draw(withData([timedEvent('Dinner', 18 * 60, 19 * 60)]), { view: 'list' }, [120, 69]).strings()).toEqual(['Today 15 Oct', '18:00', 'Dinner']);
  });
  it('shortens a heading that does not fit', () => {
    expect(draw(withData(events), { view: 'list' }, [120, 122]).strings()[0]).toBe('Today 15 Oct');
    expect(draw(withData(events), { view: 'list' }, [60, 122]).strings()[0]).toBe('Today');
  });
  it('drops the headings in one or two lines of height, as before', () => {
    expect(draw(withData([timedEvent('Dinner', 18 * 60, 19 * 60)]), { view: 'list' }, [250, 20]).strings()).toEqual(['15 Oct 18:00: Dinner']);
  });
  it('leaves out a heading that has no room for an event under it', () => {
    const { strings } = draw(withData(events), { view: 'list' }, [250, 40]);
    expect(strings()).toEqual(['Today, Thu 15 Oct', '#', 'Restaffald', '06:00', 'D-draaber', '09:00']);
    expect(draw(withData([allDayEvent('A'), allDayEvent('B', tomorrow)]), { view: 'list' }, [250, 30]).strings()).toEqual(['Today, Thu 15 Oct', '#', 'A']);
  });
  it('tells an empty calendar from an unavailable one', () => {
    expect(draw(withData([])).strings()).toEqual(['No upcoming events']);
    expect(draw({}).strings()).toEqual(['Calendar: unavailable']);
    expect(draw({ error: { code: 'not_configured', message: '' } }).strings()).toEqual(['Calendar: add URL']);
    expect(draw({ error: { code: 'timeout', message: '' } }).strings()).toEqual(['Calendar: timed out']);
  });
});

describe('day view', () => {
  const events = [
    allDayEvent('Restaffald'),
    timedEvent('D-draaber', 6 * 60, 9 * 60),
    timedEvent('Dinner', 18 * 60, 19 * 60),
    timedEvent('Konsultation', 7 * 60, 7 * 60 + 30),
  ];

  it('labels the hours from an hour before now', () => {
    const { strings } = draw(withData(events), { view: 'day' });
    expect(strings().filter((text) => /^\d\d$/.test(text))).toEqual(['05', '06', '07', '08', '09', '10', '11', '12']);
  });
  it('starts at midnight when the whole day fits', () => {
    const { strings } = draw(withData(events), { view: 'day' }, [250, 330]);
    const hours = strings().filter((text) => /^\d\d$/.test(text));
    expect(hours[0]).toBe('00');
    expect(hours).toHaveLength(24);
  });
  it('keeps the window inside the day late in the evening', () => {
    const { strings } = draw(withData(events, { nowMinute: 23 * 60 + 40 }), { view: 'day' });
    const hours = strings().filter((text) => /^\d\d$/.test(text));
    expect(hours[hours.length - 1]).toBe('23');
    expect(hours).toHaveLength(8);
  });
  it('shows the day, the all-day events and the timed events with their time', () => {
    const { strings } = draw(withData([events[0], events[1], events[2]]), { view: 'day' });
    expect(strings()).toContain('Thu 15 Oct');
    expect(strings()).toContain('Restaffald');
    expect(strings()).toContain('06:00 - 09:00');
    expect(strings()).toContain('D-draaber');
    expect(strings().join('|')).not.toContain('Dinner');
  });
  it('puts overlapping events side by side', () => {
    const { texts } = draw(withData(events), { view: 'day' });
    const long = texts.find((entry) => entry.text.includes('D-draaber'))!;
    const short = texts.find((entry) => entry.text.includes('Konsultation'))!;
    expect(short.x).toBeGreaterThan(long.x);
    expect(short.y).toBeGreaterThan(long.y);
  });
  it('lets later events share a lane when they would be too narrow', () => {
    const crowded = ['A', 'B', 'C', 'D', 'E', 'F'].map((title) => timedEvent(title, 6 * 60, 9 * 60));
    const { texts } = draw(withData(crowded), { view: 'day' }, [100, 122]);
    const blocks = texts.filter((entry) => /^06:00 [A-F]$/.test(entry.text));
    expect(blocks).toHaveLength(6);
    expect(new Set(blocks.map((entry) => entry.x)).size).toBe(1);
  });
  it('shows the part of an event that runs past midnight on the next day', () => {
    // Early morning: the window covers 05:00 to 12:00, so only the end of the night shows, on the next day.
    const night = { ...timedEvent('Night', 22 * 60, 7 * 60), endDay: tomorrow };
    const { texts } = draw(withData([night]), { view: 'days', days: 3 }, [400, 122]);
    const shown = texts.filter((entry) => entry.text.includes('Night'));
    expect(shown).toHaveLength(1);
    expect(shown[0].x).toBeGreaterThan(20 + 126);
    // Late evening: the window covers 16:00 to 24:00, so only its start shows, today.
    const evening = draw(withData([night], { nowMinute: 23 * 60 }), { view: 'days', days: 3 }, [400, 122]).texts.filter((entry) => entry.text.includes('Night'));
    expect(evening).toHaveLength(1);
    expect(evening[0].x).toBeLessThan(20 + 126);
  });
  it('marks the current time with a line and a marker in the gutter', () => {
    const { fills } = draw(withData([]), { view: 'day' });
    expect(fills.some((fill) => fill.h === 1 && fill.black && fill.w > 100)).toBe(true);
    expect(fills.some((fill) => fill.w === 3 && fill.h === 3 && fill.x < 20)).toBe(true);
  });
  it('gives way to the list when the widget is too small', () => {
    expect(draw(withData(events), { view: 'day' }, [250, 30]).strings()).not.toContain('05');
    expect(draw(withData(events), { view: 'day' }, [250, 30]).strings()[0]).toBe('Today, Thu 15 Oct');
    expect(draw(withData(events), { view: 'day' }, [50, 122]).strings()[0]).toBe('Today');
  });
  it('shows an empty day, and a calendar that is unavailable, without hours', () => {
    expect(draw(withData([]), { view: 'day' }).strings()).toContain('05');
    expect(draw({ error: { code: 'unavailable', message: '' } }, { view: 'day' }).strings()).toEqual(['Calendar: unavailable']);
  });
});

describe('days view', () => {
  const events = [
    timedEvent('Today A', 6 * 60, 7 * 60),
    timedEvent('Tomorrow A', 6 * 60, 7 * 60, tomorrow),
    timedEvent('Day three', 6 * 60, 7 * 60, '2026-10-17'),
    allDayEvent('Weekend', '2026-10-17', '2026-10-18'),
  ];
  const headings = (strings: string[]) => strings.filter((text) => /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun) \d+(\/\d+)?$/.test(text));

  it('fits as many days as the width allows, at least two', () => {
    expect(headings(draw(withData(events), { view: 'days' }).strings())).toEqual(['Thu 15/10', 'Fri 16/10']);
    expect(headings(draw(withData(events), { view: 'days' }, [400, 300]).strings())).toEqual(['Thu 15/10', 'Fri 16/10', 'Sat 17/10', 'Sun 18/10']);
    expect(headings(draw(withData(events), { view: 'days' }, [640, 300]).strings())).toHaveLength(7);
  });
  it('shows the chosen number of days', () => {
    expect(headings(draw(withData(events), { view: 'days', days: 3 }, [400, 122]).strings())).toEqual(['Thu 15/10', 'Fri 16/10', 'Sat 17/10']);
    expect(headings(draw(withData(events), { view: 'days', days: 7 }, [400, 122]).strings())).toHaveLength(7);
  });
  it('shows an event in the column of its day', () => {
    const { texts } = draw(withData(events), { view: 'days', days: 3 }, [400, 122]);
    const x = (needle: string) => texts.find((entry) => entry.text.includes(needle))!.x;
    expect(x('Today A')).toBeLessThan(x('Tomorrow A'));
    expect(x('Tomorrow A')).toBeLessThan(x('Day three'));
  });
  it('repeats a multi-day all-day event in every column it covers', () => {
    const { strings } = draw(withData(events), { view: 'days', days: 4 }, [400, 122]);
    expect(strings().filter((text) => text === 'Weekend')).toHaveLength(2);
  });
  it('summarises all-day events that do not fit the strip', () => {
    const many = ['A', 'B', 'C', 'D'].map((title) => allDayEvent(`Allday ${title}`));
    const { strings } = draw(withData(many), { view: 'days' });
    expect(strings()).toContain('Allday A');
    expect(strings()).toContain('+3 more');
    expect(strings()).not.toContain('Allday D');
  });
  it('gives way to the list when the columns would be too narrow', () => {
    expect(draw(withData(events), { view: 'days', days: 7 }, [100, 122]).strings()[0]).toBe('Today 15 Oct');
  });
});

describe('month view', () => {
  const events = [
    allDayEvent('A'), timedEvent('B', 9 * 60, 10 * 60), timedEvent('C', 11 * 60, 12 * 60), timedEvent('D', 13 * 60, 14 * 60),
    timedEvent('E', 9 * 60, 10 * 60, '2026-10-20'),
    allDayEvent('Trip', '2026-10-26', '2026-10-28'),
  ];
  const dots = (fills: Fill[]) => fills.filter((fill) => fill.black && fill.w === 3 && fill.h === 3);

  it('names the month and the weekdays, and numbers every day of it', () => {
    const { strings } = draw(withData(events), { view: 'month' });
    expect(strings()).toContain('October 2026');
    expect(strings().filter((text) => ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].includes(text))).toHaveLength(7);
    const numbers = strings().filter((text) => /^\d+$/.test(text)).map(Number);
    expect(numbers).toEqual(Array.from({ length: 31 }, (_, index) => index + 1));
  });
  it('lays out Monday first, with the first on a Thursday', () => {
    const { texts } = draw(withData(events), { view: 'month' });
    const x = (n: number) => texts.find((entry) => entry.text === String(n))!.x;
    expect(x(1)).toBeGreaterThan(x(12));
    expect(x(5)).toBe(x(12));
    expect(texts.find((entry) => entry.text === '1')!.y).toBeLessThan(texts.find((entry) => entry.text === '5')!.y);
  });
  it('highlights today in white on black', () => {
    const { texts, fills } = draw(withData(events), { view: 'month' });
    expect(texts.find((entry) => entry.text === '15')).toMatchObject({ black: false });
    expect(texts.filter((entry) => !entry.black && /^\d+$/.test(entry.text))).toHaveLength(1);
    expect(fills.some((fill) => fill.black && fill.w === 18 && fill.h === 9)).toBe(true);
  });
  it('draws one dot per event, at most three, and one for each day of a multi-day event', () => {
    // 15 Oct has four events (three dots), 20 Oct one, and the trip covers 26, 27 and 28 Oct.
    expect(dots(draw(withData(events), { view: 'month' }).fills)).toHaveLength(3 + 1 + 3);
  });
  it('puts the dots beside the number when the cells are short', () => {
    const { fills } = draw(withData(events), { view: 'month' }, [250, 80]);
    expect(dots(fills)).toHaveLength(0);
    expect(fills.filter((fill) => fill.black && fill.w === 2 && fill.h === 3).length).toBeGreaterThan(0);
  });
  it('drops the title, then the weekdays, as the widget gets shorter', () => {
    const tall = draw(withData(events), { view: 'month' }, [250, 90]).strings();
    expect(tall).toContain('October 2026');
    const short = draw(withData(events), { view: 'month' }, [250, 65]).strings();
    expect(short).not.toContain('October 2026');
    expect(short).toContain('Mon');
    const flat = draw(withData(events), { view: 'month' }, [250, 55]).strings();
    expect(flat).not.toContain('Mon');
    expect(flat).toContain('31');
  });
  it('uses the whole week count of the month', () => {
    const february = draw(withData([], { today: '2027-02-10' }), { view: 'month' }).strings();
    expect(february).toContain('February 2027');
    expect(february.filter((text) => /^\d+$/.test(text))).toHaveLength(28);
  });
  it('uses single letters for the weekdays in narrow cells', () => {
    const strings = draw(withData(events), { view: 'month' }, [130, 122]).strings();
    expect(strings.filter((text) => text.length === 1 && /[MTWFS]/.test(text))).toHaveLength(7);
  });
  it('gives way to the list when the widget is too small', () => {
    expect(draw(withData(events), { view: 'month' }, [250, 40]).strings()[0]).toBe('Today, Thu 15 Oct');
    expect(draw(withData(events), { view: 'month' }, [100, 122]).strings()[0]).toBe('Today 15 Oct');
  });
});

describe('drawing on the display', () => {
  // The widget fills the left half of a 250 x 122 panel; the right half must stay blank.
  const events = [
    allDayEvent('Restaffald'), timedEvent('D-draaber with a very long title that must be cut off', 6 * 60, 9 * 60),
    timedEvent('Konsultation', 7 * 60, 8 * 60), timedEvent('Dinner', 18 * 60, 19 * 60, tomorrow),
  ];
  const render = (layoutWidget: object, data?: CalendarData) => renderDisplayDataRaw(
    { nextRefresh: 1000, ...(data ? { calendar: data } : {}) },
    { version: 1, cols: 10, rows: 6, widgets: [{ i: 'calendar', x: 0, y: 0, w: 5, h: 6, ...layoutWidget }] } as never);
  const rightHalf = (raw: Buffer) => Array.from({ length: 122 }, (_, row) => raw.subarray(row * 32 + 16, row * 32 + 32).toString('hex')).join('');

  it.each(['list', 'day', 'days', 'month'])('stays inside its widget in the %s view', (view) => {
    const blank = render({}, undefined);
    const drawn = render({ options: { view } }, calendarData(events));
    expect(drawn).not.toEqual(blank);
    expect(rightHalf(drawn)).toEqual(rightHalf(blank));
  });
  it.each(['list', 'day', 'days', 'month'])('renders the %s view at every zoom', (view) => {
    const blank = render({}, undefined).toString('hex');
    for (const zoom of [1, 2, 3, 4]) {
      expect(render({ options: { view, zoom } }, calendarData(events)).toString('hex')).not.toEqual(blank);
    }
  });
  it('draws each view differently', () => {
    const views = ['list', 'day', 'days', 'month'].map((view) => render({ options: { view } }, calendarData(events)).toString('hex'));
    expect(new Set(views).size).toBe(4);
  });
  it('draws at the edges of any layout without failing', () => {
    for (const view of ['list', 'day', 'days', 'month']) {
      for (const [w, h] of [[1, 1], [10, 1], [1, 6], [2, 2], [10, 6]]) {
        expect(() => render({ w, h, options: { view } }, calendarData(events))).not.toThrow();
      }
    }
  });
});

describe('robustness', () => {
  it('copes with an event that has no end on its day', () => {
    const odd: CalendarEvent = { ...timedEvent('Odd', 600, 600), endMinute: 600 };
    expect(() => draw(withData([odd]), { view: 'day' })).not.toThrow();
    expect(draw(withData([odd]), { view: 'day' }).strings()).toContain('10:00 Odd');
  });
  it('draws a zero-length event as a block of a text line', () => {
    const { fills } = draw(withData([timedEvent('Ping', 9 * 60, 9 * 60)]), { view: 'day' });
    expect(fills.some((fill) => fill.black && fill.w === 2 && fill.h >= 8)).toBe(true);
  });
  it('shows the first of several overlapping events at their own start', () => {
    const { texts } = draw(withData([timedEvent('First', 6 * 60, 8 * 60), timedEvent('Second', 7 * 60, 9 * 60), timedEvent('Third', 8 * 60, 10 * 60)]), { view: 'day' });
    const y = (needle: string) => texts.find((entry) => entry.text.includes(needle))!.y;
    expect(y('Second')).toBeGreaterThan(y('First'));
    expect(y('Third')).toBeGreaterThan(y('Second'));
  });
  it('ignores events from a different day than the ones it shows', () => {
    expect(draw(withData([timedEvent('Far away', 9 * 60, 10 * 60, '2026-11-20')]), { view: 'days', days: 3 }, [400, 122]).strings().join('|')).not.toContain('Far away');
  });
});

describe('look of the grids', () => {
  const events = [timedEvent('Planning', 9 * 60, 11 * 60), allDayEvent('Offsite', '2026-10-17')];
  /** Records pixels too, so shading can be counted. */
  function pixels(width: number, height: number, options: WidgetOptions) {
    const set = new Set<string>();
    const out = recorder(width, height);
    out.canvas.setPixel = (px, py, black) => { if (black) set.add(`${px},${py}`); };
    renderCalendarWidget(out.canvas, { x: 0, y: 0, width, height }, withData(events, { nowMinute: 8 * 60 }), options);
    return { ...out, set };
  }

  it('shades the weekend columns of the days view and not the weekdays beside them', () => {
    const days = pixels(400, 200, { view: 'days', days: 4 });
    const columnWidth = Math.floor((400 - 20 - 1) / 4);
    const inColumn = (index: number) => [...days.set].filter((key) => { const px = Number(key.split(',')[0]); const py = Number(key.split(',')[1]); const left = 20 + index * columnWidth; return px > left + 1 && px < left + columnWidth - 1 && py > 60 && py % 12 !== 0 && py % 4 === 0 && px % 4 === 0; }).length;
    expect(inColumn(2)).toBeGreaterThan(50);
    expect(inColumn(1)).toBeLessThan(10);
    expect(inColumn(3)).toBeGreaterThan(50);
  });
  it('draws a block as a shaded patch with the time range and title on clean plates', () => {
    const { texts, fills } = pixels(250, 122, { view: 'day' });
    expect(texts.map((entry) => entry.text)).toContain('09:00 - 11:00');
    const range = texts.find((entry) => entry.text === '09:00 - 11:00')!;
    expect(fills.some((fill) => !fill.black && fill.x === range.x - 1 && fill.y === range.y - 1)).toBe(true);
  });
  it('lists the events inside the cells of a large month, with an overflow count', () => {
    const many = Array.from({ length: 6 }, (_, n) => timedEvent(`Item ${n}`, 8 * 60 + n * 60, 8 * 60 + n * 60 + 30));
    const { strings } = draw(withData(many), { view: 'month' }, [700, 300]);
    expect(strings()).toContain('Item 0');
    expect(strings().some((text) => /^\+\d+ more$/.test(text))).toBe(true);
    expect(strings()).not.toContain('Item 5');
  });
  it('lists events in the cells but keeps dots in small ones', () => {
    expect(draw(withData(events), { view: 'month' }, [700, 300]).strings()).toContain('Planning');
    expect(draw(withData(events), { view: 'month' }, [250, 122]).strings()).not.toContain('Planning');
  });
  it('right-aligns the day numbers of a listed month and numbers the days around it', () => {
    const { texts } = draw(withData(events), { view: 'month' }, [700, 300]);
    const one = texts.find((entry) => entry.text === '1' && entry.y > 30)!;
    const twentyFour = texts.find((entry) => entry.text === '24')!;
    expect(one.x + 8).toBeGreaterThan(twentyFour.x - 100);
    expect(texts.filter((entry) => entry.text === '28')).toHaveLength(2);
  });
});

describe('month spans', () => {
  const trip = allDayEvent('Michael OOO', '2026-10-20', '2026-10-23');
  it('draws a multi-day all-day event once across its cells, not in each', () => {
    const { strings } = draw(withData([trip]), { view: 'month' }, [700, 300]);
    expect(strings().filter((text) => text === 'Michael OOO')).toHaveLength(1);
  });
  it('draws it again where it carries into the next week, and keeps the cells below clear of it', () => {
    const across = allDayEvent('Michael OOO', '2026-10-22', '2026-10-27');
    const { strings } = draw(withData([across, timedEvent('Lunch', 12 * 60, 13 * 60, '2026-10-23')]), { view: 'month' }, [700, 300]);
    expect(strings().filter((text) => text === 'Michael OOO')).toHaveLength(2);
    expect(strings()).toContain('Lunch');
  });
  it('shows the span as dots in a small month, like any event', () => {
    const { strings, fills } = draw(withData([trip]), { view: 'month' }, [250, 122]);
    expect(strings()).not.toContain('Michael OOO');
    expect(fills.filter((fill) => fill.black && fill.w === 3 && fill.h === 3)).toHaveLength(4);
  });
});

describe('display language', () => {
  const events = [timedEvent('Møde', 9 * 60, 10 * 60), allDayEvent('Ferie', '2026-10-16')];
  const da = (options: WidgetOptions, size?: [number, number]) => draw(withData(events), options, size, 'da').strings();

  it('translates the list headings and the all-day word', () => {
    expect(da({ view: 'list' }, [250, 200])).toEqual(['I dag, tors. 15. okt.', 'Møde', '09:00 - 10:00', 'I morgen, fre. 16. okt.', 'Ferie', 'Hele dagen']);
  });
  it('translates the month title, the weekdays and the overflow', () => {
    const month = da({ view: 'month' });
    expect(month).toContain('oktober 2026');
    expect(month).toContain('man.');
    expect(month).toContain('søn.');
    const many = Array.from({ length: 6 }, (_, n) => timedEvent(`Punkt ${n}`, 8 * 60 + n * 60, 8 * 60 + n * 60 + 30));
    expect(draw(withData(many), { view: 'month' }, [700, 300], 'da').strings().some((text) => /^\+\d+ mere$/.test(text))).toBe(true);
  });
  it('translates the grid headings and the strip overflow', () => {
    expect(draw(withData(events), { view: 'days', days: 2 }, [400, 122], 'da').strings()).toContain('tors. 15/10');
    const strip = ['A', 'B', 'C', 'D'].map((title) => allDayEvent(`Heldag ${title}`));
    expect(draw(withData(strip), { view: 'days' }, [250, 122], 'da').strings()).toContain('+3 mere');
  });
  it('translates the empty and failed states', () => {
    expect(draw(withData([]), undefined, undefined, 'da').strings()).toEqual(['Ingen kommende aftaler']);
    expect(draw({ error: { code: 'not_configured', message: '' } }, undefined, undefined, 'da').strings()).toEqual(['Kalender: tilføj adresse']);
    expect(draw({ error: { code: 'timeout', message: '' } }, undefined, undefined, 'da').strings()).toEqual(['Kalender: timeout']);
  });
  it('is English without a language', () => {
    expect(draw(withData(events), { view: 'list' }, [250, 200]).strings()).toEqual(draw(withData(events), { view: 'list' }, [250, 200], 'en').strings());
  });
});

describe('calendar options', () => {
  const described = { ...timedEvent('Morning Run', 6 * 60 + 30, 7 * 60 + 15), description: 'Quick jog to start the day' };
  const afternoon = timedEvent('Deep Work', 14 * 60, 16 * 60);
  const CARDS: [number, number] = [250, 122];

  it('draws descriptions under the title only when asked', () => {
    expect(draw(withData([described]), { view: 'list' }, CARDS).strings()).not.toContain('Quick jog to start the day');
    const { strings } = draw(withData([described]), { view: 'list', descriptions: true }, CARDS);
    expect(strings()).toEqual(['Today, Thu 15 Oct', 'Morning Run', 'Quick jog to start the day', '06:30 - 07:15']);
  });
  it('draws the time of a card in a black pill', () => {
    const plain = draw(withData([described]), { view: 'list' }, CARDS);
    const pilled = draw(withData([described]), { view: 'list', pills: true }, CARDS);
    expect(pilled.texts.find((entry) => entry.text === '06:30 - 07:15')).toMatchObject({ black: false });
    expect(plain.texts.find((entry) => entry.text === '06:30 - 07:15')).toMatchObject({ black: true });
  });
  it('writes times on the 12-hour clock', () => {
    const cards = draw(withData([described, afternoon]), { view: 'list', clock12: true }, CARDS).strings();
    expect(cards).toContain('6:30 AM - 7:15 AM');
    expect(cards).toContain('2:00 PM - 4:00 PM');
    const rows = draw(withData([described, afternoon]), { view: 'list', clock12: true }, ROWS).strings();
    expect(rows).toContain('6:30a');
    expect(rows).toContain('7:15a');
    const blocks = draw(withData([afternoon]), { view: 'day', clock12: true }, [250, 300]).strings();
    expect(blocks).toContain('2:00 PM - 4:00 PM');
  });
  it('keeps the 24-hour clock by default', () => {
    expect(draw(withData([afternoon]), { view: 'day' }, [250, 300]).strings()).toContain('14:00 - 16:00');
  });
  it('shows a start time under each event in a roomy month cell', () => {
    const month = draw(withData([afternoon]), { view: 'month' }, [400, 300]).strings();
    expect(month).toContain('Deep Work');
    expect(month).toContain('14:00');
    expect(draw(withData([afternoon]), { view: 'month', clock12: true }, [400, 300]).strings()).toContain('2:00p');
  });
  it('draws a footer with the title and the calendar name', () => {
    const named = withData([afternoon], { name: 'Fastmail Personal' });
    const { strings } = draw(named, { view: 'list', footer: true }, [400, 300]);
    expect(strings()).toContain('Upcoming Events');
    expect(strings()).toContain('Fastmail Personal');
    expect(draw(named, { view: 'list' }, [400, 300]).strings()).not.toContain('Upcoming Events');
    expect(draw(named, { view: 'list', footer: true }, [400, 300], 'da').strings()).toContain('Kommende aftaler');
  });
  it('leaves the footer out of a widget too short for it', () => {
    expect(draw(withData([afternoon], { name: 'Work' }), { view: 'list', footer: true }, [250, 40]).strings()).not.toContain('Upcoming Events');
  });
  it('keeps every view above the footer', () => {
    for (const view of ['list', 'day', 'days', 'month'] as const) {
      const { texts, fills } = draw(withData([afternoon], { name: 'Work' }), { view, footer: true }, [400, 300]);
      const footerTop = 300 - 16;
      expect(texts.filter((entry) => entry.y >= footerTop && entry.text !== 'Upcoming Events' && entry.text !== 'Work'), view).toEqual([]);
      void fills;
    }
  });
});
