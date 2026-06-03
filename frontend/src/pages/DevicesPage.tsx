// =========================================================================
// DevicesPage.tsx
// =========================================================================
import React, { useState } from 'react';
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

function lastSeenMin(last_seen_at: string | null): number {
  if (!last_seen_at) return 99999;
  return Math.floor((Date.now() - new Date(last_seen_at).getTime()) / 60000);
}

function deviceStatus(min: number, t: ReturnType<typeof useApp>['t']) {
  if (min < 60) return { variant: 'success' as const, label: t.online };
  if (min < 1440) return { variant: 'warning' as const, label: t.idle };
  return { variant: 'error' as const, label: t.offline };
}

function CopyField({ value }: { value: string }) {
  const { t } = useApp();
  const [done, setDone] = useState(false);
  function copy() {
    try {
      navigator.clipboard && navigator.clipboard.writeText(value);
    } catch {
      // ignore
    }
    setDone(true);
    setTimeout(() => setDone(false), 1200);
  }
  return (
    <button className="copybtn" onClick={copy} title={t.copy} aria-label={t.copy}>
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
  const app = useApp();
  const t = app.t;
  const { getToken } = useAuth();
  const queryClient = useQueryClient();
  const [dialog, setDialog] = useState<DialogState>(null);
  const [form, setForm] = useState({ name: '', id: '' });

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['devices'],
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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['devices'] });
      setDialog(null);
      app.toast({ type: 'success', title: t.devicePaired });
    },
    onError: (err: Error) => {
      app.toast({ type: 'error', title: err.message });
    },
  });

  const editMutation = useMutation({
    mutationFn: async ({ id, name }: { id: string; name: string }) => {
      const token = await getToken();
      if (!token) throw new Error('Not authenticated');
      return updateDevice(token, id, name);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['devices'] });
      setDialog(null);
      app.toast({ type: 'success', title: t.profileSaved });
    },
    onError: (err: Error) => {
      app.toast({ type: 'error', title: err.message });
    },
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
    onError: (err: Error) => {
      app.toast({ type: 'error', title: err.message });
    },
  });

  function openAdd() {
    setForm({ name: '', id: '' });
    setDialog({ type: 'add' });
  }

  function openEdit(d: Device) {
    setForm({ name: d.device_name, id: d.device_id });
    setDialog({ type: 'edit', device: d });
  }

  function pair() {
    addMutation.mutate({ name: form.name || 'New display', id: form.id });
  }

  function saveEdit() {
    if (!dialog || dialog.type !== 'edit') return;
    editMutation.mutate({ id: dialog.device.id, name: form.name });
  }

  function confirmRemove() {
    if (!dialog || dialog.type !== 'remove') return;
    deleteMutation.mutate(dialog.device.id);
  }

  const isAddOrEdit = dialog !== null && (dialog.type === 'add' || dialog.type === 'edit');
  const isRemove = dialog !== null && dialog.type === 'remove';
  const isBusy = addMutation.isPending || editMutation.isPending || deleteMutation.isPending;

  return (
    <div className="page">
      <header className="page__head">
        <div className="row-between">
          <div>
            <h1 className="page__title">{t.devTitle}</h1>
            <p className="page__sub">{t.devSub}</p>
          </div>
          {!isLoading && !error && (
            <Button icon="add" onClick={openAdd}>
              {t.addDevice}
            </Button>
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
              <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
                <Button variant="outlined" icon="refresh" onClick={() => refetch()}>
                  {t.retry}
                </Button>
                <Button icon="add" onClick={openAdd}>
                  {t.addDevice}
                </Button>
              </div>
            }
          />
        ) : devices.length === 0 ? (
          <Empty
            icon="cast"
            title={t.devEmpty}
            text={t.devEmptyMsg}
            action={
              <Button icon="add" onClick={openAdd}>
                {t.devEmptyCta}
              </Button>
            }
          />
        ) : (
          devices.map((d) => {
            const min = lastSeenMin(d.last_seen_at);
            const st = deviceStatus(min, t);
            return (
              <div className="device" key={d.id}>
                <div className="device__glyph">
                  <Icon name="cast" />
                </div>
                <div style={{ minWidth: 0 }}>
                  <div className="device__name">
                    {d.device_name}
                    <Chip variant={st.variant} dot>
                      {st.label}
                    </Chip>
                  </div>
                  <div className="device__rows">
                    <span className="device__kv">
                      {t.deviceId} <b>{d.device_id}</b>
                      <CopyField value={d.device_id} />
                    </span>
                    <span className="device__kv">
                      {t.license} <b>••••••••{d.license_key.slice(-4)}</b>
                      <CopyField value={d.license_key} />
                    </span>
                    <span className="device__kv">
                      {t.firmware} <b>v{d.firmware_version}</b>
                    </span>
                    <span className="device__kv">
                      {t.lastSeen} <b>{fmtAgo(min, app.lang)}</b>
                    </span>
                  </div>
                </div>
                <div className="device__actions">
                  <Button variant="outlined" size="sm" icon="edit" onClick={() => openEdit(d)}>
                    {t.edit}
                  </Button>
                  <Button
                    variant="danger-outlined"
                    size="sm"
                    icon="delete"
                    onClick={() => setDialog({ type: 'remove', device: d })}
                  >
                    {t.remove}
                  </Button>
                </div>
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
            <Button variant="text" onClick={() => setDialog(null)}>
              {t.cancel}
            </Button>
            {dialog && dialog.type === 'edit' ? (
              <Button onClick={saveEdit} loading={isBusy}>
                {t.saveChanges}
              </Button>
            ) : (
              <Button onClick={pair} loading={isBusy}>
                {isBusy ? t.pairing : t.pair}
              </Button>
            )}
          </>
        }
      >
        {dialog && dialog.type === 'add' && (
          <p className="dialog__text" style={{ marginBottom: 16 }}>
            {t.addDeviceText}
          </p>
        )}
        <div className="stack">
          <Field label={t.deviceName} htmlFor="dn">
            <Input
              id="dn"
              value={form.name}
              placeholder={t.deviceNamePh}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </Field>
          {dialog && dialog.type === 'add' && (
            <Field label={t.deviceId} htmlFor="di" helper={t.deviceIdHint}>
              <Input
                id="di"
                mono
                value={form.id}
                placeholder={t.deviceIdPh}
                onChange={(e) => setForm({ ...form, id: e.target.value })}
              />
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
            <Button variant="text" onClick={() => setDialog(null)}>
              {t.cancel}
            </Button>
            <Button variant="danger" onClick={confirmRemove} loading={isBusy}>
              {t.removeForever}
            </Button>
          </>
        }
      >
        <p className="dialog__text">{t.removeDeviceText}</p>
      </Dialog>
    </div>
  );
}
