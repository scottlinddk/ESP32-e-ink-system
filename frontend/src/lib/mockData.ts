/* =========================================================================
   mockData.ts — mock devices, hourly prices, einkContent, fmtAgo
   ========================================================================= */

export interface MockDevice {
  id: string;
  name: { en: string; da: string };
  license: string;
  firmware: string;
  lastSeenMin: number;
}

export const initialDevices: MockDevice[] = [
  {
    id: "ESP-7F3A9C",
    name: { en: "Living room display", da: "Stuens display" },
    license: "DSPL-2K4M-9XQ1-7TBA",
    firmware: "1.0.0",
    lastSeenMin: 2,
  },
  {
    id: "ESP-2B81D4",
    name: { en: "Kitchen display", da: "Køkkenets display" },
    license: "DSPL-7P2C-1RV8-3MFD",
    firmware: "1.0.0",
    lastSeenMin: 1440,
  },
];

// Hourly spot prices (kr/kWh) for the mini chart, DK1
export const hourlyPrices: number[] = [
  0.62, 0.58, 0.55, 0.54, 0.57, 0.66, 0.84, 1.12, 1.34, 1.41, 1.28, 1.10,
  0.98, 0.92, 0.95, 1.06, 1.22, 1.48, 1.62, 1.51, 1.30, 1.08, 0.86, 0.71,
];

export interface EinkContentData {
  price: number;
  avg: number;
  trend: 'up' | 'down';
  zone: string;
  temp: number;
  cond: string;
  rain: number;
  wind: number;
  news: string;
  monta: { chargerStatus: string; session?: string };
  zaptec: { chargerStatus: string; session?: string; installation?: string };
}

export function einkContent(lang: string): EinkContentData {
  return {
    price: 1.24,
    avg: 0.98,
    trend: 'down',
    zone: 'DK1',
    temp: 12,
    cond: lang === 'da' ? 'Regn' : 'Rain',
    rain: 60,
    wind: 4,
    news:
      lang === 'da'
        ? 'Danmark: afgørelse om elkompensation'
        : 'Denmark: ruling on power compensation',
    monta: { chargerStatus: '2 avail / 1 charging', session: '3.2 kWh · 45 min' },
    zaptec: { chargerStatus: '1 avail', session: '1.8 kWh · 12 min', installation: 'Home' },
  };
}

export function fmtAgo(min: number, lang: string): string {
  if (min < 1) return lang === 'da' ? 'lige nu' : 'just now';
  if (min < 60) return `${min}m`;
  if (min < 1440) return `${Math.round(min / 60)}h`;
  return `${Math.round(min / 1440)}d`;
}
