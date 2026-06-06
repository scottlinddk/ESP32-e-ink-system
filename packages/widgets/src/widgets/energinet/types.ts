export interface EnergidataRecord {
  HourDK: string;
  HourUTC: string;
  PriceArea: string;
  SpotPriceDKK: number;
  SpotPriceEUR: number;
}

export interface EnergidataResponse {
  total: number;
  limit: number;
  dataset: string;
  records: EnergidataRecord[];
}

export interface EnergyPriceData {
  /** Current hour spot price in øre/kWh */
  nowOre: number;
  /** 24-hour average in øre/kWh */
  averageOre: number;
  trend: 'up' | 'down' | 'stable';
  /** Hourly prices for the last 24 records (newest first) */
  hourlyPrices: Array<{ hourDK: string; priceOre: number }>;
}

export interface EnergyPriceConfig {
  priceArea: 'DK1' | 'DK2';
}
