// =========================================================================
// AccountPage.tsx
// =========================================================================
import React, { useState } from 'react';
import { useClerk } from '@clerk/react-router';
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
  const { signOut } = useClerk();
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
    <div className="max-w-[760px] mx-auto px-6 pt-8 pb-20 animate-page-enter">
      <header className="mb-5">
        <h1 className="text-[2rem] font-light tracking-tight m-0 mb-1.5">{t.accTitle}</h1>
        <p className="text-fg-2 text-base m-0">{t.accSub}</p>
      </header>

      <div className="flex flex-col gap-4">
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
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <div className="flex justify-between text-sm">
                <span className="text-fg-2">{t.apiCalls}</span>
                <span className="tabular-nums font-medium">
                  {usage.apiCalls} / {usage.apiLimit}
                </span>
              </div>
              <div className="h-2 rounded-full bg-[rgba(128,128,128,0.16)] overflow-hidden">
                <div
                  className="h-full rounded-full bg-accent transition-[width] duration-[375ms]"
                  style={{ width: callsPct + '%' }}
                />
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <div className="flex justify-between text-sm">
                <span className="text-fg-2">{t.devicesUsed}</span>
                <span className="tabular-nums font-medium">
                  {app.devices.length} / {usage.deviceLimit}
                </span>
              </div>
              <div className="h-2 rounded-full bg-[rgba(128,128,128,0.16)] overflow-hidden">
                <div
                  className="h-full rounded-full bg-accent transition-[width] duration-[375ms]"
                  style={{ width: devPct + '%' }}
                />
              </div>
            </div>
            <div className="flex items-center justify-between gap-4" style={{ marginTop: 4 }}>
              <span className="text-fg-2 text-sm">
                {t.plan}:{' '}
                <b style={{ color: 'var(--fg-1)', fontWeight: 500 }}>{t.planFree}</b>
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

        <Card
          className="border-error/40"
          flat
          icon="warning"
          title={t.dangerZone}
        >
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <p className="text-sm text-fg-2 m-0 leading-[1.55]" style={{ flex: 1, minWidth: 220 }}>
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
                signOut();
              }}
            >
              {t.deleteForever}
            </Button>
          </>
        }
      >
        <p className="text-sm text-fg-2 m-0 leading-[1.55] mb-4">
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
