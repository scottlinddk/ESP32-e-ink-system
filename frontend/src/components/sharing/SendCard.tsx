import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { sendSharedItem, type ShareSource, type SharedItemKind } from '../../lib/api';
import { useApp } from '../../lib/appContext';
import { useApiToken, useConnections, useDeviceList, useInvalidateSharing, userLabel } from '../../hooks/useSharing';
import { usePreferences } from '../../hooks/usePreferences';
import { Card } from '../ui/card';
import { Button } from '../ui/button';

/** Built-in widgets only: feeds, stock lists and extra calendars are tied to the sender's own accounts. */
const SHAREABLE = new Set(['energy', 'weather', 'news', 'monta', 'zaptec', 'notion', 'family-meals', 'custom-text', 'custom-image', 'custom-webhook', 'calendar', 'week-number', 'battery', 'ai-usage', 'status']);

export function SendCard() {
  const { lang, toast } = useApp();
  const da = lang === 'da';
  const token = useApiToken();
  const connections = useConnections();
  const devices = useDeviceList();
  const refresh = useInvalidateSharing();
  const [recipient, setRecipient] = useState('');
  const [kind, setKind] = useState<SharedItemKind>('layout');
  const [deviceId, setDeviceId] = useState('');
  const [pageId, setPageId] = useState('');
  const [widgetId, setWidgetId] = useState('');
  const prefs = usePreferences(deviceId || undefined);

  // Sources the sender may read: their own devices and shared devices they can edit.
  const sources = [...(devices.data?.devices ?? []).map((device) => ({ id: device.id, name: device.device_name })),
    ...(devices.data?.shared_devices ?? []).filter((device) => device.role === 'editor').map((device) => ({ id: device.id, name: `${device.device_name} (${userLabel(device.owner)})` }))];
  const pages = prefs.data?.display_schedule?.pages ?? [];
  const layout = pageId ? pages.find((page) => page.id === pageId)?.layout : prefs.data?.layout;
  const widgets = (layout?.widgets ?? []).filter((widget) => SHAREABLE.has(widget.i));
  const people = (connections.data ?? []).filter((row) => row.status === 'connected');

  const source: ShareSource | null = !deviceId ? null
    : kind === 'dashboard' ? { kind, device_id: deviceId }
      : kind === 'layout' ? { kind, device_id: deviceId, page_id: pageId || null }
        : widgetId ? { kind, device_id: deviceId, page_id: pageId || null, widget_id: widgetId } : null;

  const send = useMutation({
    mutationFn: async () => sendSharedItem(await token(), { recipient_id: recipient, source: source! }),
    onSuccess: ({ dropped }) => {
      refresh('shared-items');
      toast({ type: 'success', title: dropped > 0
        ? (da ? `Sendt. ${dropped} widget(s) med egne kilder blev ikke med.` : `Sent. ${dropped} widget(s) tied to your own sources were left out.`)
        : (da ? 'Sendt.' : 'Sent.') });
    },
    onError: (error) => toast({ type: 'error', title: error instanceof Error ? error.message : (da ? 'Noget gik galt.' : 'Something went wrong.') }),
  });

  return <Card icon="send" title={da ? 'Send indhold' : 'Send something'}
    desc={da ? 'Send et layout, en widget eller et helt dashboard til en forbindelse. De får en kopi. Dine kilder og nøgler følger ikke med.' : 'Send a layout, a widget or a whole dashboard to a connection. They get a copy. Your sources and keys do not go with it.'}>
    <div className="grid grid-cols-2 gap-4 max-[560px]:grid-cols-1">
      <label className="text-sm">{da ? 'Modtager' : 'To'}
        <select className="select-native w-full mt-1" value={recipient} onChange={(event) => setRecipient(event.target.value)} disabled={people.length === 0}>
          <option value="">{people.length === 0 ? (da ? 'Ingen forbindelser endnu' : 'No connections yet') : (da ? 'Vælg en forbindelse…' : 'Choose a connection…')}</option>
          {people.map((row) => <option key={row.user.id} value={row.user.id}>{userLabel(row.user)}</option>)}
        </select></label>
      <label className="text-sm">{da ? 'Hvad' : 'What'}
        <select className="select-native w-full mt-1" value={kind} onChange={(event) => { setKind(event.target.value as SharedItemKind); setWidgetId(''); }}>
          <option value="layout">{da ? 'Et layout' : 'A layout'}</option>
          <option value="widget">{da ? 'En widget' : 'A widget'}</option>
          <option value="dashboard">{da ? 'Hele dashboardet (alle layouts)' : 'Whole dashboard (all layouts)'}</option>
        </select></label>
      <label className="text-sm">{da ? 'Fra enhed' : 'From device'}
        <select className="select-native w-full mt-1" value={deviceId} onChange={(event) => { setDeviceId(event.target.value); setPageId(''); setWidgetId(''); }}>
          <option value="">{da ? 'Vælg en enhed…' : 'Choose a device…'}</option>
          {sources.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
        </select></label>
      {kind !== 'dashboard' && deviceId && <label className="text-sm">{da ? 'Layout' : 'Layout'}
        <select className="select-native w-full mt-1" value={pageId} onChange={(event) => { setPageId(event.target.value); setWidgetId(''); }}>
          <option value="">{da ? 'Grundlayout' : 'Base layout'}</option>
          {pages.map((page) => <option key={page.id} value={page.id}>{page.name}</option>)}
        </select></label>}
      {kind === 'widget' && deviceId && <label className="text-sm">Widget
        <select className="select-native w-full mt-1" value={widgetId} onChange={(event) => setWidgetId(event.target.value)}>
          <option value="">{widgets.length === 0 ? (da ? 'Ingen deles­bare widgets i layoutet' : 'No shareable widgets in this layout') : (da ? 'Vælg en widget…' : 'Choose a widget…')}</option>
          {widgets.map((widget) => <option key={widget.i} value={widget.i}>{widget.i}</option>)}
        </select></label>}
    </div>
    <div className="mt-4"><Button icon="send" disabled={!recipient || !source} loading={send.isPending} onClick={() => send.mutate()}>{da ? 'Send' : 'Send'}</Button></div>
  </Card>;
}
