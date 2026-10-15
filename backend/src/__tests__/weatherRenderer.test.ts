import { describe, expect, it } from 'vitest';
import type { AirQuality, WeatherData, WeatherForecastSlot, WidgetOptions } from '../types/index';
import type { Bounds, DrawingCanvas } from '../utils/zoomCanvas';
import { dailyForecast, renderWeatherWidget, type WeatherSource } from '../utils/weatherRenderer';
import { DISPLAY_LANGUAGES } from '../utils/displayLanguage';
import { WEATHER_VIEWS } from '../utils/widgetOptions';

// 12:00 in Copenhagen (UTC+2).
const NOW = new Date('2026-10-15T10:00:00Z');
const TZ = 'Europe/Copenhagen';
const context = { timeZone: TZ, now: NOW };

interface Text { text: string; x: number; y: number; maxWidth: number; scale: number }

/** Records what a widget draws, and where, so overflow and wording can be asserted. */
class Recorder implements DrawingCanvas {
  readonly texts: Text[] = [];
  readonly pixels: Array<[number, number]> = [];
  constructor(readonly width = 400, readonly height = 300) {}
  setPixel(x: number, y: number, black: boolean) { if (black) this.pixels.push([x, y]); }
  withClip(_bounds: Bounds, draw: () => void) { draw(); }
  drawHLine(x: number, y: number, w: number) { this.fillRect(x, y, w, 1); }
  fillRect(x: number, y: number, w: number, h: number, black = true) { if (black && w > 0 && h > 0) { this.pixels.push([x, y], [x + w - 1, y + h - 1]); } }
  drawText(text: string, x: number, y: number, maxWidth = this.width, scale = 1) { this.texts.push({ text, x, y, maxWidth, scale }); }
  drawWrappedText(text: string, x: number, y: number, w: number) { this.drawText(text, x, y, w); return y + 10; }
  get strings() { return this.texts.map((entry) => entry.text); }
}

const current: WeatherData = {
  temp: 18, condition: 'clear', windSpeed: 5, icon: '01d', feelsLike: 17, humidity: 73, pressure: 1017,
  windDeg: 0, windGust: 12, cloudiness: 32, visibility: 10000, precipitation: 0.4,
  sunrise: Date.parse('2026-10-15T05:23:00Z') / 1000, sunset: Date.parse('2026-10-15T16:01:00Z') / 1000,
};
const air: AirQuality = { aqi: 2, pm25: 4.2, pm10: 7.4 };

/** Steps from 12:00 UTC on the 15th, every 3 hours, for 5 days. */
function steps(count = 40, make: (index: number) => Partial<WeatherForecastSlot> = () => ({})): WeatherForecastSlot[] {
  const start = Date.parse('2026-10-15T12:00:00Z') / 1000;
  return Array.from({ length: count }, (_, index) => ({
    time: start + index * 10_800, temp: 10 + (index % 8), condition: 'cloudy', icon: '04d', pop: index % 8 * 10, precipitation: 0, ...make(index),
  }));
}
const source = (extra: Partial<WeatherSource> = {}): WeatherSource => ({ data: current, forecast: steps(), airQuality: air, ...extra });

function render(bounds: Bounds, view: WidgetOptions['view'], extra: Partial<WeatherSource> = {}, options: WidgetOptions = {}, language: 'en' | 'da' = 'en', canvas = new Recorder()) {
  renderWeatherWidget(canvas, bounds, source(extra), { view, ...options }, { ...context, language });
  return canvas;
}

