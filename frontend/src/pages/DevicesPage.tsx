// =========================================================================
// DevicesPage.tsx
// =========================================================================
import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useApp } from '../lib/appContext';
import { useAuth } from '../hooks/useAuth';
import { getDevices, addDevice, updateDevice, removeDevice } from '../lib/api';
import { Card } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Field } from '../components/ui/Field';
import { Input } from '../components/ui/input';
import { Chip } from '../components/ui/Chip';
import { LoadBox } from '../components/ui/Spinner';
import { Empty } from '../components/ui/Empty';
import { Dialog } from '../components/ui/Dialog';
import { Icon } from '../components/ui/Logo';
import { fmtAgo } from '../lib/mockData';
import type { Device } from '../types';
import { DeviceDeliveryCard } from '../components/dashboard/DeviceDeliveryCard';
import { usePreferences } from '../hooks/usePreferences';
import { deviceDashboardPath } from '../lib/deviceLayouts';

function DeviceLayoutSummary({ deviceId }: { deviceId: string }) {
  const { lang } = useApp();
  const da = lang === 'da';
  const query = usePreferences(deviceId);
  const prefs = query.data;
  if (query.isPending) return <p className="text-xs text-fg2">{da ? 'Indlæser layout…' : 'Loading layout…'}</p>;
  if (query.isError || !prefs) return <p className="text-xs text-fg2">{da ? 'Layout utilgængeligt' : 'Layout unavailable'}</p>;
  const pages = prefs.display_schedule?.pages ?? [];
  const title = prefs.display_schedule?.enabled ? `${da ? 'Siderotation' : 'Page rotation'}: ${pages.map((page) => page.name).join(', ')}`
    : `${da ? 'Layout' : 'Layout'}: ${pages.find((page) => page.id === prefs.active_layout_id)?.name ?? (da ? 'Grundlayout' : 'Base layout')}`;
  return <p className="text-xs text-fg2 mb-0">{title}</p>;
}

function lastSeenMin(last_seen_at: string | null): number | null {
  const timestamp = last_seen_at ? Date.parse(last_seen_at) : NaN;
  if (!Number.isFinite(timestamp)) return null;
  return Math.max(0, Math.floor((Date.now() - timestamp) / 60000));
}

function deviceStatus(min: number | null, t: ReturnType<typeof useApp>['t']) {
  if (min === null) return { variant: 'default' as const, label: t.unknown };
  if (min < 60) return { variant: 'success' as const, label: t.online };
  if (min < 1440) return { variant: 'warning' as const, label: t.idle };
  return { variant: 'error' as const, label: t.offline };
}

function CopyField({ value }: { value: string }) {
  const { t } = useApp();
  const [done, setDone] = useState(false);
  function copy() {
    try { navigator.clipboard && navigator.clipboard.writeText(value); } catch { /* ignore */ }
    setDone(true);
    setTimeout(() => setDone(false), 1200);
  }
  return (
    <button
      className="bg-transparent border-none text-fg3 cursor-pointer inline-flex items-center p-0 hover:text-accent [&_.material-symbols-outlined]:text-[15px]"
      onClick={copy}
      title={t.copy}
      aria-label={t.copy}
    >
      <Icon name={done ? 'check' : 'content_copy'} />
    </button>
  );
}

type DialogState =
  | { type: 'add' }
  | { type: 'edit'; device: Device }
  | { type: 'remove'; device: Device }
  | null;

export function DevicesPage() {
  const { user } = useAuth();
  return <DevicesForUser key={user?.id ?? 'signed-out'} />;
}

