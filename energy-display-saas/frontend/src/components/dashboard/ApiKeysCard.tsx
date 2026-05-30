// =========================================================================
// ApiKeysCard.tsx — API keys manager
// =========================================================================
import React, { useState } from 'react';
import { useApp } from '../../lib/appContext';
import { Card } from '../ui/card';
import { Button } from '../ui/button';
import { Field } from '../ui/Field';
import { PasswordInput } from '../ui/input';
import { Chip } from '../ui/Chip';
import { Dialog } from '../ui/Dialog';
import { Icon } from '../ui/Logo';

const SERVICES = [
  { id: 'openweather', name: 'OpenWeatherMap', url: 'openweathermap.org/api', needs: 'weather' },
  { id: 'newsapi', name: 'NewsAPI', url: 'newsapi.org', needs: 'news' },
] as const;

function maskKey(k: string): string {
  return '••••••••••••' + (k ? k.slice(-4) : '');
}

export function ApiKeysCard() {
  const app = useApp();
  const t = app.t;
  const [dialog, setDialog] = useState<string | null>(null);
  const [keyInput, setKeyInput] = useState('');
  const [err, setErr] = useState('');

  function openDialog(id: string) {
    setDialog(id);
    setKeyInput('');
    setErr('');
  }

  function saveKey() {
    if (keyInput.trim().length < 16) {
      setErr(t.keyInvalidLen);
      return;
    }
    const svc = dialog!;
    app.setApiKeys({
      ...app.apiKeys,
      [svc]: { status: 'connected', key: keyInput.trim() },
    });
    setDialog(null);
    app.toast({ type: 'success', title: t.keySaved, msg: t.keySavedMsg });
  }

  function removeKey(id: string) {
    app.setApiKeys({ ...app.apiKeys, [id]: { status: 'none', key: '' } });
    app.toast({ type: 'info', title: t.keyRemoved });
  }

  const currentService = SERVICES.find((s) => s.id === dialog);

  return (
    <Card icon="key" title={t.apiTitle} desc={t.apiDesc}>
      <div className="stack">
        {SERVICES.map((svc) => {
          const st = app.apiKeys[svc.id] ?? { status: 'none', key: '' };
          const connected = st.status === 'connected';
          return (
            <div
              key={svc.id}
              className="card card--flat"
              style={{ borderColor: 'var(--color-border)' }}
            >
              <div className="card__body" style={{ padding: '14px 16px' }}>
                <div className="row-between" style={{ marginBottom: 10 }}>
                  <div style={{ fontWeight: 500 }}>{svc.name}</div>
                  {connected ? (
                    <Chip variant="success" dot>
                      {t.statusConnected}
                    </Chip>
                  ) : (
                    <Chip variant="error" dot>
                      {t.statusNotConfigured}
                    </Chip>
                  )}
                </div>
                {connected ? (
                  <div className="row-between">
                    <code
                      className="mono"
                      style={{
                        fontSize: 13,
                        background: 'rgba(128,128,128,0.1)',
                        padding: '6px 10px',
                        borderRadius: 4,
                      }}
                    >
                      {maskKey(st.key)}
                    </code>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <Button
                        variant="outlined"
                        size="sm"
                        onClick={() => openDialog(svc.id)}
                      >
                        {t.updateKey}
                      </Button>
                      <Button variant="text" size="sm" onClick={() => removeKey(svc.id)}>
                        {t.removeKey}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="row-between">
                    <span className="helper">
                      <Icon name="link" />
                      {t.getKeyAt}{' '}
                      <a
                        href={'https://' + svc.url}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {svc.url}
                      </a>
                    </span>
                    <Button
                      variant="outlined"
                      size="sm"
                      icon="add"
                      onClick={() => openDialog(svc.id)}
                    >
                      {t.addKey}
                    </Button>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <Dialog
        open={!!dialog}
        onClose={() => setDialog(null)}
        title={t.keyDialogTitle}
        icon="key"
        footer={
          <>
            <Button variant="text" onClick={() => setDialog(null)}>
              {t.cancel}
            </Button>
            <Button onClick={saveKey}>{t.saveKey}</Button>
          </>
        }
      >
        <p className="dialog__text" style={{ marginBottom: 16 }}>
          {t.keyDialogText}
        </p>
        <Field
          label={
            currentService
              ? currentService.name + ' ' + t.apiKeyLabel.toLowerCase()
              : t.apiKeyLabel
          }
          htmlFor="keyin"
          error={err}
          helper={
            !err && currentService
              ? t.getKeyAt + ' ' + currentService.url
              : undefined
          }
        >
          <PasswordInput
            id="keyin"
            value={keyInput}
            lang={app.lang}
            placeholder={t.keyPh}
            onChange={(e) => {
              setKeyInput(e.target.value);
              if (err) setErr('');
            }}
          />
        </Field>
      </Dialog>
    </Card>
  );
}
