import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { usePreferences, useSavePreferences } from '../../hooks/usePreferences';
import { useApp } from '../../lib/appContext';
import { getPreferences } from '../../lib/api';
import { deviceLayoutChange, deviceLayoutPath, type LayoutAction } from '../../lib/deviceLayouts';
import { Card } from '../ui/card';
import { Button } from '../ui/button';

export function DeviceLayoutsCard({ deviceId }: { deviceId: string }) {
  const { lang } = useApp();
  const da = lang === 'da';
  const { getToken } = useAuth();
  const query = usePreferences(deviceId);
  const save = useSavePreferences(deviceId);
  const [name, setName] = useState('');
  const [names, setNames] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const preferences = query.data;
  const pages = preferences?.display_schedule?.pages ?? [];
  const rotating = preferences?.display_schedule?.enabled;
  const disabled = query.isPending || query.isError || !preferences || busy || save.isPending;
  const inputClass = 'border border-divider rounded px-3 py-2 bg-transparent text-sm w-full';
  async function change(action: LayoutAction) {
    setBusy(true); setError(''); setNotice('');
    try {
      const token = await getToken();
      if (!token) throw new Error(da ? 'Log ind igen.' : 'Please sign in again.');
      const latest = await getPreferences(token, deviceId);
      await save.mutateAsync(deviceLayoutChange(latest.preferences, action));
      if (action.type === 'add') setName('');
      setNotice(da ? 'Enhedens layouts er gemt.' : 'Device layouts saved.');
    } catch (failure) { setError((failure as Error).message); }
    finally { setBusy(false); }
  }
  return <Card icon="grid_view" title={da ? 'Gemte layouts på denne enhed' : 'Saved layouts on this device'}
    desc={da ? 'Gem flere layouts, og vælg hvilket der skal vises.' : 'Save several layouts and choose which one to display.'}>
    {query.isPending && <p role="status">{da ? 'Indlæser layouts…' : 'Loading layouts…'}</p>}
    {query.isError && <p role="alert">{da ? 'Kunne ikke hente enhedens layouts.' : 'Could not load this device’s layouts.'} <Button variant="text" onClick={() => void query.refetch()}>{da ? 'Prøv igen' : 'Retry'}</Button></p>}
    <fieldset disabled={disabled} className="border-0 p-0 m-0 grid gap-3">
      <p className="text-sm m-0">{rotating
        ? (da ? 'Siderotation er aktiv. Vælg “Vis dette layout” for at skifte til ét fast layout.' : 'Page rotation is active. Choose “Show this layout” to switch to a single layout.')
        : (da ? 'Viser: ' : 'Showing: ') + (pages.find((page) => page.id === preferences?.active_layout_id)?.name ?? (da ? 'Grundlayout' : 'Base layout'))}</p>
      <div className="border border-divider rounded p-3 flex flex-wrap items-center gap-3">
        <strong className="text-sm flex-1">{da ? 'Grundlayout' : 'Base layout'}</strong>
        {preferences && <Link to={deviceLayoutPath(deviceId)} className="text-sm underline">{da ? 'Redigér' : 'Edit'}</Link>}
        <Button size="sm" variant="outlined" disabled={disabled || (!rotating && !preferences?.active_layout_id)} onClick={() => void change({ type: 'default' })}>{da ? 'Vis grundlayout' : 'Show base layout'}</Button>
      </div>
      {pages.map((page) => <div key={page.id} className="border border-divider rounded p-3 grid gap-2">
        <label className="text-xs">{da ? 'Layoutnavn' : 'Layout name'}<input className={inputClass} maxLength={80} value={names[page.id] ?? page.name}
          onChange={(event) => setNames({ ...names, [page.id]: event.target.value })} /></label>
        <div className="flex flex-wrap gap-2 items-center">
          <Button size="sm" variant="text" disabled={disabled || !names[page.id]?.trim() || names[page.id].trim() === page.name}
            onClick={() => void change({ type: 'rename', id: page.id, name: names[page.id] })}>{da ? 'Gem navn' : 'Save name'}</Button>
          <Link to={deviceLayoutPath(deviceId, page.id)} className="text-sm underline px-2">{da ? 'Redigér layout' : 'Edit layout'}</Link>
          <Button size="sm" variant="outlined" disabled={disabled || (!rotating && preferences?.active_layout_id === page.id)}
            onClick={() => void change({ type: 'select', id: page.id })}>{!rotating && preferences?.active_layout_id === page.id ? (da ? 'Valgt' : 'Selected') : (da ? 'Vis dette layout' : 'Show this layout')}</Button>
          <Button size="sm" variant="text" disabled={disabled} onClick={() => {
            if (window.confirm(da ? `Fjern “${page.name}”? Hvis det er valgt, vises næste gemte layout eller grundlayoutet.` : `Remove “${page.name}”? If selected, the next saved layout or base layout will be shown.`)) void change({ type: 'remove', id: page.id });
          }}>{da ? 'Fjern' : 'Remove'}</Button>
        </div>
      </div>)}
      <label className="text-sm">{da ? 'Navn på nyt layout' : 'New layout name'}<input className={inputClass} maxLength={80} value={name} onChange={(event) => setName(event.target.value)} /></label>
      <Button variant="outlined" disabled={disabled || !name.trim() || pages.length >= 12} onClick={() => void change({ type: 'add', id: crypto.randomUUID(), name })}>
        {da ? 'Gem en kopi som nyt layout' : 'Save a copy as a new layout'}</Button>
      <p className="text-xs text-fg2 m-0">{da ? 'Kopierer det valgte faste layout eller grundlayoutet. Højst 12 gemte layouts. En aktiv rotation bevares, indtil du vælger et fast layout.' : 'Copies the selected fixed layout or base layout. Up to 12 saved layouts. An existing rotation is preserved until you choose a fixed layout.'}</p>
    </fieldset>
    {error && <p role="alert" className="text-sm text-warning">{error}</p>}
    {notice && <p role="status" className="text-sm">{notice}</p>}
  </Card>;
}
