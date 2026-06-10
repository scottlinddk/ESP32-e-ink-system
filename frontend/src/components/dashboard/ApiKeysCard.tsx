// =========================================================================
// ApiKeysCard.tsx — API keys manager
// =========================================================================
import React, { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useApp } from '../../lib/appContext';
import { useAuth } from '../../hooks/useAuth';
import { getApiKeys, saveApiKey, deleteApiKey, saveEvCredentials, getEvCredentialStatus, deleteEvCredentials } from '../../lib/api';
import { Card } from '../ui/card';
import { Button } from '../ui/button';
import { Field } from '../ui/Field';
import { Input, PasswordInput } from '../ui/input';
import { Chip } from '../ui/Chip';
import { Dialog } from '../ui/Dialog';
import { Icon } from '../ui/Logo';
import { OAuthConnectCard } from './OAuthConnectCard';

const PROVIDER_MAP: Record<string, string> = {
  openweather: 'openweathermap',
  newsapi: 'newsapi',
};

interface OAuthAppSectionProps {
  provider: 'strava' | 'google';
}

function OAuthAppSection({ provider }: OAuthAppSectionProps) {
  const app = useApp();
  const t = app.t;
  const { getToken } = useAuth();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [err, setErr] = useState('');
  const [copied, setCopied] = useState(false);

  const { data } = useQuery({
    queryKey: ['api-keys'],
    queryFn: async () => {
      const token = await getToken();
      if (!token) throw new Error('Not authenticated');
      return getApiKeys(token);
    },
  });

  const configured =
    (data?.api_keys ?? []).some((k) => k.provider === `${provider}_client_id`) &&
    (data?.api_keys ?? []).some((k) => k.provider === `${provider}_client_secret`);

  const redirectUri =
    `${window.location.origin}/api/oauth/${provider === 'google' ? 'google_calendar' : 'strava'}/callback`;

  const saveMutation = useMutation({
    mutationFn: async () => {
      const token = await getToken();
      if (!token) throw new Error('Not authenticated');
      await Promise.all([
        saveApiKey(token, `${provider}_client_id`, clientId.trim()),
        saveApiKey(token, `${provider}_client_secret`, clientSecret.trim()),
      ]);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['api-keys'] });
      setOpen(false);
      app.toast({ type: 'success', title: t.oauthAppSaved, msg: t.oauthAppSavedMsg });
    },
    onError: (e: Error) => { setErr(e.message); },
  });

  const removeMutation = useMutation({
    mutationFn: async () => {
      const token = await getToken();
      if (!token) throw new Error('Not authenticated');
      await Promise.all([
        deleteApiKey(token, `${provider}_client_id`),
        deleteApiKey(token, `${provider}_client_secret`),
      ]);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['api-keys'] });
      app.toast({ type: 'info', title: t.keyRemoved });
    },
  });

  function openDialog() { setClientId(''); setClientSecret(''); setErr(''); setOpen(true); }

  function validate() {
    if (!clientId.trim()) { setErr('Client ID is required.'); return false; }
    if (!clientSecret.trim()) { setErr('Client Secret is required.'); return false; }
    return true;
  }

  function copyUri() {
    navigator.clipboard.writeText(redirectUri).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  const title = provider === 'strava' ? t.oauthAppStravaTitle : t.oauthAppGoogleTitle;
  const desc = provider === 'strava' ? t.oauthAppStravaDesc : t.oauthAppGoogleDesc;

  return (
    <div className="bg-surface rounded-md border border-border px-4 py-3.5">
      <div className="flex items-center justify-between mb-2.5">
        <div className="font-medium">{title}</div>
        <Chip variant={configured ? 'success' : 'error'} dot>
          {configured ? t.oauthAppConfigured : t.oauthAppNotConfigured}
        </Chip>
      </div>
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <span className="text-xs text-fg3">{desc}</span>
        <div className="flex gap-2">
          <Button variant="outlined" size="sm" icon="edit" onClick={openDialog}>
            {configured ? t.updateKey : t.addKey}
          </Button>
          {configured && (
            <Button
              variant="text"
              size="sm"
              onClick={() => removeMutation.mutate()}
              loading={removeMutation.isPending}
            >
              {t.oauthAppRemove}
            </Button>
          )}
        </div>
      </div>

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={title}
        icon="key"
        footer={
          <>
            <Button variant="text" onClick={() => setOpen(false)}>{t.cancel}</Button>
            <Button onClick={() => { if (validate()) saveMutation.mutate(); }} loading={saveMutation.isPending}>
              {t.oauthAppSave}
            </Button>
          </>
        }
      >
        <p className="text-xs text-fg3 mb-4">{t.oauthAppSecretWarning}</p>
        <Field label={t.oauthAppRedirectUri} htmlFor={`${provider}-redirect-uri`}>
          <div className="flex gap-2">
            <Input
              id={`${provider}-redirect-uri`}
              mono
              readOnly
              value={redirectUri}
              className="flex-1 bg-black/[0.06] cursor-default select-all"
            />
            <Button variant="outlined" size="sm" onClick={copyUri}>
              {copied ? t.copiedUri : t.copyUri}
            </Button>
          </div>
        </Field>
        <Field label={t.oauthAppClientId} htmlFor={`${provider}-cid`} error={err}>
          <Input
            id={`${provider}-cid`}
            mono
            value={clientId}
            placeholder="12345"
            onChange={(e) => { setClientId(e.target.value); setErr(''); }}
          />
        </Field>
        <Field label={t.oauthAppClientSecret} htmlFor={`${provider}-cs`}>
          <PasswordInput
            id={`${provider}-cs`}
            lang={app.lang}
            value={clientSecret}
            placeholder="••••••••••••••••"
            onChange={(e) => { setClientSecret(e.target.value); setErr(''); }}
          />
        </Field>
      </Dialog>
    </div>
  );
}

