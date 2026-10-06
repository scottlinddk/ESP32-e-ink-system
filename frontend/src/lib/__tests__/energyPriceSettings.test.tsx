import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { EnergyPriceSettingsFields } from '../../components/dashboard/EnergyPriceSettingsFields';
import type { EnergyPriceSettings } from '../../types';
import { energyPriceSettingsForSave, GRID_PRESETS, gridPresetMismatch, parseDecimalInput, parseGridChargeCodes, validEnergyPriceSettings } from '../energyPriceSettings';

const session = vi.hoisted(() => ({ lang: 'en' }));
vi.mock('../appContext', () => ({ useApp: () => ({ lang: session.lang }) }));
const household: EnergyPriceSettings = { mode: 'consumer', gridGln: '5790000610099', gridChargeCodes: ['TCL<100_02'], retailerMarkupOre: 7.5 };

describe('electricity price settings', () => {
  it('lets disabled incomplete drafts save unrelated settings while preserving valid profiles', () => {
    const incomplete = { ...household, gridGln: '' };
    expect(energyPriceSettingsForSave(false, incomplete)).toEqual({ mode: 'spot' });
    expect(energyPriceSettingsForSave(false, household)).toEqual(household);
    expect(energyPriceSettingsForSave(true, incomplete)).toEqual(incomplete);
    expect(validEnergyPriceSettings(energyPriceSettingsForSave(true, incomplete))).toBe(false);
  });
  it('accepts spot mode, each household preset and additive custom codes with discounts', () => {
    expect(validEnergyPriceSettings({ mode: 'spot' })).toBe(true);
    for (const grid of GRID_PRESETS) {
      expect(validEnergyPriceSettings({ ...household, gridGln: grid.gln, gridChargeCodes: [grid.code] })).toBe(true);
    }
    expect(validEnergyPriceSettings({ ...household, gridChargeCodes: ['TCL<100_02', 'discount>0'], retailerMarkupOre: -2 })).toBe(true);
  });

  it('keeps spaces inside tariff codes such as "CD R" while typing', () => {
    expect(parseGridChargeCodes('CD, CD ')).toEqual(['CD', 'CD']);
    expect(parseGridChargeCodes('CD, CD R')).toEqual(['CD', 'CD R']);
    expect(parseGridChargeCodes(' CD ,, CD R ,')).toEqual(['CD', 'CD R']);
    expect(parseGridChargeCodes('')).toEqual([]);
    expect(validEnergyPriceSettings({ ...household, gridChargeCodes: parseGridChargeCodes('CD, CD R') })).toBe(true);
  });

  it.each([
    ['5', 5], ['12', 12], ['2,5', 2.5], ['2.5', 2.5], ['0,75', 0.75], [',5', 0.5], [' 7,5 ', 7.5],
    ['-2,5', -2.5], ['\u22122,5', -2.5], ['0', 0],
  ])('parses supplier markup %j with a comma or period as %d', (input, expected) => {
    expect(parseDecimalInput(input)).toBe(expected);
  });

  it.each(['', ' ', '5,', '2,5,0', '1.000,5', '2,5 øre', 'abc', '--1', '1e3'])(
    'rejects unfinished or ambiguous markup %j instead of guessing a value', (input) => {
      expect(parseDecimalInput(input)).toBeNaN();
      expect(validEnergyPriceSettings({ ...household, retailerMarkupOre: parseDecimalInput(input) })).toBe(false);
    });

  it.each([
    { gridGln: '' }, { gridGln: '123456789012' }, { gridGln: '579000061009X' },
    { gridChargeCodes: [] }, { gridChargeCodes: [''] }, { gridChargeCodes: ['A', 'A'] },
    { gridChargeCodes: [' code'] }, { gridChargeCodes: ['x'.repeat(21)] },
    { gridChargeCodes: ['a', 'b', 'c', 'd', 'e', 'f'] },
    { retailerMarkupOre: Number.NaN }, { retailerMarkupOre: Number.POSITIVE_INFINITY },
    { retailerMarkupOre: 1001 }, { retailerMarkupOre: -1001 },
  ])('rejects incomplete or invalid consumer settings %j', (patch) => {
    expect(validEnergyPriceSettings({ ...household, ...patch })).toBe(false);
  });

  function render(settings: EnergyPriceSettings, lang = 'en') {
    session.lang = lang;
    return renderToStaticMarkup(<EnergyPriceSettingsFields settings={settings} onChange={vi.fn()} onZoneChange={vi.fn()} />);
  }

  it('does not guess a household grid and makes tax and subscription treatment explicit', () => {
    const html = render({ mode: 'consumer', gridGln: '', gridChargeCodes: [], retailerMarkupOre: 0 });
    expect(html).toContain('<option value="" selected="">');
    expect(html).toContain('Fixed subscriptions are excluded');
    expect(html).toContain('household C customers');
    expect(html).toContain('Supplier markup (øre/kWh, excluding VAT)');
    expect(html).toContain('Use 0 only if your agreement has no markup');
    expect(html).toContain('N1 C · 131 (grid area)');
    expect(html).toContain('N1 C · 344 (grid area)');
  });

  it('renders custom tariff punctuation safely and links to the selected grid tariff', () => {
    const html = render(household);
    expect(html).toContain('value="TCL&lt;100_02"');
    expect(html).toContain('href="https://dinel.dk/priser-og-bestemmelser/hvad-skal-private-elkunder-betale-i-nettarif/"');
    expect(html).toContain('value="7.5"');
  });

  it('labels spot exclusions and localizes consumer guidance', () => {
    const spot = render({ mode: 'spot' });
    expect(spot).toContain('Spot price · excluding VAT, taxes and tariffs');
    expect(spot).not.toContain('energy-grid-gln');
    const da = render(household, 'da');
    expect(da).toContain('Faste abonnementer er ikke medregnet');
    expect(da).toContain('Elselskabets tillæg (øre/kWh, ekskl. moms)');
    expect(da).not.toContain('Supplier markup');
    expect(da).toContain('value="7,5"');
    expect(da).toContain('inputMode="decimal"');
    expect(da).not.toContain('type="number"');
  });

  it('flags a GLN and tariff codes taken from different grid areas', () => {
    const [n1Area131, n1Area344] = [GRID_PRESETS[2], GRID_PRESETS[3]];
    const mixed: EnergyPriceSettings = { ...household, gridGln: n1Area344.gln, gridChargeCodes: ['CD', 'CD R'] };
    expect(gridPresetMismatch(mixed)).toEqual({ glnPreset: n1Area344, codePresets: [n1Area131] });
    // A custom code with a known GLN is flagged; a known code with an unknown GLN is flagged.
    expect(gridPresetMismatch({ ...household, gridGln: n1Area344.gln, gridChargeCodes: ['OTHER'] })).toEqual({ glnPreset: n1Area344, codePresets: [] });
    expect(gridPresetMismatch({ ...household, gridGln: '5790000000000', gridChargeCodes: ['CD'] })).toEqual({ codePresets: [n1Area131] });
  });

  it('accepts matching presets, extra adjustment codes, unknown grids, incomplete drafts and spot mode', () => {
    for (const grid of GRID_PRESETS) {
      expect(gridPresetMismatch({ ...household, gridGln: grid.gln, gridChargeCodes: [grid.code] })).toBeNull();
    }
    expect(gridPresetMismatch({ ...household, gridGln: GRID_PRESETS[3].gln, gridChargeCodes: ['T-C-F-T-TD', 'discount'] })).toBeNull();
    expect(gridPresetMismatch({ ...household, gridGln: '5790000000000', gridChargeCodes: ['OTHER'] })).toBeNull();
    expect(gridPresetMismatch({ ...household, gridGln: '579000061', gridChargeCodes: ['CD'] })).toBeNull();
    expect(gridPresetMismatch({ mode: 'spot' })).toBeNull();
  });

  it('warns in the settings form and offers both matching presets', () => {
    session.lang = 'en';
    const html = renderToStaticMarkup(<EnergyPriceSettingsFields
      settings={{ ...household, gridGln: '5790000611003', gridChargeCodes: ['CD', 'CD R'] }} onChange={vi.fn()} onZoneChange={vi.fn()} />);
    expect(html).toContain('GLN 5790000611003 is N1 C · 344, whose household tariff code is T-C-F-T-TD');
    expect(html).toContain('Code CD belongs to N1 C · 131 (GLN 5790001089030)');
    expect(html).toContain('Use N1 C · 344');
    expect(html).toContain('Use N1 C · 131');
    const matching = renderToStaticMarkup(<EnergyPriceSettingsFields
      settings={{ ...household, gridGln: '5790000611003', gridChargeCodes: ['T-C-F-T-TD'] }} onChange={vi.fn()} onZoneChange={vi.fn()} />);
    expect(matching).not.toContain('must come from the same grid company');
  });
});