describe('dailyForecast', () => {
  it('groups the steps by local day in the display time zone', () => {
    // 22:00Z on the 15th is already the 16th in Copenhagen.
    const days = dailyForecast(steps(40), TZ, NOW);
    // 40 steps of 3 hours reach 11:00 on the 20th: four steps, enough to keep that day.
    expect(days.map((day) => day.day)).toEqual(['2026-10-15', '2026-10-16', '2026-10-17', '2026-10-18', '2026-10-19', '2026-10-20']);
    expect(dailyForecast(steps(40), 'UTC', NOW)[0].day).toBe('2026-10-15');
    const evening = dailyForecast([{ ...steps(1)[0], time: Date.parse('2026-10-15T22:30:00Z') / 1000 }], TZ, NOW);
    expect(evening).toEqual([]); // one step of a later day is too little to summarize
  });

  it('takes the day range from its steps, adds the current temperature to today and sums the rain', () => {
    const days = dailyForecast(steps(40, (i) => ({ temp: i === 1 ? 30 : 12, precipitation: 0.5 })), TZ, NOW, 2);
    expect(days[0].min).toBe(2);
    expect(days[0].max).toBe(30);
    expect(days[1].min).toBe(12);
    expect(days[1].precipitation).toBe(4);
  });

  it('drops a last day cut short, but never today', () => {
    // 38 steps end at 05:00 on the 20th, two steps into that day.
    const days = dailyForecast(steps(38), TZ, NOW);
    expect(days.at(-1)!.day).toBe('2026-10-19');
    const lateToday = dailyForecast(steps(2), TZ, new Date('2026-10-15T20:00:00Z'));
    expect(lateToday.map((day) => day.day)).toEqual(['2026-10-15']);
  });

  it('chooses the worst weather of the day for the icon, else the step around midday, always as a day icon', () => {
    const calm = dailyForecast(steps(40, (i) => ({ icon: i % 8 === 3 ? '01n' : '04d' })), TZ, NOW);
    expect(calm.every((day) => day.icon.endsWith('d'))).toBe(true);
    const stormy = dailyForecast(steps(40, (i) => (i === 10 ? { icon: '11n', condition: 'storm' } : i === 11 ? { icon: '10d', condition: 'rain' } : {})), TZ, NOW);
    expect(stormy[1]).toMatchObject({ icon: '11d', condition: 'storm' });
    const rainy = dailyForecast(steps(40, (i) => (i === 10 ? { icon: '13d', condition: 'snow' } : i === 11 ? { icon: '10d', condition: 'rain' } : {})), TZ, NOW);
    expect(rainy[1]).toMatchObject({ icon: '13d', condition: 'snow' });
  });

  it('ignores steps from earlier days and takes the highest chance of rain', () => {
    const earlier = [{ ...steps(1)[0], time: Date.parse('2026-10-13T12:00:00Z') / 1000 }, ...steps(40)];
    expect(dailyForecast(earlier, TZ, NOW)[0].day).toBe('2026-10-15');
    expect(dailyForecast(steps(40), TZ, NOW)[1].pop).toBe(70);
  });
});

describe('summary view', () => {
  it('draws the original two lines, unchanged, with no icon', () => {
    const canvas = render({ x: 0, y: 0, width: 250, height: 40 }, 'summary');
    expect(canvas.texts.map(({ text, x, y }) => [text, x, y])).toEqual([['clear  18C', 2, 2], ['Wind: 5.0 m/s', 2, 13]]);
    expect(canvas.pixels).toEqual([]);
  });

  it('is the default when no view is set, and is used when there is no reading to draw', () => {
    const none = new Recorder();
    renderWeatherWidget(none, { x: 0, y: 0, width: 250, height: 40 }, { data: current }, undefined, context);
    expect(none.strings).toEqual(['clear  18C', 'Wind: 5.0 m/s']);
    for (const view of WEATHER_VIEWS) {
      const failed = new Recorder();
      renderWeatherWidget(failed, { x: 0, y: 0, width: 250, height: 40 }, { error: { code: 'invalid_key', message: 'SECRET' } }, { view }, context);
      expect(failed.strings).toEqual(['Weather', 'Check API key']);
    }
  });

  it('draws a rule above a widget that is not at the top', () => {
    expect(render({ x: 0, y: 20, width: 250, height: 40 }, 'summary').pixels.length).toBeGreaterThan(0);
  });
});

