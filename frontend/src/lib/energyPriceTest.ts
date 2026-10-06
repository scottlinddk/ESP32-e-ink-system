import type { EnergyPrice, EnergyPriceErrorCode } from '../types';
import { createSourceTest } from './sourceTest';

export type EnergyPriceTestState = { status: 'idle' | 'loading' }
  | { status: 'success'; price: EnergyPrice }
  | { status: 'error'; code: EnergyPriceErrorCode; missingCodes: string[] };

const CODES: EnergyPriceErrorCode[] = ['invalid_settings', 'missing_tariff', 'unavailable', 'timeout', 'invalid_response'];

/** Only known codes and the user's own configured tariff codes are shown; never arbitrary response text. */
export function energyPriceTestError(error: unknown): { code: EnergyPriceErrorCode; missingCodes: string[] } {
  const value = error && typeof error === 'object' ? error as { code?: unknown; missingCodes?: unknown } : {};
  const code = CODES.find((known) => known === value.code) ?? 'unavailable';
  const missingCodes = code === 'missing_tariff' && Array.isArray(value.missingCodes)
    ? value.missingCodes.filter((item): item is string => typeof item === 'string') : [];
  return { code, missingCodes };
}

export function createEnergyPriceTest(publish: (state: EnergyPriceTestState) => void) {
  return createSourceTest<EnergyPrice, EnergyPriceTestState>(publish, {
    success: (price) => ({ status: 'success', price }),
    error: (error) => ({ status: 'error', ...energyPriceTestError(error) }),
    timeout: { status: 'error', code: 'timeout', missingCodes: [] },
  });
}
