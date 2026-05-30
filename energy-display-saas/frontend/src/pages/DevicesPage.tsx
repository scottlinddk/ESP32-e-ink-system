// =========================================================================
// DevicesPage.tsx
// =========================================================================
import React, { useState, useEffect } from 'react';
import { useApp } from '../lib/appContext';
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
import type { AppDevice } from '../types';

function deviceStatus(min: number, t: ReturnType<typeof useApp>['t']) {
  if (min < 60) return { variant: 'success' as const, label: t.online };
  if (min < 1440) return { variant: 'warning' as const, label: t.idle };
  return { variant: 'error' as const, label: t.offline };
}

function CopyField({ value }: { value: string }) {
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
    <button className="copybtn" onClick={copy} title="Copy" aria-label="Copy">
      <Icon name={done ? 'check' : 'content_copy'} />
    </button>
  );
}

type DialogState =
  | { type: 'add' }
  | { type: 'edit'; device: AppDevice }
  | { type: 'remove'; device: AppDevice }
  | null;

export function DevicesPage() {
  const app = useApp();
  const t = app.t;
  const [loading, setLoading] = useState(true);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ name: '', id: '' });

  useEffect(() => {
    const id = setTimeout(() => setLoading(false), 850);
    return () => clearTimeout(id);
  }, []);

  function openAdd() {
    setForm({ name: '', id: '' });
    setDialog({ type: 'add' });
  }

  function openEdit(d: AppDevice) {
    setForm({ name: d.name[app.lang] || d.name.en, id: d.id });
    setDialog({ type: 'edit', device: d });
  }

  function pair() {
    setBusy(true);
    setTimeout(() => {
      setBusy(false);
      const newDev: AppDevice = {
        id: form.id || 'ESP-' + Math.random().toString(16).slice(2, 8).toUpperCase(),
        name: { en: form.name || 'New display', da: form.name || 'Nyt display' },
        license:
          'DSPL-' +
          Math.random().toString(16).slice(2, 6).toUpperCase() +
          '-' +
          Math.random().toString(16).slice(2, 6).toUpperCase(),
        firmware: '1.0.0',
        lastSeenMin: 0,
      };
      app.setDevices([...app.devices, newDev]);
      setDialog(null);
      app.toast({ type: 'success', title: t.devicePaired });
    }, 1400);
  }

  function saveEdit() {
    if (!dialog || dialog.type !== 'edit') return;
    app.setDevices(
      app.devices.map((d) =>
        d.id === dialog.device.id
          ? { ...d, name: { en: form.name, da: form.name } }
          : d
      )
    );
    setDialog(null);
    app.toast({ type: 'success', title: t.profileSaved });
  }

  function confirmRemove() {
    if (!dialog || dialog.type !== 'remove') return;
    const name = dialog.device.name[app.lang] || dialog.device.name.en;
    app.setDevices(app.devices.filter((d) => d.id !== dialog.device.id));
    setDialog(null);
    app.toast({ type: 'info', title: t.remove + ' · ' + name });
  }

  const isAddOrEdit =
    dialog !== null && (dialog.type === 'add' || dialog.type === 'edit');
  const isRemove = dialog !== null && dialog.type === 'remove';

  return (
    <div className="page">
      <header className="page__head">
        <div className="row-between">
          <div>
            <h1 className="page__title">{t.devTitle}</h1>
            <p className="page__sub">{t.devSub}</p>
          </div>
          {!loading && app.devices.length > 0 && (
            <Button icon="add" onClick={openAdd}>
              {t.addDevice}
            </Button>
          )}
        </div>
      </header>

      <Card flat>
        {loading ? (
          <LoadBox text={t.loadingDevices} />
        ) : app.devices.length === 0 ? (
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
          app.devices.map((d) => {
            const st = deviceStatus(d.lastSeenMin, t);
            const devName = d.name[app.lang] || d.name.en;
            return (
              <div className="device" key={d.id}>
                <div className="device__glyph">
                  <Icon name="cast" />
                </div>
                <div style={{ minWidth: 0 }}>
                  <div className="device__name">
                    {devName}
                    <Chip variant={st.variant} dot>
                      {st.label}
                    </Chip>
                  </div>
                  <div className="device__rows">
                    <span className="device__kv">
                      {t.deviceId} <b>{d.id}</b>
                      <CopyField value={d.id} />
                    </span>
                    <span className="device__kv">
                      {t.license} <b>••••••••{d.license.slice(-4)}</b>
                      <CopyField value={d.license} />
                    </span>
                    <span className="device__kv">
                      {t.firmware} <b>v{d.firmware}</b>
                    </span>
                    <span className="device__kv">
                      {t.lastSeen} <b>{fmtAgo(d.lastSeenMin, app.lang)}</b>
                    </span>
                  </div>
                </div>
                <div className="device__actions">
                  <Button
                    variant="outlined"
                    size="sm"
                    icon="edit"
                    onClick={() => openEdit(d)}
                  >
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
        title={
          dialog && dialog.type === 'edit' ? t.edit : t.addDeviceTitle
        }
        icon="cast"
        footer={
          <>
            <Button variant="text" onClick={() => setDialog(null)}>
              {t.cancel}
            </Button>
            {dialog && dialog.type === 'edit' ? (
              <Button onClick={saveEdit}>{t.saveChanges}</Button>
            ) : (
              <Button onClick={pair} loading={busy}>
                {busy ? t.pairing : t.pair}
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
            <Field
              label={t.deviceId}
              htmlFor="di"
              helper={
                app.lang === 'da'
                  ? 'Står bag på dit display'
                  : 'Printed on the back of your display'
              }
            >
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
            <Button variant="danger" onClick={confirmRemove}>
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