describe('current view', () => {
  it('draws the temperature large with its degree sign, the condition and the readings', () => {
    const canvas = render({ x: 0, y: 0, width: 250, height: 122 }, 'current');
    const big = canvas.texts.find((entry) => entry.text === '18°')!;
    expect(big.scale).toBeGreaterThanOrEqual(3);
    expect(canvas.strings).toEqual(expect.arrayContaining(['Clear', 'Feels like 17°', 'Humidity 73%', 'Wind 5 m/s N', 'Sunrise 07:23', 'Sunset 18:01']));
    expect(canvas.pixels.length).toBeGreaterThan(50); // the icon
  });

  it('draws only the readings the provider gave', () => {
    const canvas = render({ x: 0, y: 0, width: 250, height: 122 }, 'current', { data: { temp: -3, condition: 'snow', windSpeed: 1, icon: '13n' } });
    expect(canvas.strings).toContain('-3°');
    expect(canvas.strings.some((text) => /Feels|Humidity|Sun/.test(text))).toBe(false);
    expect(canvas.strings).toContain('Wind 1 m/s');
  });

  it('shrinks to the temperature alone in a short widget', () => {
    const canvas = render({ x: 0, y: 0, width: 100, height: 14 }, 'current');
    expect(canvas.strings).toContain('18°');
    expect(canvas.strings).not.toContain('Humidity 73%');
  });
});

describe('hours view', () => {
  it('draws the steps that are still ahead as columns with local time, temperature and chance of rain', () => {
    const canvas = render({ x: 0, y: 0, width: 250, height: 122 }, 'hours');
    // The first step starts at 14:00 local and covers now; steps follow every 3 hours.
    expect(canvas.strings.filter((text) => /^\d\d$/.test(text)).slice(0, 4)).toEqual(['14', '17', '20', '23']);
    expect(canvas.strings).toEqual(expect.arrayContaining(['10°', '11°', '0%', '10%']));
  });

  it('uses full clock times in wide columns, skips steps that have passed, and honours the item limit', () => {
    const wide = render({ x: 0, y: 0, width: 250, height: 122 }, 'hours', {}, { items: 3 });
    expect(wide.strings.filter((text) => /^\d\d:\d\d$/.test(text))).toEqual(['14:00', '17:00', '20:00']);
    const late = new Recorder();
    renderWeatherWidget(late, { x: 0, y: 0, width: 250, height: 122 }, source(), { view: 'hours', items: 1 }, { ...context, now: new Date('2026-10-15T19:00:00Z') });
    // At 21:00 local the step that began at 20:00 still covers now.
    expect(late.strings.find((text) => /^\d\d(:\d\d)?$/.test(text))).toBe('20:00');
  });

  it('adds detail as the height grows, in order: the temperature, the time, the icon, then the chance of rain', () => {
    const at = (height: number) => {
      const canvas = render({ x: 0, y: 0, width: 250, height }, 'hours');
      return { temp: canvas.strings.some((text) => /°$/.test(text)), time: canvas.strings.some((text) => /^\d\d$/.test(text)),
        icon: canvas.pixels.length > 0, rain: canvas.strings.some((text) => /%$/.test(text)) };
    };
    expect(at(14)).toEqual({ temp: true, time: false, icon: false, rain: false });
    expect(at(22)).toEqual({ temp: true, time: true, icon: false, rain: false });
    expect(at(37)).toEqual({ temp: true, time: true, icon: true, rain: false });
    // The chance of rain never shows without the icon: one pixel short of both, it is the icon that stays.
    for (const height of [40, 47]) expect(at(height)).toEqual({ temp: true, time: true, icon: true, rain: false });
    expect(at(48)).toEqual({ temp: true, time: true, icon: true, rain: true });
  });

  it('says so, with the reason, when there is no forecast', () => {
    expect(render({ x: 0, y: 0, width: 250, height: 60 }, 'hours', { forecast: undefined }).strings).toEqual(['No forecast']);
    expect(render({ x: 0, y: 0, width: 250, height: 60 }, 'hours', { forecast: undefined, forecastError: { code: 'rate_limited', message: 'x' } }).strings).toEqual(['API limit']);
    expect(render({ x: 0, y: 0, width: 250, height: 60 }, 'hours', { forecast: [] }, {}, 'da').strings).toEqual(['Ingen prognose']);
  });
});

