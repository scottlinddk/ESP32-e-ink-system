// =========================================================================
// AccountPage.tsx
// =========================================================================
import React, { useState } from 'react';
import { useClerk } from '@clerk/clerk-react';
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
    <div className="max-w-[760px] mx-auto px-6 pt-6 pb-20 animate-fade-up max-[820px]:px-4 max-[820px]:pt-5 max-[820px]:pb-16">
      <header className="mb-5">
        <h1 className="text-h2 font-light tracking-tight m-0 mb-1.5">{t.accTitle}</h1>
        <p className="text-fg2 text-body m-0">{t.accSub}</p>
      </header>

      <div className="flex flex-col gap-4">
        <Card
          icon="person"
          title={t.profile}
          footer={
            <Button onClick={saveProfile} loading={saving} icon={saving ? undefined : 'save'}>
              {saving ? t.saving : t.saveChanges}
            </Button>
          }
        >
          <div className="grid grid-cols-2 gap-4 max-[560px]:grid-cols-1">
            <Field label={t.name} htmlFor="acc-name">
              <Input id="acc-name" value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
            <Field label={t.email} htmlFor="acc-email" helper={t.emailReadonly}>
              <Input id="acc-email" value={app.user.email} readOnly disabled className="opacity-70" />
            </Field>
          </div>
        </Card>

        <Card
          icon="workspace_premium"
          title={t.subscription}
          action={<Chip variant="default">{t.planFree}</Chip>}
        >
          <div className="flex flex-col gap-4">
            {[
              { label: t.apiCalls, current: usage.apiCalls, max: usage.apiLimit, pct: callsPct },
              { label: t.devicesUsed, current: app.devices.length, max: usage.deviceLimit, pct: devPct },
            ].map((row) => (
              <div key={row.label} className="flex flex-col gap-1.5">
                <div className="flex justify-between text-sm">
                  <span className="text-fg2">{row.label}</span>
                  <span className="tabular-nums font-medium">{row.current} / {row.max}</span>
                </div>
                <div className="h-2 rounded-pill bg-black/[0.16] overflow-hidden">
                  <div className="h-full rounded-pill bg-accent transition-[width] duration-[375ms]" style={{ width: `${row.pct}%` }} />
                </div>
              </div>
            ))}
            <div className="flex items-center justify-between gap-4 mt-1">
              <span className="text-fg2 text-sm">
                {t.plan}: <b className="text-fg1 font-normal">{t.planFree}</b>
              </span>
              <Button variant="outlined" icon="rocket_launch" onClick={() => app.toast({ type: 'info', title: t.upgradeSoon })}>
                {t.upgrade}
              </Button>
            </div>
          </div>
        </Card>

        <Card
          flat
          className="border-error/40 [&>header]:border-error/20 [&_h2]:text-error"
          icon="warning"
          title={t.dangerZone}
        >
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <p className="text-sm text-fg2 m-0 leading-[1.55] flex-1 min-w-[220px]">
              {t.deleteAccountText}
            </p>
            <Button
              variant="danger"
              icon="delete_forever"
              onClick={() => { setDelOpen(true); setConfirmText(''); }}
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
            <Button variant="text" onClick={() => setDelOpen(false)}>{t.cancel}</Button>
            <Button
              variant="danger"
              disabled={confirmText !== 'DELETE'}
              onClick={() => { setDelOpen(false); signOut(); }}
            >
              {t.deleteForever}
            </Button>
          </>
        }
      >
        <p className="text-sm text-fg2 m-0 leading-[1.55] mb-4">{t.deleteAccountText}</p>
        <Field label={t.typeToConfirm} htmlFor="del">
          <Input id="del" mono value={confirmText} placeholder="DELETE" onChange={(e) => setConfirmText(e.target.value)} />
        </Field>
      </Dialog>
    </div>
  );
}