const SERVICES = [
  { id: 'openweather', name: 'OpenWeatherMap', url: 'openweathermap.org/api' },
  { id: 'newsapi', name: 'NewsAPI', url: 'newsapi.org' },
] as const;

interface EvCredentialsSectionProps {
  provider: 'monta' | 'zaptec';
}

function EvCredentialsSection({ provider }: EvCredentialsSectionProps) {
  const app = useApp();
  const t = app.t;
  const { getToken } = useAuth();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [err, setErr] = useState('');

  const statusKey = ['ev-credentials', provider];
  const { data: status } = useQuery({
    queryKey: statusKey,
    queryFn: async () => {
      const token = await getToken();
      if (!token) throw new Error('Not authenticated');
      return getEvCredentialStatus(token, provider);
    },
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      const token = await getToken();
      if (!token) throw new Error('Not authenticated');
      return saveEvCredentials(token, provider, fields);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: statusKey });
      setOpen(false);
      app.toast({ type: 'success', title: t.evCredSaved, msg: t.evCredSavedMsg });
    },
    onError: (e: Error) => { setErr(e.message); },
  });

  const removeMutation = useMutation({
    mutationFn: async () => {
      const token = await getToken();
      if (!token) throw new Error('Not authenticated');
      return deleteEvCredentials(token, provider);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: statusKey });
      app.toast({ type: 'info', title: t.keyRemoved });
    },
  });

  function openDialog() {
    setFields({});
    setErr('');
    setOpen(true);
  }

  function validate(): boolean {
    if (provider === 'monta') {
      if (!fields.clientId?.trim() || !fields.clientSecret?.trim()) {
        setErr('Both Client ID and Client Secret are required.');
        return false;
      }
    } else {
      if (!fields.username?.trim() || !fields.password?.trim()) {
        setErr('Both username and password are required.');
        return false;
      }
    }
    return true;
  }

  function save() {
    if (!validate()) return;
    saveMutation.mutate();
  }

  const configured = status?.configured ?? false;
  const isMonta = provider === 'monta';
  const title = isMonta ? t.montaCredTitle : t.zaptecCredTitle;
  const desc = isMonta ? t.montaCredDesc : t.zaptecCredDesc;

  return (
    <div className="bg-surface rounded-md border border-border px-4 py-3.5">
      <div className="flex items-center justify-between mb-2.5">
        <div className="font-medium">{title}</div>
        <Chip variant={configured ? 'success' : 'error'} dot>
          {configured ? t.evCredConfigured : t.evCredNotConfigured}
        </Chip>
      </div>
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <span className="text-xs text-fg3">{desc}</span>
        <div className="flex gap-2">
          <Button variant="outlined" size="sm" icon="edit" onClick={openDialog}>
            {configured ? t.updateKey : t.addKey}
          </Button>
          {configured && (
            <Button
              variant="text"
              size="sm"
              onClick={() => removeMutation.mutate()}
              loading={removeMutation.isPending}
            >
              {t.evCredRemove}
            </Button>
          )}
        </div>
      </div>

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={title}
        icon="key"
        footer={
          <>
            <Button variant="text" onClick={() => setOpen(false)}>{t.cancel}</Button>
            <Button onClick={save} loading={saveMutation.isPending}>{t.evCredSave}</Button>
          </>
        }
      >
        <p className="text-sm text-fg2 m-0 leading-[1.55] mb-4">{desc}</p>
        {isMonta ? (
          <>
            <Field label={t.montaClientId} htmlFor="monta-cid" error={err}>
              <Input
                id="monta-cid"
                mono
                value={fields.clientId ?? ''}
                placeholder="client_xxxxxxxxxxxxxxxx"
                onChange={(e) => { setFields((f) => ({ ...f, clientId: e.target.value })); setErr(''); }}
              />
            </Field>
            <Field label={t.montaClientSecret} htmlFor="monta-cs">
              <PasswordInput
                id="monta-cs"
                lang={app.lang}
                value={fields.clientSecret ?? ''}
                placeholder="secret_xxxxxxxxxxxxxxxx"
                onChange={(e) => { setFields((f) => ({ ...f, clientSecret: e.target.value })); setErr(''); }}
              />
            </Field>
          </>
        ) : (
          <>
            <Field label={t.zaptecUsername} htmlFor="zaptec-user" error={err}>
              <Input
                id="zaptec-user"
                value={fields.username ?? ''}
                placeholder="you@example.com"
                onChange={(e) => { setFields((f) => ({ ...f, username: e.target.value })); setErr(''); }}
              />
            </Field>
            <Field label={t.zaptecPassword} htmlFor="zaptec-pw">
              <PasswordInput
                id="zaptec-pw"
                lang={app.lang}
                value={fields.password ?? ''}
                placeholder="••••••••"
                onChange={(e) => { setFields((f) => ({ ...f, password: e.target.value })); setErr(''); }}
              />
            </Field>
          </>
        )}
      </Dialog>
    </div>
  );
}

