import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { acceptSharedItem, dismissSharedItem, type SharedItem } from '../../lib/api';
import { useApp } from '../../lib/appContext';
import { useApiToken, useDeviceList, useInvalidateSharing, userLabel, useSharedItems } from '../../hooks/useSharing';
import { usePreferences } from '../../hooks/usePreferences';
import { Card } from '../ui/card';
import { Button } from '../ui/button';
import { Chip } from '../ui/Chip';
import { Dialog } from '../ui/Dialog';

const kindName = (kind: SharedItem['kind'], da: boolean) => ({ layout: da ? 'Layout' : 'Layout', widget: 'Widget', dashboard: da ? 'Dashboard' : 'Dashboard' })[kind];

export function InboxCard() {
  const { lang, toast } = useApp();
  const da = lang === 'da';
  const token = useApiToken();
  const inbox = useSharedItems('inbox');
  const refresh = useInvalidateSharing();
  const [accepting, setAccepting] = useState<SharedItem | null>(null);
  const decline = useMutation({
    mutationFn: async (id: string) => dismissSharedItem(await token(), id),
    onSuccess: () => refresh('shared-items'),
    onError: (error) => toast({ type: 'error', title: error instanceof Error ? error.message : (da ? 'Noget gik galt.' : 'Something went wrong.') }),
  });
  const items = inbox.data ?? [];

  return <Card icon="inbox" title={da ? 'Modtaget' : 'Inbox'}
    desc={da ? 'Layouts, widgets og dashboards andre har sendt. Du får en kopi, der bruger dine egne datakilder.' : 'Layouts, widgets and dashboards other people sent. You get a copy that uses your own data sources.'}>
    {inbox.isPending && <p className="text-sm text-fg2 m-0">{da ? 'Henter…' : 'Loading…'}</p>}
    {inbox.isError && <p role="alert" className="text-sm text-error m-0">{da ? 'Kunne ikke hente indbakken.' : 'Could not load your inbox.'}</p>}
    {inbox.isSuccess && items.length === 0 && <p className="text-sm text-fg2 m-0">{da ? 'Intet nyt.' : 'Nothing new.'}</p>}
    <ul className="list-none p-0 m-0 flex flex-col gap-3">{items.map((item) => <li key={item.id} className="flex items-center gap-3 justify-between flex-wrap">
      <div className="min-w-0">
        <div className="text-sm font-medium"><Chip variant="info">{kindName(item.kind, da)}</Chip> {item.name}</div>
        <div className="text-xs text-fg2">{da ? 'Fra' : 'From'} {userLabel(item.from)} · {item.summary.widgets.join(', ') || '—'}{item.summary.pages > 0 && ` · ${item.summary.pages} ${da ? 'layouts' : 'layouts'}`}</div>
      </div>
      <span className="flex gap-2">
        <Button size="sm" onClick={() => setAccepting(item)}>{da ? 'Tilføj til enhed…' : 'Add to a device…'}</Button>
        <Button size="sm" variant="outlined" onClick={() => decline.mutate(item.id)}>{da ? 'Afvis' : 'Decline'}</Button>
      </span>
    </li>)}</ul>
    {accepting && <AcceptDialog item={accepting} onClose={() => setAccepting(null)} onDone={() => { setAccepting(null); refresh('shared-items'); }} />}
  </Card>;
}

function AcceptDialog({ item, onClose, onDone }: { item: SharedItem; onClose: () => void; onDone: () => void }) {
  const { lang, toast } = useApp();
  const da = lang === 'da';
  const token = useApiToken();
  const devices = useDeviceList();
  // Anything the user may edit: their own devices, and shared devices where they are an editor.
  const targets = [...(devices.data?.devices ?? []).map((device) => ({ id: device.id, name: device.device_name })),
    ...(devices.data?.shared_devices ?? []).filter((device) => device.role === 'editor').map((device) => ({ id: device.id, name: `${device.device_name} (${userLabel(device.owner)})` }))];
  const [deviceId, setDeviceId] = useState('');
  const [pageId, setPageId] = useState('');
  const prefs = usePreferences(deviceId || undefined);
  const pages = prefs.data?.display_schedule?.pages ?? [];
  const accept = useMutation({
    mutationFn: async () => acceptSharedItem(await token(), item.id, { device_id: deviceId, page_id: item.kind === 'widget' && pageId ? pageId : null }),
    onSuccess: () => { toast({ type: 'success', title: da ? 'Tilføjet. Åbn layouteditoren for at justere.' : 'Added. Open the layout editor to adjust it.' }); onDone(); },
    onError: (error) => toast({ type: 'error', title: error instanceof Error ? error.message : (da ? 'Noget gik galt.' : 'Something went wrong.') }),
  });
  const replaces = item.kind === 'dashboard';

  return <Dialog open onClose={onClose} title={`${da ? 'Tilføj' : 'Add'} “${item.name}”`} icon="add_to_photos" danger={replaces}
    footer={<><Button variant="outlined" onClick={onClose}>{da ? 'Annullér' : 'Cancel'}</Button>
      <Button disabled={!deviceId} loading={accept.isPending} variant={replaces ? 'danger' : 'contained'} onClick={() => accept.mutate()}>{replaces ? (da ? 'Erstat layouts' : 'Replace layouts') : (da ? 'Tilføj' : 'Add')}</Button></>}>
    <label className="block text-sm mb-3">{da ? 'Enhed' : 'Device'}
      <select className="select-native w-full mt-1" value={deviceId} onChange={(event) => { setDeviceId(event.target.value); setPageId(''); }}>
        <option value="">{da ? 'Vælg en enhed…' : 'Choose a device…'}</option>
        {targets.map((target) => <option key={target.id} value={target.id}>{target.name}</option>)}
      </select>
    </label>
    {item.kind === 'widget' && deviceId && <label className="block text-sm mb-3">{da ? 'Layout' : 'Layout'}
      <select className="select-native w-full mt-1" value={pageId} onChange={(event) => setPageId(event.target.value)}>
        <option value="">{da ? 'Grundlayout' : 'Base layout'}</option>
        {pages.map((page) => <option key={page.id} value={page.id}>{page.name}</option>)}
      </select>
    </label>}
    <p className="text-sm text-fg2 m-0">{replaces
      ? (da ? 'Enhedens grundlayout og gemte layouts erstattes. Din tidszone, stille timer og skærmprofil beholdes.' : 'The device’s base layout and saved layouts are replaced. Your time zone, quiet hours and panel profile are kept.')
      : item.kind === 'widget' ? (da ? 'Widgetten placeres på første ledige plads. Intet andet flyttes.' : 'The widget goes in the first free spot. Nothing else moves.')
        : (da ? 'Tilføjes som et nyt gemt layout. Intet eksisterende ændres.' : 'Added as a new saved layout. Nothing existing changes.')}</p>
  </Dialog>;
}
