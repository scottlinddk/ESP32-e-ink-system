import { useEffect, useState } from 'react';
import { useApp } from '../../lib/appContext';
import { GRID_PRESETS, gridPresetMismatch, parseDecimalInput, parseGridChargeCodes, type GridPreset } from '../../lib/energyPriceSettings';
import type { EnergyPriceSettings } from '../../types';
import { Field } from '../ui/Field';
import { Input } from '../ui/input';
import { Select } from '../ui/select';
import { Button } from '../ui/button';

export function EnergyPriceSettingsFields({ settings, onChange, onZoneChange }: {
  settings: EnergyPriceSettings;
  onChange: (settings: EnergyPriceSettings) => void;
  onZoneChange: (zone: string, settings: EnergyPriceSettings) => void;
}) {
  const { lang } = useApp();
  const da = lang === 'da';
  const markup = settings.mode === 'consumer' ? settings.retailerMarkupOre : 0;
  const formatMarkup = (value: number) => da ? String(value).replace('.', ',') : String(value);
  const [markupInput, setMarkupInput] = useState(formatMarkup(markup));
  // Keep the raw text while typing (e.g. "2,50"); only resync when the value changes from outside.
  useEffect(() => {
    if (Number.isFinite(markup)) {
      setMarkupInput((current) => parseDecimalInput(current) === markup ? current : formatMarkup(markup));
    }
  }, [markup]);
  const codes = settings.mode === 'consumer' ? settings.gridChargeCodes : [];
  const codesKey = codes.join(',');
  const [codesInput, setCodesInput] = useState(codes.join(', '));
  // Keep the raw text while typing; only resync when the codes change from outside (preset, mode switch).
  useEffect(() => {
    setCodesInput((current) => parseGridChargeCodes(current).join(',') === codesKey ? current : codesKey.split(',').join(', '));
  }, [codesKey]);
  const preset = settings.mode === 'consumer'
    ? GRID_PRESETS.find((grid) => grid.gln === settings.gridGln && settings.gridChargeCodes.length === 1 && grid.code === settings.gridChargeCodes[0])
    : undefined;
  const mismatch = gridPresetMismatch(settings);
  const applyPreset = (grid: GridPreset) => onZoneChange(grid.zone,
    { mode: 'consumer', gridGln: grid.gln, gridChargeCodes: [grid.code], retailerMarkupOre: markup });

  return <div className="grid gap-3.5">
    <Field label={da ? 'Pristype' : 'Price basis'} htmlFor="energy-price-mode">
      <Select id="energy-price-mode" value={settings.mode} options={[
        { value: 'spot', label: da ? 'Spotpris · ekskl. moms, afgifter og tariffer' : 'Spot price · excluding VAT, taxes and tariffs' },
        { value: 'consumer', label: da ? 'Estimeret forbrugspris · inkl. moms' : 'Estimated variable price · including VAT' },
      ]} onChange={(event) => onChange(event.target.value === 'consumer'
        ? { mode: 'consumer', gridGln: '', gridChargeCodes: [], retailerMarkupOre: 0 }
        : { mode: 'spot' })} />
    </Field>
    {settings.mode === 'consumer' && <>
      <p className="text-xs text-fg2 m-0">{da
        ? 'Spotpris + nettarif + Energinets tariffer + elafgift + dit elselskabs tillæg, inkl. 25 % moms. Faste abonnementer er ikke medregnet. Kontrollér netselskab og tarif på din regning; standardvalgene er til private C-kunder.'
        : 'Spot price + grid tariff + Energinet tariffs + electricity tax + your supplier markup, including 25% VAT. Fixed subscriptions are excluded. Check the grid company and tariff on your bill; presets are for household C customers.'}</p>
      <Field label={da ? 'Netselskab og tarif' : 'Grid company and tariff'} htmlFor="energy-grid-preset">
        <Select id="energy-grid-preset" value={preset?.gln ?? ''} options={[
          { value: '', label: da ? 'Vælg netselskab, eller udfyld egne oplysninger nedenfor' : 'Choose your grid, or enter custom details below' },
          ...GRID_PRESETS.map((grid) => ({ value: grid.gln, label: `${grid.name}${grid.name.startsWith('N1') ? (da ? ' (netområde)' : ' (grid area)') : ''} · ${grid.zone}` })),
        ]} onChange={(event) => {
          const grid = GRID_PRESETS.find((item) => item.gln === event.target.value);
          if (grid) onZoneChange(grid.zone, { ...settings, gridGln: grid.gln, gridChargeCodes: [grid.code] });
          else onChange({ ...settings, gridGln: '', gridChargeCodes: [] });
        }} />
      </Field>
      {preset && <a href={preset.url} target="_blank" rel="noreferrer" className="text-xs underline">{da ? 'Kontrollér netselskabets aktuelle priser og din kundetype' : 'Check the grid company’s current prices and your customer category'}</a>}
      <div className="grid grid-cols-2 gap-3.5 max-[820px]:grid-cols-1">
        <Field label={da ? 'Netselskabets GLN (13 cifre)' : 'Grid company GLN (13 digits)'} htmlFor="energy-grid-gln">
          <Input id="energy-grid-gln" mono inputMode="numeric" maxLength={13} value={settings.gridGln}
            onChange={(event) => onChange({ ...settings, gridGln: event.target.value })} />
        </Field>
        <Field label={da ? 'Tarifkoder (adskilt med komma)' : 'Tariff codes (comma-separated)'} htmlFor="energy-grid-codes">
          <Input id="energy-grid-codes" mono value={codesInput}
            onChange={(event) => {
              setCodesInput(event.target.value);
              onChange({ ...settings, gridChargeCodes: parseGridChargeCodes(event.target.value) });
            }} />
        </Field>
      </div>
      {mismatch && <div role="status" className="grid gap-2">
        <p className="text-xs text-warning m-0">
          {mismatch.glnPreset && (da
            ? `GLN ${mismatch.glnPreset.gln} er ${mismatch.glnPreset.name}, hvis tarifkode for private er ${mismatch.glnPreset.code}. Den er ikke blandt dine koder. `
            : `GLN ${mismatch.glnPreset.gln} is ${mismatch.glnPreset.name}, whose household tariff code is ${mismatch.glnPreset.code}. It is not among your codes. `)}
          {mismatch.codePresets.map((grid) => da
            ? `Koden ${grid.code} hører til ${grid.name} (GLN ${grid.gln}), ikke til dette GLN. `
            : `Code ${grid.code} belongs to ${grid.name} (GLN ${grid.gln}), not this GLN. `).join('')}
          {da
            ? 'GLN og tarifkoder skal komme fra samme netselskab og netområde, ellers kan prisen ikke beregnes. Vælg det, der passer til din regning.'
            : 'The GLN and tariff codes must come from the same grid company and area, or the price cannot be calculated. Choose the one that matches your bill.'}
        </p>
        <div className="flex flex-wrap gap-2">
          {[...(mismatch.glnPreset ? [mismatch.glnPreset] : []), ...mismatch.codePresets].map((grid) =>
            <Button key={grid.gln} variant="outlined" size="sm" onClick={() => applyPreset(grid)}>
              {da ? `Brug ${grid.name}` : `Use ${grid.name}`}
            </Button>)}
        </div>
      </div>}
      <p className="text-xs text-fg2 m-0">{da
        ? 'Egne oplysninger: vælg 1–5 tarifkoder for dit netselskab. Alle koder lægges sammen og skal have en gældende tarif; manglende eller udløbne koder giver ingen pris.'
        : 'Custom details: choose 1–5 tariff codes for your grid company. All codes are added together and must have a current tariff; missing or expired codes make the price unavailable.'}</p>
      <Field label={da ? 'Elselskabets tillæg (øre/kWh, ekskl. moms)' : 'Supplier markup (øre/kWh, excluding VAT)'} htmlFor="energy-retailer-markup"
        helper={da ? 'Indtast tillægget fra din egen elaftale. Brug kun 0, hvis aftalen ikke har et tillæg.' : 'Enter the markup from your own electricity agreement. Use 0 only if your agreement has no markup.'}>
        <Input id="energy-retailer-markup" type="text" inputMode="decimal" autoComplete="off" value={markupInput}
          onChange={(event) => {
            setMarkupInput(event.target.value);
            onChange({ ...settings, retailerMarkupOre: parseDecimalInput(event.target.value) });
          }} />
      </Field>
    </>}
  </div>;
}