function DevicesForUser() {
  const app = useApp();
  const t = app.t;
  const { getToken, user, isSignedIn } = useAuth();
  const queryClient = useQueryClient();
  const [dialog, setDialog] = useState<DialogState>(null);
  const [form, setForm] = useState({ name: '', id: '' });

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['devices', user?.id],
    enabled: isSignedIn,
    queryFn: async () => {
      const token = await getToken();
      if (!token) throw new Error('Not authenticated');
      return getDevices(token);
    },
  });

  const devices = data?.devices ?? [];

  const addMutation = useMutation({
    mutationFn: async ({ name, id }: { name: string; id: string }) => {
      const token = await getToken();
      if (!token) throw new Error('Not authenticated');
      return addDevice(token, id, name);
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['devices'] }); setDialog(null); app.toast({ type: 'success', title: t.devicePaired }); },
    onError: (err: Error) => { app.toast({ type: 'error', title: err.message }); },
  });

  const editMutation = useMutation({
    mutationFn: async ({ id, name }: { id: string; name: string }) => {
      const token = await getToken();
      if (!token) throw new Error('Not authenticated');
      return updateDevice(token, id, name);
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['devices'] }); setDialog(null); app.toast({ type: 'success', title: t.profileSaved }); },
    onError: (err: Error) => { app.toast({ type: 'error', title: err.message }); },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const token = await getToken();
      if (!token) throw new Error('Not authenticated');
      return removeDevice(token, id);
    },
    onSuccess: (_data, id) => {
      queryClient.invalidateQueries({ queryKey: ['devices'] });
      const removed = devices.find((d) => d.id === id);
      setDialog(null);
      app.toast({ type: 'info', title: t.remove + (removed ? ' · ' + removed.device_name : '') });
    },
    onError: (err: Error) => { app.toast({ type: 'error', title: err.message }); },
  });

  function openAdd() { setForm({ name: '', id: '' }); setDialog({ type: 'add' }); }
  function openEdit(d: Device) { setForm({ name: d.device_name, id: d.device_id }); setDialog({ type: 'edit', device: d }); }
  function pair() { addMutation.mutate({ name: form.name || 'New display', id: form.id }); }
  function saveEdit() { if (!dialog || dialog.type !== 'edit') return; editMutation.mutate({ id: dialog.device.id, name: form.name }); }
  function confirmRemove() { if (!dialog || dialog.type !== 'remove') return; deleteMutation.mutate(dialog.device.id); }

  const isAddOrEdit = dialog !== null && (dialog.type === 'add' || dialog.type === 'edit');
  const isRemove = dialog !== null && dialog.type === 'remove';
  const isBusy = addMutation.isPending || editMutation.isPending || deleteMutation.isPending;

  return (
    <div className="max-w-[1180px] mx-auto px-6 pt-6 pb-20 animate-fade-up max-[820px]:px-4 max-[820px]:pt-5 max-[820px]:pb-16">
      <header className="mb-5">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-h2 font-light tracking-tight m-0 mb-1.5">{t.devTitle}</h1>
            <p className="text-fg2 text-body m-0">{t.devSub}</p>
          </div>
          {!isLoading && !error && (
            <Button icon="add" onClick={openAdd}>{t.addDevice}</Button>
          )}
        </div>
      </header>

      <Card flat>
        {isLoading ? (
          <LoadBox text={t.loadingDevices} />
        ) : error ? (
          <Empty
            icon="wifi_off"
            title={t.devFetchError}
            text={t.devFetchErrorMsg}
            action={
              <div className="flex gap-2 justify-center flex-wrap">
                <Button variant="outlined" icon="refresh" onClick={() => refetch()}>{t.retry}</Button>
                <Button icon="add" onClick={openAdd}>{t.addDevice}</Button>
              </div>
            }
          />
        ) : devices.length === 0 ? (
          <Empty
            icon="cast"
            title={t.devEmpty}
            text={t.devEmptyMsg}
            action={<Button icon="add" onClick={openAdd}>{t.devEmptyCta}</Button>}
          />
        ) : (
          devices.map((d) => {
            const min = lastSeenMin(d.last_seen_at);
            const st = deviceStatus(min, t);
            return (
              <div
                key={d.id}
                id={`device-${d.id}`}
                className="grid grid-cols-[48px_1fr_auto] gap-4 px-5 py-4 items-center [&+&]:border-t [&+&]:border-divider max-[560px]:grid-cols-1 max-[560px]:gap-3"
              >
                <div className="w-12 h-12 rounded-md bg-black/[0.10] text-fg2 flex items-center justify-center [&_.material-symbols-outlined]:text-[24px]">
                  <Icon name="cast" />
                </div>
                <div className="min-w-0">
                  <div className="text-body font-medium flex items-center gap-2.5 flex-wrap">
                    {d.device_name}
                    <Chip variant={st.variant} dot>{st.label}</Chip>
                  </div>
                  <div className="flex flex-wrap gap-y-1 gap-x-[18px] mt-1.5">
                    {[
                      { label: t.deviceId, value: d.ble_name ?? d.device_id, copy: true },
                      { label: t.firmware, value: d.firmware_version ? `v${d.firmware_version.replace(/^v/, '')}` : t.unknown },
                      { label: t.lastSeen, value: min === null ? t.never : fmtAgo(min, app.lang) },
                    ].map((kv) => (
                      <span key={kv.label} className="text-xs text-fg2 flex items-center gap-1.5 [&_b]:font-normal [&_b]:text-fg1 [&_b]:font-mono">
                        {kv.label} <b>{kv.value}</b>
                        {kv.copy && <CopyField value={kv.value} />}
                      </span>
                    ))}
                  </div>
                  <DeviceLayoutSummary deviceId={d.id} />
                </div>
                <div className="flex gap-2 max-[560px]:justify-start">
                  <Link className="text-sm underline self-center" to={deviceDashboardPath(d.id)}>{app.lang === 'da' ? 'Åbn enhed' : 'Open device'}</Link>
                  <Button variant="outlined" size="sm" icon="edit" onClick={() => openEdit(d)}>{t.edit}</Button>
                  <Button variant="danger-outlined" size="sm" icon="delete" onClick={() => setDialog({ type: 'remove', device: d })}>{t.remove}</Button>
                </div>
                <DeviceDeliveryCard deviceId={d.id} />
              </div>
            );
          })
        )}
      </Card>

      {/* Add / Edit dialog */}
      <Dialog
        open={isAddOrEdit}
        onClose={() => setDialog(null)}
        title={dialog && dialog.type === 'edit' ? t.edit : t.addDeviceTitle}
        icon="cast"
        footer={
          <>
            <Button variant="text" onClick={() => setDialog(null)}>{t.cancel}</Button>
            {dialog && dialog.type === 'edit' ? (
              <Button onClick={saveEdit} loading={isBusy}>{t.saveChanges}</Button>
            ) : (
              <Button onClick={pair} loading={isBusy}>{isBusy ? t.pairing : t.pair}</Button>
            )}
          </>
        }
      >
        {dialog && dialog.type === 'add' && (
          <p className="text-sm text-fg2 m-0 leading-[1.55] mb-4">{t.addDeviceText}</p>
        )}
        <div className="flex flex-col gap-4">
          <Field label={t.deviceName} htmlFor="dn">
            <Input id="dn" value={form.name} placeholder={t.deviceNamePh} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </Field>
          {dialog && dialog.type === 'add' && (
            <Field label="Hardware ID (optional)" htmlFor="di" helper="Use a label or hardware identifier, or leave blank to generate one. Automatic updates provides the device UUID used during Wi-Fi setup.">
              <Input id="di" mono value={form.id} placeholder="Kitchen display" onChange={(e) => setForm({ ...form, id: e.target.value })} />
            </Field>
          )}
        </div>
      </Dialog>

      {/* Remove confirm */}
      <Dialog
        open={isRemove}
        onClose={() => setDialog(null)}
        title={t.removeDeviceTitle}
        icon="warning"
        danger
        footer={
          <>
            <Button variant="text" onClick={() => setDialog(null)}>{t.cancel}</Button>
            <Button variant="danger" onClick={confirmRemove} loading={isBusy}>{t.removeForever}</Button>
          </>
        }
      >
        <p className="text-sm text-fg2 m-0 leading-[1.55]">{t.removeDeviceText}</p>
      </Dialog>
    </div>
  );
}
