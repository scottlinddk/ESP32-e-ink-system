export type EnergyPriceSettings =
  | { mode: 'spot' }
  | { mode: 'consumer'; gridGln: string; gridChargeCodes: string[]; retailerMarkupOre: number };

/** Validate the whole profile before a preference or template is saved. */
export function parseEnergyPriceSettings(value: unknown): EnergyPriceSettings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('energy_price_settings must be an object');
  }
  const settings = value as Record<string, unknown>;
  const keys = settings.mode === 'spot'
    ? ['mode'] : ['mode', 'gridGln', 'gridChargeCodes', 'retailerMarkupOre'];
  if (Object.keys(settings).some((key) => !keys.includes(key))) {
    throw new Error('energy_price_settings contains unknown fields');
  }
  if (settings.mode === 'spot') return { mode: 'spot' };
  if (settings.mode !== 'consumer') throw new Error('Energy price mode must be spot or consumer');
  if (typeof settings.gridGln !== 'string' || !/^\d{13}$/.test(settings.gridGln)) {
    throw new Error('Grid GLN must contain exactly 13 digits');
  }
  const codes = settings.gridChargeCodes;
  if (!Array.isArray(codes) || codes.length < 1 || codes.length > 5
    || codes.some((code) => typeof code !== 'string' || !code.length || code.length > 20
      || code !== code.trim() || /[\x00-\x1f\x7f]/.test(code))
    || new Set(codes).size !== codes.length) {
    throw new Error('Choose 1 to 5 unique grid tariff codes (1–20 characters each)');
  }
  if (typeof settings.retailerMarkupOre !== 'number' || !Number.isFinite(settings.retailerMarkupOre)
    || Math.abs(settings.retailerMarkupOre) > 1000) {
    throw new Error('Retailer markup must be a finite number between -1000 and 1000 øre/kWh');
  }
  return { mode: 'consumer', gridGln: settings.gridGln,
    gridChargeCodes: [...codes], retailerMarkupOre: settings.retailerMarkupOre };
}
