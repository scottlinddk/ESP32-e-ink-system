export type EnergyPriceErrorCode = 'invalid_settings' | 'missing_tariff' | 'unavailable' | 'timeout' | 'invalid_response';
export interface EnergyPriceProblem {
  code: EnergyPriceErrorCode;
  message: string;
  /** Configured grid tariff codes without a current tariff for the configured GLN. */
  missingCodes?: string[];
}

const MESSAGES: Record<EnergyPriceErrorCode, string> = {
  invalid_settings: 'Check the electricity price settings: a 13-digit GLN, 1 to 5 unique tariff codes and a markup between -1000 and 1000 øre/kWh.',
  missing_tariff: 'The grid company has no current tariff for one or more tariff codes. Check that the GLN and tariff codes come from the same grid company and area on your bill.',
  unavailable: 'Electricity prices are unavailable. Try again later.',
  timeout: 'The electricity price sources did not respond in time. Try again.',
  invalid_response: 'The electricity price sources returned invalid data. Try again later.',
};

export const ENERGY_PRICE_ERROR_LABELS: Record<EnergyPriceErrorCode, string> = {
  invalid_settings: 'Energy: check settings', missing_tariff: 'Energy: check tariff',
  unavailable: 'Energy: unavailable', timeout: 'Energy: timed out', invalid_response: 'Energy: invalid data',
};

/**
 * Public messages are fixed; only the user's own configured codes and GLN are echoed.
 * Upstream URLs and response bodies never leave the provider boundary.
 */
export class EnergyPriceSourceError extends Error {
  constructor(readonly code: EnergyPriceErrorCode, readonly missingCodes: string[] = [], gln?: string) {
    super(code === 'missing_tariff' && missingCodes.length
      ? `No current tariff for ${missingCodes.join(', ')} at grid company GLN ${gln}. Check that the GLN and tariff codes come from the same grid company and area on your bill.`
      : MESSAGES[code]);
    this.name = 'EnergyPriceSourceError';
  }
}

export function energyPriceProblem(error: unknown): EnergyPriceProblem {
  if (error instanceof EnergyPriceSourceError) {
    return { code: error.code, message: error.message,
      ...(error.code === 'missing_tariff' && error.missingCodes.length ? { missingCodes: error.missingCodes } : {}) };
  }
  const code = error instanceof Error && ['TimeoutError', 'AbortError'].includes(error.name) ? 'timeout' : 'unavailable';
  return { code, message: MESSAGES[code] };
}
