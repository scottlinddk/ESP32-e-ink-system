import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../../hooks/useAuth';
import { useApp } from '../../lib/appContext';
import { searchTickers } from '../../lib/api';
import { displaySymbol, normalizeSymbol } from '../../lib/tickerWidgets';
import type { TickerSearchResult } from '../../types';
import { Checkbox } from '../ui/checkbox';
import { Input } from '../ui/input';

interface Props {
  id: string;
  /** Symbols already in the watchlist; they are shown as added and cannot be picked twice. */
  selected: readonly string[];
  disabled?: boolean;
  onAdd: (symbol: string) => void;
}

const MIN_QUERY = 2;
const DEBOUNCE_MS = 300;

/** Search Yahoo Finance by company name or symbol; "Danish stocks only" limits it to Nasdaq Copenhagen. */
export function TickerSymbolSearch({ id, selected, disabled, onAdd }: Props) {
  const { lang } = useApp();
  const da = lang === 'da';
  const { getToken, isSignedIn } = useAuth();
  const [text, setText] = useState('');
  const [query, setQuery] = useState('');
  const [danishOnly, setDanishOnly] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => setQuery(text.trim()), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [text]);

  const region = danishOnly ? 'dk' : 'any';
  const search = useQuery({
    queryKey: ['ticker-search', query.toLowerCase(), region],
    enabled: isSignedIn && query.length >= MIN_QUERY,
    staleTime: 10 * 60_000,
    retry: false,
    queryFn: async ({ signal }) => {
      const token = await getToken();
      if (!token) throw new Error(da ? 'Log ind igen' : 'Please sign in again');
      return (await searchTickers(token, query, region, signal)).results;
    },
  });

  // Typing an exact symbol always works, even when search is unavailable.
  const direct = normalizeSymbol(text);
  const results: TickerSearchResult[] = search.data ?? [];
  const isSelected = (symbol: string) => selected.includes(symbol);
  const add = (symbol: string) => { onAdd(symbol); setText(''); setQuery(''); };

  return <div className="grid gap-2">
    <div className="flex gap-3 items-end flex-wrap">
      <div className="flex-1 min-w-[220px]">
        <label htmlFor={id} className="block text-xs font-medium text-fg2 mb-1">{da ? 'Søg aktie' : 'Search stock'}</label>
        <Input id={id} value={text} disabled={disabled} maxLength={40} autoComplete="off" role="combobox"
          aria-expanded={results.length > 0} aria-controls={`${id}-results`}
          placeholder={da ? 'Fx Novo, Carlsberg eller NVDA' : 'e.g. Novo, Carlsberg or NVDA'}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); if (direct && !isSelected(direct) && !disabled) add(direct); } }} />
      </div>
      <Checkbox id={`${id}-dk`} checked={danishOnly} onChange={() => setDanishOnly(!danishOnly)}
        label={da ? 'Kun danske aktier (Nasdaq København)' : 'Danish stocks only (Nasdaq Copenhagen)'} />
    </div>

    {query.length >= MIN_QUERY && <div id={`${id}-results`} role="listbox" aria-label={da ? 'Søgeresultater' : 'Search results'}
      className="border border-divider rounded-md divide-y divide-divider max-h-56 overflow-auto">
      {search.isFetching && <p className="text-xs text-fg3 m-0 p-2.5">{da ? 'Søger…' : 'Searching…'}</p>}
      {search.isError && <p role="alert" className="text-xs text-fg2 m-0 p-2.5">{da
        ? 'Søgningen er ikke tilgængelig lige nu. Du kan stadig skrive symbolet direkte og trykke Enter.'
        : 'Search is unavailable right now. You can still type the symbol and press Enter.'}</p>}
      {!search.isFetching && !search.isError && results.length === 0 && <p className="text-xs text-fg3 m-0 p-2.5">{da
        ? 'Ingen aktier fundet.' : 'No stocks found.'}</p>}
      {results.map((result) => <button key={result.symbol} type="button" role="option" aria-selected={isSelected(result.symbol)}
        disabled={disabled || isSelected(result.symbol)}
        onClick={() => add(result.symbol)}
        className="w-full flex items-baseline gap-3 text-left px-3 py-2 bg-transparent border-0 cursor-pointer hover:bg-black/[0.04] disabled:opacity-50 disabled:cursor-default">
        <span className="font-mono text-sm font-medium">{displaySymbol(result.symbol)}</span>
        <span className="flex-1 min-w-0 text-sm text-fg2 truncate">{result.name}</span>
        <span className="text-xs text-fg3">{isSelected(result.symbol) ? (da ? 'Tilføjet' : 'Added') : result.exchangeName}</span>
      </button>)}
    </div>}

    {direct && !isSelected(direct) && text.trim().length > 0 && <p className="text-xs text-fg3 m-0">
      {da ? 'Tryk Enter for at tilføje ' : 'Press Enter to add '}<span className="font-mono">{direct}</span>
    </p>}
  </div>;
}