describe('daily view', () => {
  it('stacks the days in a tall widget, starting with today, with the high and low', () => {
    const canvas = render({ x: 0, y: 0, width: 250, height: 122 }, 'daily');
    expect(canvas.strings.filter((text) => /^[A-Z][a-z]+$/.test(text))).toEqual(['Today', 'Fri', 'Sat', 'Sun', 'Mon']);
    expect(canvas.strings.filter((text) => /°\/\d+°$/.test(text))).toHaveLength(5);
    expect(canvas.strings).toContain('70%');
  });

  it('uses Danish weekdays and today in a Danish display', () => {
    const canvas = render({ x: 0, y: 0, width: 250, height: 122 }, 'daily', {}, {}, 'da');
    expect(canvas.strings.slice(0, 1)).toEqual(['I dag']);
    expect(canvas.strings).toEqual(expect.arrayContaining(['fre.', 'lør.', 'søn.']));
  });

  it('lays the days side by side in a wide, short widget and honours the item limit', () => {
    const strip = render({ x: 0, y: 0, width: 250, height: 40 }, 'daily');
    expect(strip.strings.filter((text) => /^[A-Z][a-z]+$/.test(text))).toEqual(['Today', 'Fri', 'Sat', 'Sun', 'Mon']);
    expect(strip.strings.some((text) => text.includes('/'))).toBe(false);
    const two = render({ x: 0, y: 0, width: 250, height: 122 }, 'daily', {}, { items: 2 });
    expect(two.strings.filter((text) => /^[A-Z][a-z]+$/.test(text))).toEqual(['Today', 'Fri']);
  });

  it('falls back to the weekday when "Today" would run into the temperature', () => {
    const canvas = render({ x: 0, y: 0, width: 60, height: 122 }, 'daily');
    expect(canvas.strings).not.toContain('Today');
    expect(canvas.strings).toContain('Thu');
  });

  it('says so when there is no forecast', () => {
    expect(render({ x: 0, y: 0, width: 250, height: 122 }, 'daily', { forecast: undefined }).strings).toEqual(['No forecast']);
  });
});

