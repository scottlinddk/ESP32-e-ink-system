// =========================================================================
// AccountPage.tsx
// =========================================================================
import React, { useState } from 'react';
import { useApp } from '../lib/appContext';
import { Card } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Field } from '../components/ui/Field';
import { Input } from '../components/ui/input';
import { Chip } from '../components/ui/Chip';
import { Dialog } from '../components/ui/Dialog';

export function AccountPage() {
  const app = useApp();
  const t = app.t;
  const [name, setName] = useState(app.user.name);
  const [saving, setSaving] = useState(false);
  const [delOpen, setDelOpen] = useState(false);
  const [confirmText, setConfirmText] = useState('');

  function saveProfile() {
    setSaving(true);
    setTimeout(() => {
      setSaving(false);
      app.setUser({ ...app.user, name });
      app.toast({ type: 'success', title: t.profileSaved });
    }, 1000);
  }

  const usage = app.usage;
  const callsPct = Math.round((usage.apiCalls / usage.apiLimit) * 100);
  const devPct = Math.round((app.devices.length / usage.deviceLimit) * 100);

  return (
    <div className="page" style={{ maxWidth: 760 }}>
      <header className="page__head">
        <h1 className="page__title">{t.accTitle}</h1>
        <p className="page__sub">{t.accSub}</p>
      </header>

      <div className="stack">
        <Card
          icon="person"
          title={t.profile}
          footer={
            <Button
              onClick={saveProfile}
              loading={saving}
              icon={saving ? undefined : 'save'}
            >
              {saving ? t.saving : t.saveChanges}
            </Button>
          }
        >
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: 16,
            }}
          >
            <Field label={t.name} htmlFor="acc-name">
              <Input
                id="acc-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </Field>
            <Field label={t.email} htmlFor="acc-email" helper={t.emailReadonly}>
              <Input
                id="acc-email"
                value={app.user.email}
                readOnly
                disabled
                style={{ opacity: 0.7 }}
              />
            </Field>
          </div>
        </Card>

        <Card
          icon="workspace_premium"
          title={t.subscription}
          action={<Chip variant="default">{t.planFree}</Chip>}
        >
          <div className="stack">
            <div className="usage">
              <div className="usage__row">
                <span className="label">{t.apiCalls}</span>
                <span className="val">
                  {usage.apiCalls} / {usage.apiLimit}
                </span>
              </div>
              <div className="usage__track">
                <div className="usage__fill" style={{ width: callsPct + '%' }} />
              </div>
            </div>
            <div className="usage">
              <div className="usage__row">
                <span className="label">{t.devicesUsed}</span>
                <span className="val">
                  {app.devices.length} / {usage.deviceLimit}
                </span>
              </div>
              <div className="usage__track">
                <div className="usage__fill" style={{ width: devPct + '%' }} />
              </div>
            </div>
            <div className="row-between" style={{ marginTop: 4 }}>
              <span className="muted">
                {t.plan}:{' '}
                <b style={{ color: 'var(--fg-1)' }}>{t.planFree}</b>
              </span>
              <Button
                variant="outlined"
                icon="rocket_launch"
                onClick={() => app.toast({ type: 'info', title: t.upgradeSoon })}
              >
                {t.upgrade}
              </Button>
            </div>
          </div>
        </Card>

        <Card className="danger-zone" flat icon="warning" title={t.dangerZone}>
          <div className="row-between" style={{ gap: 16, flexWrap: 'wrap' }}>
            <p className="dialog__text" style={{ flex: 1, minWidth: 220 }}>
              {t.deleteAccountText}
            </p>
            <Button
              variant="danger"
              icon="delete_forever"
              onClick={() => {
                setDelOpen(true);
                setConfirmText('');
              }}
            >
              {t.deleteAccount}
            </Button>
          </div>
        </Card>
      </div>

      <Dialog
        open={delOpen}
        onClose={() => setDelOpen(false)}
        title={t.deleteAccount}
        icon="delete_forever"
        danger
        footer={
          <>
            <Button variant="text" onClick={() => setDelOpen(false)}>
              {t.cancel}
            </Button>
            <Button
              variant="danger"
              disabled={confirmText !== 'DELETE'}
              onClick={() => {
                setDelOpen(false);
                app.signOut();
              }}
            >
              {t.deleteForever}
            </Button>
          </>
        }
      >
        <p className="dialog__text" style={{ marginBottom: 16 }}>
          {t.deleteAccountText}
        </p>
        <Field label={t.typeToConfirm} htmlFor="del">
          <Input
            id="del"
            mono
            value={confirmText}
            placeholder="DELETE"
            onChange={(e) => setConfirmText(e.target.value)}
          />
        </Field>
      </Dialog>
    </div>
  );
}
