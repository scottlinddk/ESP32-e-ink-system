/** One interval from https://www.elprisenligenu.dk/elpris-api; prices exclude VAT, taxes and tariffs. */
export interface ElprisRecord {
  DKK_per_kWh: number;
  EUR_per_kWh: number;
  EXR: number;
  /** ISO 8601 with the Danish UTC offset, e.g. 2026-10-04T00:00:00+02:00 */
  time_start: string;
  time_end: string;
}

export interface EnergyPriceData {
  /** Current 15-minute spot price in øre/kWh, excluding taxes and tariffs */
  nowOre: number;
  /** Average of today's available intervals in øre/kWh, Europe/Copenhagen */
  averageOre: number;
  trend: 'up' | 'down' | 'stable';
  /** Legacy field name: today's interval prices in chronological order; hourDK is the interval's offset start time */
  hourlyPrices: Array<{ hourDK: string; priceOre: number }>;
}

export interface EnergyPriceConfig {
  priceArea: 'DK1' | 'DK2';
}