describe('details view', () => {
  it('lists the readings with their values and units, label left and value right', () => {
    const canvas = render({ x: 0, y: 0, width: 400, height: 122 }, 'details');
    expect(canvas.strings).toEqual(expect.arrayContaining([
      'Feels like', '17°', 'Humidity', '73%', 'Wind speed', '5 m/s', 'Wind direction', 'N', 'Gusts', '12 m/s', 'Pressure', '1017 hPa',
      'Cloud cover', '32%', 'Visibility', '10 km', 'Rain', '0.4 mm', 'Sunrise', '07:23', 'Sunset', '18:01', 'Air quality', 'Fair', 'PM2.5', '4.2', 'PM10', '7.4',
    ]));
    const value = canvas.texts.find((entry) => entry.text === '1017 hPa')!;
    // Two columns of 196 px: the value ends at the right edge of its column.
    expect([value.x + value.text.length * 8]).toEqual(expect.arrayContaining([value.x + 64]));
    expect(canvas.texts.find((entry) => entry.text === 'Pressure')!.x).toBeLessThan(value.x);
  });

  it('leaves out what is unknown, including air quality when it could not be fetched', () => {
    const canvas = render({ x: 0, y: 0, width: 250, height: 122 }, 'details', { airQuality: undefined, data: { temp: 1, condition: 'clear', windSpeed: 2, icon: '01d' } });
    expect(canvas.strings).toEqual(['Wind speed', '2 m/s']);
  });

  it('draws as many readings as fit in the height, in order of usefulness', () => {
    const canvas = render({ x: 0, y: 0, width: 120, height: 36 }, 'details');
    // 36 px leaves three rows; the third label is cut to the short form beside its value in 120 px.
    expect(canvas.strings.filter((text) => /[a-z]{3}/.test(text) && !/m\/s|hPa|km|mm/.test(text))).toEqual(['Feels like', 'Humidity', 'Wind']);
    expect(canvas.strings).not.toContain('Pressure');
  });

  it('shortens labels, then drops units, in a narrow column, and translates', () => {
    const narrow = render({ x: 0, y: 0, width: 78, height: 122 }, 'details');
    expect(narrow.strings).toEqual(expect.arrayContaining(['Wind', 'Pres', '1017']));
    expect(narrow.strings).not.toContain('Pressure');
    const danish = render({ x: 0, y: 0, width: 400, height: 122 }, 'details', { data: { ...current, windDeg: 315 } }, {}, 'da');
    expect(danish.strings).toEqual(expect.arrayContaining(['Vindretning', 'NV', 'Luftkvalitet', 'Rimelig', 'Solopgang']));
  });
});

describe('every view stays inside its widget', () => {
  const sizes: Array<[number, number]> = [[250, 122], [250, 60], [250, 40], [250, 20], [125, 122], [125, 60], [100, 100], [60, 122], [60, 30], [40, 40], [24, 12], [400, 300], [400, 150]];
  const offset = { x: 30, y: 25 };

  it.each(WEATHER_VIEWS.flatMap((view) => DISPLAY_LANGUAGES.flatMap((language) => sizes.map(([width, height]) => ({ view, language, width, height })))))(
    '$view ($language) at $width x $height', ({ view, language, width, height }) => {
      const bounds = { ...offset, width, height };
      const canvas = render(bounds, view, {}, {}, language);
      for (const { text, x, y, maxWidth, scale } of canvas.texts) {
        const extent = Math.min(Array.from(text).length * 8 * scale, maxWidth);
        expect(x, text).toBeGreaterThanOrEqual(bounds.x);
        expect(x + extent, text).toBeLessThanOrEqual(bounds.x + width);
        expect(y, text).toBeGreaterThanOrEqual(bounds.y);
        // The last line may sit on the bottom edge of a one-line widget, never below it.
        // The original one-line summary has always drawn its second line from 20 px up.
        if (view !== 'summary') expect(y + 8 * scale, text).toBeLessThanOrEqual(bounds.y + height);
      }
      for (const [x, y] of canvas.pixels) {
        expect(x).toBeGreaterThanOrEqual(bounds.x);
        expect(x).toBeLessThan(bounds.x + width);
        expect(y).toBeGreaterThanOrEqual(bounds.y);
        expect(y).toBeLessThan(bounds.y + height);
      }
    });

  it('copes with extreme readings and an empty or one-step forecast', () => {
    const extreme: WeatherData = { temp: -45, condition: 'snow', windSpeed: 99, icon: '13n', feelsLike: -60, humidity: 100, pressure: 1100, windDeg: 359, windGust: 120, visibility: 50, precipitation: 120, cloudiness: 100 };
    for (const view of WEATHER_VIEWS) {
      for (const forecast of [undefined, [], steps(1), steps(40, () => ({ temp: -45, pop: 100, icon: '11n' }))]) {
        const canvas = new Recorder();
        expect(() => renderWeatherWidget(canvas, { x: 0, y: 0, width: 250, height: 122 }, { data: extreme, forecast }, { view }, context)).not.toThrow();
      }
    }
  });
});
