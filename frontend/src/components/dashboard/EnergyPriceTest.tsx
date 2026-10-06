import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { useApp } from '../../lib/appContext';
import { testEnergyPrice } from '../../lib/api';
import { validEnergyPriceSettings } from '../../lib/energyPriceSettings';
import { createEnergyPriceTest, type EnergyPriceTestState } from '../../lib/energyPriceTest';
import type { EnergyPriceErrorCode, EnergyPriceSettings } from '../../types';
import { Button } from '../ui/button';

export function EnergyPriceTest({ zone, settings }: { zone: string; settings: EnergyPriceSettings }) {
  const { user, isSignedIn } = useAuth();
  // Discard both results and in-flight work whenever the draft changes.
  return isSignedIn && user
    ? <AccountEnergyPriceTest key={`${user.id}:${zone}:${JSON.stringify(settings)}`} zone={zone} settings={settings} /> : null;
}

function errorText(da: boolean, code: EnergyPriceErrorCode, missingCodes: string[]): string {
  const codes = missingCodes.join(', ');
  switch (code) {
    case 'invalid_settings': return da
      ? 'Udfyld indstillingerne først: et GLN på 13 cifre, 1–5 unikke tarifkoder og et gyldigt tillæg.'
      : 'Complete the settings first: a 13-digit GLN, 1–5 unique tariff codes and a valid markup.';
    case 'missing_tariff': return da
      ? `Ingen gældende tarif for ${codes || 'en eller flere koder'} hos dette GLN. Kontrollér, at GLN og tarifkoder kommer fra samme netselskab og netområde på din regning.`
      : `No current tariff for ${codes || 'one or more codes'} at this GLN. Check that the GLN and tariff codes come from the same grid company and area on your bill.`;
    case 'timeout': return da ? 'Pristesten tog for lang tid. Prøv igen.' : 'The price test timed out. Try again.';
    case 'invalid_response': return da
      ? 'En priskilde returnerede ugyldige data. Prøv igen senere.'
      : 'A price source returned invalid data. Try again later.';
    default: return da ? 'Elpriserne kunne ikke hentes. Prøv igen senere.' : 'Electricity prices could not be retrieved. Try again later.';
  }
}

function AccountEnergyPriceTest({ zone, settings }: { zone: string; settings: EnergyPriceSettings }) {
  const { lang, t } = useApp();
  const da = lang === 'da';
  const { getToken } = useAuth();
  const [state, setState] = useState<EnergyPriceTestState>({ status: 'idle' });
  const test = useMemo(() => createEnergyPriceTest(setState), []);
  useEffect(() => () => test.dispose(), [test]);
  const format = new Intl.NumberFormat(t.locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  function run() {
    if (!validEnergyPriceSettings(settings)) {
      setState({ status: 'error', code: 'invalid_settings', missingCodes: [] });
      return;
    }
    void test.run(async (signal) => {
      const token = await getToken();
      signal.throwIfAborted();
      if (!token) throw new Error('Not authenticated');
      return (await testEnergyPrice(token, zone, settings, signal)).price;
    });
  }
  return <div className="grid gap-2">
    <p className="text-xs text-fg2 m-0">{da
      ? 'Tester indstillingerne mod dagens priser uden at gemme dem.'
      : 'Tests these settings against today’s prices without saving them.'}</p>
    <Button variant="outlined" size="sm" onClick={run} loading={state.status === 'loading'}>
      {state.status === 'loading' ? (da ? 'Tester pris…' : 'Testing price…') : (da ? 'Test pris' : 'Test price')}
    </Button>
    {state.status === 'error' && <p role="alert" className="text-xs text-warning m-0">{errorText(da, state.code, state.missingCodes)}</p>}
    {state.status === 'success' && <p role="status" className="text-xs text-fg2 m-0">
      {da ? 'Aktuel pris:' : 'Current price:'} {format.format(state.price.now / 100)} {da ? 'kr./kWh' : 'DKK/kWh'} · {state.price.basis === 'consumer'
        ? (da ? 'inkl. moms, ekskl. faste abonnementer' : 'including VAT, excluding fixed subscriptions')
        : (da ? 'spotpris ekskl. moms, afgifter og tariffer' : 'spot price excluding VAT, taxes and tariffs')}
    </p>}
  </div>;
}
