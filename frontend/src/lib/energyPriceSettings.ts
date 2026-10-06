import type { EnergyPriceSettings } from '../types';

// Standard household C tariffs. The customer must check the plan on their bill.
export const GRID_PRESETS = [
  { name: 'Radius C', zone: 'DK2', gln: '5790000705689', code: 'DT_C_01', url: 'https://radiuselnet.dk/priser/' },
  { name: 'Cerius C', zone: 'DK2', gln: '5790000705184', code: '30TR_C_ET', url: 'https://cerius.dk/priser/alle/' },
  { name: 'N1 C · 131', zone: 'DK1', gln: '5790001089030', code: 'CD', url: 'https://n1.dk/gaeldende-priser' },
  { name: 'N1 C · 344', zone: 'DK1', gln: '5790000611003', code: 'T-C-F-T-TD', url: 'https://n1.dk/gaeldende-priser' },
  { name: 'Dinel C', zone: 'DK1', gln: '5790000610099', code: 'TCL<100_02', url: 'https://dinel.dk/priser-og-bestemmelser/hvad-skal-private-elkunder-betale-i-nettarif/' },
] as const;

/** Split the comma-separated tariff code input. Spaces inside a code (e.g. "CD R") are kept. */
export function parseGridChargeCodes(input: string): string[] {
  return input.split(',').map((code) => code.trim()).filter((code) => code.length > 0);
}

/**
 * Parse a decimal typed with either a comma (Danish) or a period. A leading minus
 * (or Unicode minus) is allowed for discounts. Anything else, including thousands
 * separators or an unfinished "5,", returns NaN so the save validation rejects it.
 */
export function parseDecimalInput(input: string): number {
  const normalized = input.trim().replace(/^\u2212/, '-');
  return /^-?(\d+([.,]\d+)?|[.,]\d+)$/.test(normalized) ? Number(normalized.replace(',', '.')) : Number.NaN;
}

export function validEnergyPriceSettings(settings: EnergyPriceSettings): boolean {
  if (settings.mode === 'spot') return true;
  const codes = settings.gridChargeCodes;
  return /^\d{13}$/.test(settings.gridGln)
    && codes.length >= 1 && codes.length <= 5
    && codes.every((code) => code.length > 0 && code.length <= 20 && code === code.trim() && !/[\x00-\x1f\x7f]/.test(code))
    && new Set(codes).size === codes.length
    && Number.isFinite(settings.retailerMarkupOre) && Math.abs(settings.retailerMarkupOre) <= 1000;
}

export function energyPriceSettingsForSave(enabled: boolean, settings: EnergyPriceSettings = { mode: 'spot' }): EnergyPriceSettings {
  return !enabled && !validEnergyPriceSettings(settings) ? { mode: 'spot' } : settings;
}
