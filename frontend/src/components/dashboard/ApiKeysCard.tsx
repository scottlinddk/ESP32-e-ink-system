// =========================================================================
// ApiKeysCard.tsx — API keys manager
// =========================================================================
import React, { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useApp } from '../../lib/appContext';
import { useAuth } from '../../hooks/useAuth';
import { getApiKeys, saveApiKey, deleteApiKey } from '../../lib/api';
import { Card } from '../ui/card';
import { Button } from '../ui/button';
import { Field } from '../ui/Field';
import { PasswordInput } from '../ui/input';
import { Chip } from '../ui/Chip';
import { Dialog } from '../ui/Dialog';
import { Icon } from '../ui/Logo';

// Maps frontend service id → backend provider name
const PROVIDER_MAP: Record<string, string> = {
  openweather: 'openweathermap',
  newsapi: 'newsapi',
};

const SERVICES = [
  { id: 'openweather', name: 'OpenWeatherMap', url: 'openweathermap.org/api' },
  { id: 'newsapi', name: 'NewsAPI', url: 'newsapi.org' },
] as const;

export function ApiKeysCard() {
  const app = useApp();
  const t = app.t;
  const { getToken } = useAuth();
  const queryClient = useQueryClient();
  const [dialog, setDialog] = useState<string | null>(null);
  const [keyInput, setKeyInput] = useState('');
  const [err, setErr] = useState('');

  const { data } = useQuery({
    queryKey: ['api-keys'],
    queryFn: async () => {
      const token = await getToken();
      if (!token) throw new Error('Not authenticated');
      return getApiKeys(token);
    },
  });

  // Sync backend keys into appContext so PreviewCard can check connection status
  useEffect(() => {
    if (!data) return;
    const updated: Record<string, { status: string; key: string }> = {
      openweather: { status: 'none', key: '' },
      newsapi: { status: 'none', key: '' },
    };
    for (const k of data.api_keys) {
      const frontendId = k.provider === 'openweathermap' ? 'openweather' : k.provider;
      updated[frontendId] = { status: 'connected', key: k.api_key };
    }
    app.setApiKeys(updated);
  }, [data]);

  const saveMutation = useMutation({
    mutationFn: async ({ provider, key }: { provider: string; key: string }) => {
      const token = await getToken();
      if (!token) throw new Error('Not authenticated');
      return saveApiKey(token, provider, key);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['api-keys'] });
      setDialog(null);
      app.toast({ type: 'success', title: t.keySaved, msg: t.keySavedMsg });
    },
    onError: (e: Error) => {
      setErr(e.message);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (provider: string) => {
      const token = await getToken();
      if (!token) throw new Error('Not authenticated');
      return deleteApiKey(token, provider);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['api-keys'] });
      app.toast({ type: 'info', title: t.keyRemoved });
    },
    onError: (e: Error) => {
      app.toast({ type: 'error', title: e.message });
    },
  });

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
    const backendProvider = PROVIDER_MAP[dialog!] ?? dialog!;
    saveMutation.mutate({ provider: backendProvider, key: keyInput.trim() });
  }

  function removeKey(id: string) {
    const backendProvider = PROVIDER_MAP[id] ?? id;
    deleteMutation.mutate(backendProvider);
  }

  const connectedProviders = new Set(
    (data?.api_keys ?? []).map((k) =>
      k.provider === 'openweathermap' ? 'openweather' : k.provider
    )
  );

  const currentService = SERVICES.find((s) => s.id === dialog);

  return (
    <Card icon="key" title={t.apiTitle} desc={t.apiDesc}>
      <div className="stack">
        {SERVICES.map((svc) => {
          const connected = connectedProviders.has(svc.id);
          const maskedKey = data?.api_keys.find(
            (k) => (k.provider === 'openweathermap' ? 'openweather' : k.provider) === svc.id
          )?.api_key ?? '';

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
                      {maskedKey}
                    </code>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <Button variant="outlined" size="sm" onClick={() => openDialog(svc.id)}>
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
                      <a href={'https://' + svc.url} target="_blank" rel="noreferrer">
                        {svc.url}
                      </a>
                    </span>
                    <Button variant="outlined" size="sm" icon="add" onClick={() => openDialog(svc.id)}>
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
            <Button onClick={saveKey} loading={saveMutation.isPending}>
              {t.saveKey}
            </Button>
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
          helper={!err && currentService ? t.getKeyAt + ' ' + currentService.url : undefined}
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
