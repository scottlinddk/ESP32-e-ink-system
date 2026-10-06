import { useApp } from '../../lib/appContext';
import { displaySymbol, emptyTicker, MAX_TICKER_SYMBOLS, MAX_TICKER_WIDGETS, TICKER_NAME_MAX } from '../../lib/tickerWidgets';
import type { TickerView, TickerWidgetSetting } from '../../types';
import { Button } from '../ui/button';
import { Field } from '../ui/Field';
import { Input } from '../ui/input';
import { Select } from '../ui/select';
import { TickerSymbolSearch } from './TickerSymbolSearch';

const DWELL_PRESETS = [5, 10, 15, 30, 60, 180];

/** Stock ticker widgets. Each one becomes its own widget in the layout editor. */
export function TickerWidgetsFields({ tickers, onChange }: { tickers: TickerWidgetSetting[]; onChange: (tickers: TickerWidgetSetting[]) => void }) {
  const { lang } = useApp();
  const da = lang === 'da';
  const update = (id: string, patch: Partial<TickerWidgetSetting>) =>
    onChange(tickers.map((ticker) => ticker.id === id ? { ...ticker, ...patch } : ticker));

  return <div className="grid gap-3">
    <div>
      <p className="text-sm font-medium m-0">{da ? 'Aktiekurser' : 'Stock tickers'}</p>
      <p className="text-xs text-fg3 m-0 mt-0.5">{da
        ? 'Søg efter aktier, også danske. Hver aktiewidget bliver sin egen widget i layout-editoren, så du kan have flere på skærmen. Kurser kommer fra Yahoo Finance og kan være forsinkede.'
        : 'Search for stocks, including Danish ones. Each ticker becomes its own widget in the layout editor, so you can put several on the screen. Prices come from Yahoo Finance and may be delayed.'}</p>
    </div>

    {tickers.map((ticker, index) => {
      const key = `ticker-${ticker.id}`;
      const dwellOptions = [...new Set([...DWELL_PRESETS, ticker.dwell_minutes])].sort((a, b) => a - b);
      const cycles = ticker.symbols.length > 1;
      return <fieldset key={ticker.id} className="grid gap-3 border border-divider rounded-md p-3 m-0 min-w-0">
        <legend className="sr-only">{da ? `Aktiewidget ${index + 1}` : `Stock widget ${index + 1}`}</legend>
        <div className="grid grid-cols-[2fr_1fr_auto] gap-2.5 items-end max-[820px]:grid-cols-1">
          <Field label={da ? 'Navn (valgfrit)' : 'Name (optional)'} htmlFor={`${key}-name`}>
            <Input id={`${key}-name`} maxLength={TICKER_NAME_MAX} value={ticker.name} placeholder={da ? 'Mine aktier' : 'My stocks'}
              onChange={(e) => update(ticker.id, { name: e.target.value })} />
          </Field>
          <Field label={da ? 'Visning' : 'View'} htmlFor={`${key}-view`}>
            <Select id={`${key}-view`} value={ticker.view}
              options={[{ value: 'full', label: da ? 'Fuld (én aktie)' : 'Full (one stock)' }, { value: 'condensed', label: da ? 'Kompakt (liste)' : 'Condensed (list)' }]}
              onChange={(e) => update(ticker.id, { view: e.target.value as TickerView })} />
          </Field>
          <Button variant="text" icon="delete" onClick={() => onChange(tickers.filter((item) => item.id !== ticker.id))}
            aria-label={da ? `Fjern aktiewidget ${index + 1}` : `Remove stock widget ${index + 1}`}>
            {da ? 'Fjern' : 'Remove'}
          </Button>
        </div>

        <div>
          <p className="text-xs font-medium text-fg2 m-0 mb-1.5" id={`${key}-list`}>
            {da ? `Aktier (${ticker.symbols.length}/${MAX_TICKER_SYMBOLS})` : `Stocks (${ticker.symbols.length}/${MAX_TICKER_SYMBOLS})`}
          </p>
          {ticker.symbols.length === 0
            ? <p className="text-xs text-fg3 m-0">{da ? 'Tilføj mindst én aktie.' : 'Add at least one stock.'}</p>
            : <ul aria-labelledby={`${key}-list`} className="flex flex-wrap gap-1.5 list-none p-0 m-0">
              {ticker.symbols.map((symbol) => <li key={symbol} className="flex items-center gap-1 border border-border-strong rounded-full pl-3 pr-1 py-0.5 text-sm">
                <span className="font-mono">{displaySymbol(symbol)}</span>
                <button type="button" aria-label={da ? `Fjern ${symbol}` : `Remove ${symbol}`}
                  className="bg-transparent border-0 cursor-pointer text-fg2 px-1.5 py-0.5 rounded-full hover:bg-black/[0.06]"
                  onClick={() => update(ticker.id, { symbols: ticker.symbols.filter((item) => item !== symbol) })}>×</button>
              </li>)}
            </ul>}
        </div>

        <TickerSymbolSearch id={`${key}-search`} selected={ticker.symbols} disabled={ticker.symbols.length >= MAX_TICKER_SYMBOLS}
          onAdd={(symbol) => update(ticker.id, { symbols: [...ticker.symbols, symbol] })} />
        {ticker.symbols.length >= MAX_TICKER_SYMBOLS && <p className="text-xs text-fg3 m-0">{da
          ? `Højst ${MAX_TICKER_SYMBOLS} aktier pr. widget.` : `At most ${MAX_TICKER_SYMBOLS} stocks per widget.`}</p>}

        <div className="grid grid-cols-3 gap-2.5 max-[820px]:grid-cols-1">
          {ticker.view === 'condensed' && <Field label={da ? 'Aktier pr. side' : 'Stocks per page'} htmlFor={`${key}-per-page`}>
            <Select id={`${key}-per-page`} value={ticker.per_page === null ? 'auto' : String(ticker.per_page)}
              options={[{ value: 'auto', label: da ? 'Så mange som der er plads til' : 'As many as fit' },
                ...[1, 2, 3, 4, 5, 6, 8].map((value) => ({ value: String(value), label: String(value) }))]}
              onChange={(e) => update(ticker.id, { per_page: e.target.value === 'auto' ? null : Number(e.target.value) })} />
          </Field>}
          {cycles && <Field label={da ? 'Skift side hvert' : 'Change page every'} htmlFor={`${key}-dwell`}>
            <Select id={`${key}-dwell`} value={String(ticker.dwell_minutes)}
              options={dwellOptions.map((value) => ({ value: String(value), label: `${value} min` }))}
              onChange={(e) => update(ticker.id, { dwell_minutes: Number(e.target.value) })} />
          </Field>}
          <Field label={da ? 'Talformat' : 'Number format'} htmlFor={`${key}-locale`}>
            <Select id={`${key}-locale`} value={ticker.locale}
              options={[{ value: 'da', label: '1.234,50 kr' }, { value: 'en', label: '$1,234.50' }]}
              onChange={(e) => update(ticker.id, { locale: e.target.value === 'en' ? 'en' : 'da' })} />
          </Field>
        </div>
        {cycles && <p className="text-xs text-fg3 m-0">{da
          ? 'Siden skifter først, når skærmen får et nyt billede. Vælg mindst 5 minutter for at skåne e-papiret.'
          : 'The page only changes when the display receives a new image. Choose 5 minutes or more to spare the e-ink panel.'}</p>}
      </fieldset>;
    })}

    <div>
      <Button variant="outlined" icon="add" disabled={tickers.length >= MAX_TICKER_WIDGETS} onClick={() => onChange([...tickers, emptyTicker(tickers, da ? 'da' : 'en')])}>
        {da ? 'Tilføj aktiewidget' : 'Add stock widget'}
      </Button>
      {tickers.length >= MAX_TICKER_WIDGETS && <p className="text-xs text-fg3 m-0 mt-1.5">{da
        ? `Højst ${MAX_TICKER_WIDGETS} aktiewidgets.` : `At most ${MAX_TICKER_WIDGETS} stock widgets.`}</p>}
      {tickers.length > 0 && <p className="text-xs text-fg3 m-0 mt-1.5">{da
        ? 'Gem, og tilføj derefter widgetten til dit layout under Rediger layout.'
        : 'Save, then add the widget to your layout in the layout editor.'}</p>}
    </div>
  </div>;
}
