export interface EnergidataRecord {
  TimeDK: string;
  TimeUTC: string;
  PriceArea: string;
  DayAheadPriceDKK: number;
  DayAheadPriceEUR: number;
}

export interface EnergidataResponse {
  total: number;
  limit: number;
  dataset: string;
  records: EnergidataRecord[];
}

export interface EnergyPriceData {
  /** Current 15-minute spot price in øre/kWh, excluding taxes and tariffs */
  nowOre: number;
  /** Average of today's available intervals in øre/kWh, Europe/Copenhagen */
  averageOre: number;
  trend: 'up' | 'down' | 'stable';
  /** Legacy field name: today's 15-minute prices in chronological order */
  hourlyPrices: Array<{ hourDK: string; priceOre: number }>;
}

export interface EnergyPriceConfig {
  priceArea: 'DK1' | 'DK2';
}