function NotionCredentialsSection() {
  const app = useApp();
  const t = app.t;
  const { getToken } = useAuth();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [err, setErr] = useState('');

  const statusKey = ['ev-credentials', 'notion'];
  const { data: status } = useQuery({
    queryKey: statusKey,
    queryFn: async () => {
      const token = await getToken();
      if (!token) throw new Error('Not authenticated');
      return getEvCredentialStatus(token, 'notion');
    },
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      const token = await getToken();
      if (!token) throw new Error('Not authenticated');
      return saveEvCredentials(token, 'notion', fields);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: statusKey });
      setOpen(false);
      app.toast({ type: 'success', title: t.evCredSaved, msg: t.evCredSavedMsg });
    },
    onError: (e: Error) => { setErr(e.message); },
  });

  const removeMutation = useMutation({
    mutationFn: async () => {
      const token = await getToken();
      if (!token) throw new Error('Not authenticated');
      return deleteEvCredentials(token, 'notion');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: statusKey });
      app.toast({ type: 'info', title: t.keyRemoved });
    },
  });

  function validate(): boolean {
    if (!fields.token?.trim()) { setErr('Integration token is required.'); return false; }
    if (!fields.token.startsWith('secret_')) { setErr('Token must start with "secret_".'); return false; }
    if (!fields.databaseId?.trim()) { setErr('Database ID is required.'); return false; }
    return true;
  }

  function openDialog() { setFields({}); setErr(''); setOpen(true); }

  const configured = status?.configured ?? false;

  return (
    <div className="bg-surface rounded-md border border-border px-4 py-3.5">
      <div className="flex items-center justify-between mb-2.5">
        <div className="font-medium">{t.notionCredTitle}</div>
        <Chip variant={configured ? 'success' : 'error'} dot>
          {configured ? t.evCredConfigured : t.evCredNotConfigured}
        </Chip>
      </div>
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <span className="text-xs text-fg3">{t.notionCredDesc}</span>
        <div className="flex gap-2">
          <Button variant="outlined" size="sm" icon="edit" onClick={openDialog}>
            {configured ? t.updateKey : t.addKey}
          </Button>
          {configured && (
            <Button variant="text" size="sm" onClick={() => removeMutation.mutate()} loading={removeMutation.isPending}>
              {t.evCredRemove}
            </Button>
          )}
        </div>
      </div>

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={t.notionCredTitle}
        icon="auto_stories"
        footer={
          <>
            <Button variant="text" onClick={() => setOpen(false)}>{t.cancel}</Button>
            <Button onClick={() => { if (validate()) saveMutation.mutate(); }} loading={saveMutation.isPending}>{t.evCredSave}</Button>
          </>
        }
      >
        <p className="text-xs text-fg3 mb-4">{t.notionTokenWarning}</p>
        <Field label={t.notionToken} htmlFor="notion-token" error={err}>
          <PasswordInput
            id="notion-token"
            lang={app.lang}
            value={fields.token ?? ''}
            placeholder={t.notionTokenPh}
            onChange={(e) => { setFields((f) => ({ ...f, token: e.target.value })); setErr(''); }}
          />
        </Field>
        <Field label={t.notionDatabaseId} htmlFor="notion-dbid">
          <Input
            id="notion-dbid"
            mono
            value={fields.databaseId ?? ''}
            placeholder={t.notionDatabaseIdPh}
            onChange={(e) => { setFields((f) => ({ ...f, databaseId: e.target.value })); }}
          />
        </Field>
        <Field label={t.notionStatusProp} htmlFor="notion-status-prop">
          <Input
            id="notion-status-prop"
            value={fields.statusProperty ?? ''}
            placeholder={t.notionStatusPropPh}
            onChange={(e) => { setFields((f) => ({ ...f, statusProperty: e.target.value })); }}
          />
        </Field>
        <Field label={t.notionFilterStatus} htmlFor="notion-filter">
          <Input
            id="notion-filter"
            value={fields.filterStatus ?? ''}
            placeholder={t.notionFilterStatusPh}
            onChange={(e) => { setFields((f) => ({ ...f, filterStatus: e.target.value })); }}
          />
        </Field>
      </Dialog>
    </div>
  );
}

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
    onError: (e: Error) => { setErr(e.message); },
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
    onError: (e: Error) => { app.toast({ type: 'error', title: e.message }); },
  });

  function openDialog(id: string) { setDialog(id); setKeyInput(''); setErr(''); }

  function saveKey() {
    if (keyInput.trim().length < 16) { setErr(t.keyInvalidLen); return; }
    const backendProvider = PROVIDER_MAP[dialog!] ?? dialog!;
    saveMutation.mutate({ provider: backendProvider, key: keyInput.trim() });
  }

  function removeKey(id: string) {
    const backendProvider = PROVIDER_MAP[id] ?? id;
    deleteMutation.mutate(backendProvider);
  }

  const connectedProviders = new Set(
    (data?.api_keys ?? []).map((k) => k.provider === 'openweathermap' ? 'openweather' : k.provider)
  );

  const currentService = SERVICES.find((s) => s.id === dialog);

  return (
    <Card icon="key" title={t.apiTitle} desc={t.apiDesc}>
      <div className="flex flex-col gap-4">
        <OAuthAppSection provider="strava" />
        <OAuthConnectCard
          provider="strava"
          name="Strava"
          icon="directions_run"
          connectHint={t.stravaConnectHint}
        />
        <OAuthAppSection provider="google" />
        <OAuthConnectCard
          provider="google_calendar"
          name="Google Calendar"
          icon="calendar_month"
          connectHint={t.gcalConnectHint}
        />
        <EvCredentialsSection provider="monta" />
        <EvCredentialsSection provider="zaptec" />
        <NotionCredentialsSection />
        {SERVICES.map((svc) => {
          const connected = connectedProviders.has(svc.id);
          const maskedKey = data?.api_keys.find(
            (k) => (k.provider === 'openweathermap' ? 'openweather' : k.provider) === svc.id
          )?.api_key ?? '';

          return (
            <div key={svc.id} className="bg-surface rounded-md border border-border px-4 py-3.5">
              <div className="flex items-center justify-between mb-2.5">
                <div className="font-medium">{svc.name}</div>
                <Chip variant={connected ? 'success' : 'error'} dot>
                  {connected ? t.statusConnected : t.statusNotConfigured}
                </Chip>
              </div>
              {connected ? (
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <code className="text-[13px] bg-black/[0.10] px-2.5 py-1.5 rounded-sm font-mono text-fg1">
                    {maskedKey}
                  </code>
                  <div className="flex gap-2">
                    <Button variant="outlined" size="sm" onClick={() => openDialog(svc.id)}>{t.updateKey}</Button>
                    <Button variant="text" size="sm" onClick={() => removeKey(svc.id)}>{t.removeKey}</Button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <span className="text-xs text-fg3 flex items-center gap-[5px] [&_.material-symbols-outlined]:text-[15px]">
                    <Icon name="link" />
                    {t.getKeyAt}{' '}
                    <a href={'https://' + svc.url} target="_blank" rel="noreferrer" className="text-info hover:underline">
                      {svc.url}
                    </a>
                  </span>
                  <Button variant="outlined" size="sm" icon="add" onClick={() => openDialog(svc.id)}>{t.addKey}</Button>
                </div>
              )}
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
            <Button variant="text" onClick={() => setDialog(null)}>{t.cancel}</Button>
            <Button onClick={saveKey} loading={saveMutation.isPending}>{t.saveKey}</Button>
          </>
        }
      >
        <p className="text-sm text-fg2 m-0 leading-[1.55] mb-4">{t.keyDialogText}</p>
        <Field
          label={currentService ? currentService.name + ' ' + t.apiKeyLabel.toLowerCase() : t.apiKeyLabel}
          htmlFor="keyin"
          error={err}
          helper={!err && currentService ? t.getKeyAt + ' ' + currentService.url : undefined}
        >
          <PasswordInput
            id="keyin"
            value={keyInput}
            lang={app.lang}
            placeholder={t.keyPh}
            onChange={(e) => { setKeyInput(e.target.value); if (err) setErr(''); }}
          />
        </Field>
      </Dialog>
    </Card>
  );
}
