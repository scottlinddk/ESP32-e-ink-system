// =========================================================================
// ApiKeysCard.tsx — API keys manager
// =========================================================================
import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useApp } from '../../lib/appContext';
import { useAuth } from '../../hooks/useAuth';
import { useApiKeys } from '../../hooks/usePreferences';
import { notionCredentialsForSave } from '../../lib/notionCredentials';
import { saveApiKey, deleteApiKey, saveEvCredentials, getEvCredentialStatus, deleteEvCredentials } from '../../lib/api';
import { Card } from '../ui/card';
import { Button } from '../ui/button';
import { Field } from '../ui/Field';
import { Input, PasswordInput } from '../ui/input';
import { Chip } from '../ui/Chip';
import { Dialog } from '../ui/Dialog';
import { Icon } from '../ui/Logo';
const PROVIDER_MAP: Record<string, string> = {
  openweather: 'openweathermap',
  newsapi: 'newsapi',
};

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
  const { getToken, user, isSignedIn } = useAuth();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [err, setErr] = useState('');

  const statusKey = ['ev-credentials', provider, user?.id];
  const statusQuery = useQuery({
    queryKey: statusKey,
    enabled: isSignedIn && !!user?.id,
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
      queryClient.invalidateQueries({ queryKey: ['preview'] });
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
      queryClient.invalidateQueries({ queryKey: ['preview'] });
      app.toast({ type: 'info', title: t.keyRemoved });
    },
  });

  function openDialog() {
    if (disabled) return;
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
    if (disabled || !validate()) return;
    saveMutation.mutate();
  }

  const configured = statusQuery.data?.configured ?? false;
  const known = isSignedIn && !!user?.id && statusQuery.data !== undefined && !statusQuery.isPending && !statusQuery.isError;
  const disabled = !known || saveMutation.isPending || removeMutation.isPending;
  const isMonta = provider === 'monta';
  const title = isMonta ? t.montaCredTitle : t.zaptecCredTitle;
  const desc = isMonta ? t.montaCredDesc : t.zaptecCredDesc;

  return (
    <div id={`credentials-${provider}`} className="bg-surface rounded-md border border-border px-4 py-3.5 scroll-mt-20">
      <div className="flex items-center justify-between mb-2.5">
        <div className="font-medium">{title}</div>
        <Chip variant={!known ? 'default' : configured ? 'success' : 'error'} dot>
          {!known ? (statusQuery.isError ? (app.lang === 'da' ? 'Kunne ikke indlæse status' : 'Could not load status') : (app.lang === 'da' ? 'Indlæser…' : 'Loading…')) : configured ? t.evCredConfigured : t.evCredNotConfigured}
        </Chip>
      </div>
      {statusQuery.isError && <Button variant="text" size="sm" disabled={!isSignedIn || statusQuery.isFetching} onClick={() => void statusQuery.refetch()}>{app.lang === 'da' ? 'Prøv igen' : 'Retry'}</Button>}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <span className="text-xs text-fg3">{desc}</span>
        <div className="flex gap-2">
          <Button variant="outlined" size="sm" icon="edit" onClick={openDialog} disabled={disabled}>
            {configured ? t.updateKey : t.addKey}
          </Button>
          {configured && (
            <Button
              variant="text"
              size="sm"
              onClick={() => { if (!disabled) removeMutation.mutate(); }}
              disabled={disabled}
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
            <Button onClick={save} disabled={disabled} loading={saveMutation.isPending}>{t.evCredSave}</Button>
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
  const { getToken, user, isSignedIn } = useAuth();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [err, setErr] = useState('');

  const statusKey = ['ev-credentials', 'notion', user?.id];
  const statusQuery = useQuery({
    queryKey: statusKey,
    enabled: isSignedIn && !!user?.id,
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
      return saveEvCredentials(token, 'notion', notionCredentialsForSave(fields));
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: statusKey });
      queryClient.invalidateQueries({ queryKey: ['preview'] });
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
      queryClient.invalidateQueries({ queryKey: ['preview'] });
      app.toast({ type: 'info', title: t.keyRemoved });
    },
  });

  function validate(): boolean {
    try { notionCredentialsForSave(fields); return true; }
    catch (error) {
      const code = error instanceof Error ? error.message : '';
      setErr(code === 'token' ? t.notionInvalidToken : code === 'database' ? t.notionInvalidDatabase
        : code === 'source' ? t.notionInvalidSource : code === 'filter' ? t.notionInvalidFilter : t.notionInvalidProperty);
      return false;
    }
  }

  function openDialog() { if (disabled) return; setFields({}); setErr(''); setOpen(true); }

  const configured = statusQuery.data?.configured ?? false;
  const known = isSignedIn && !!user?.id && statusQuery.data !== undefined && !statusQuery.isPending && !statusQuery.isError;
  const disabled = !known || saveMutation.isPending || removeMutation.isPending;

  return (
    <div id="credentials-notion" className="bg-surface rounded-md border border-border px-4 py-3.5 scroll-mt-20">
      <div className="flex items-center justify-between mb-2.5">
        <div className="font-medium">{t.notionCredTitle}</div>
        <Chip variant={!known ? 'default' : configured ? 'success' : 'error'} dot>
          {!known ? (statusQuery.isError ? (app.lang === 'da' ? 'Kunne ikke indlæse status' : 'Could not load status') : (app.lang === 'da' ? 'Indlæser…' : 'Loading…')) : configured ? t.evCredConfigured : t.evCredNotConfigured}
        </Chip>
      </div>
      {statusQuery.isError && <Button variant="text" size="sm" disabled={!isSignedIn || statusQuery.isFetching} onClick={() => void statusQuery.refetch()}>{app.lang === 'da' ? 'Prøv igen' : 'Retry'}</Button>}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <span className="text-xs text-fg3">{t.notionCredDesc}</span>
        <div className="flex gap-2">
          <Button variant="outlined" size="sm" icon="edit" onClick={openDialog} disabled={disabled}>
            {configured ? t.updateKey : t.addKey}
          </Button>
          {configured && (
            <Button variant="text" size="sm" disabled={disabled} onClick={() => { if (!disabled) removeMutation.mutate(); }} loading={removeMutation.isPending}>
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
            <Button onClick={() => { if (!disabled && validate()) saveMutation.mutate(); }} disabled={disabled} loading={saveMutation.isPending}>{t.evCredSave}</Button>
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
            maxLength={2048}
            mono
            value={fields.databaseId ?? ''}
            placeholder={t.notionDatabaseIdPh}
            onChange={(e) => { setFields((f) => ({ ...f, databaseId: e.target.value })); }}
          />
        </Field>
        <Field label={t.notionDataSourceId} htmlFor="notion-source-id" helper={t.notionDataSourceHelp}>
          <Input id="notion-source-id" mono maxLength={36} value={fields.dataSourceId ?? ''}
            placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
            onChange={(event) => setFields((current) => ({ ...current, dataSourceId: event.target.value }))} />
        </Field>
        <Field label={t.notionStatusProp} htmlFor="notion-status-prop">
          <Input
            id="notion-status-prop"
            maxLength={100}
            value={fields.statusProperty ?? ''}
            placeholder={t.notionStatusPropPh}
            onChange={(e) => { setFields((f) => ({ ...f, statusProperty: e.target.value })); }}
          />
        </Field>
        <Field label={t.notionFilterStatus} htmlFor="notion-filter">
          <Input
            id="notion-filter"
            maxLength={100}
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
  const { getToken, user, isSignedIn } = useAuth();
  const queryClient = useQueryClient();
  const [dialog, setDialog] = useState<string | null>(null);
  const [keyInput, setKeyInput] = useState('');
  const [err, setErr] = useState('');

  const statusQuery = useApiKeys();
  const { data } = statusQuery;
  const known = isSignedIn && !!user?.id && data !== undefined && !statusQuery.isPending && !statusQuery.isError;

  const saveMutation = useMutation({
    mutationFn: async ({ provider, key }: { provider: string; key: string }) => {
      const token = await getToken();
      if (!token) throw new Error('Not authenticated');
      return saveApiKey(token, provider, key);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['api-keys'] });
      queryClient.invalidateQueries({ queryKey: ['preview'] });
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
      queryClient.invalidateQueries({ queryKey: ['preview'] });
      app.toast({ type: 'info', title: t.keyRemoved });
    },
    onError: (e: Error) => { app.toast({ type: 'error', title: e.message }); },
  });

  const disabled = !known || saveMutation.isPending || deleteMutation.isPending;

  function openDialog(id: string) { if (disabled) return; setDialog(id); setKeyInput(''); setErr(''); }

  function saveKey() {
    if (disabled || !dialog) return;
    if (keyInput.trim().length < 16) { setErr(t.keyInvalidLen); return; }
    const backendProvider = PROVIDER_MAP[dialog!] ?? dialog!;
    saveMutation.mutate({ provider: backendProvider, key: keyInput.trim() });
  }

  function removeKey(id: string) {
    if (disabled) return;
    const backendProvider = PROVIDER_MAP[id] ?? id;
    deleteMutation.mutate(backendProvider);
  }

  const connectedProviders = new Set(
    (data ?? []).map((k) => k.provider === 'openweathermap' ? 'openweather' : k.provider)
  );

  const currentService = SERVICES.find((s) => s.id === dialog);

  return (
    <Card icon="key" title={t.apiTitle} desc={t.apiDesc}>
      <div className="flex flex-col gap-4">
        <EvCredentialsSection provider="monta" />
        <EvCredentialsSection provider="zaptec" />
        <NotionCredentialsSection />
        {SERVICES.map((svc) => {
          const connected = connectedProviders.has(svc.id);
          const maskedKey = data?.find(
            (k) => (k.provider === 'openweathermap' ? 'openweather' : k.provider) === svc.id
          )?.api_key ?? '';

          return (
            <div id={`credentials-${svc.id}`} key={svc.id} className="bg-surface rounded-md border border-border px-4 py-3.5 scroll-mt-20">
              <div className="flex items-center justify-between mb-2.5">
                <div className="font-medium">{svc.name}</div>
                <Chip variant={!known ? 'default' : connected ? 'success' : 'error'} dot>
                  {!known ? (statusQuery.isError ? (app.lang === 'da' ? 'Kunne ikke indlæse status' : 'Could not load status') : (app.lang === 'da' ? 'Indlæser…' : 'Loading…')) : connected ? t.keyConfigured : t.statusNotConfigured}
                </Chip>
              </div>
              {statusQuery.isError && <Button variant="text" size="sm" disabled={!isSignedIn || statusQuery.isFetching} onClick={() => void statusQuery.refetch()}>{app.lang === 'da' ? 'Prøv igen' : 'Retry'}</Button>}
              {svc.id === 'openweather' && <p className="text-xs text-fg2 mt-0 mb-3">{t.weatherKeyHelp}</p>}
              {connected ? (
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <code className="text-[13px] bg-black/[0.10] px-2.5 py-1.5 rounded-sm font-mono text-fg1">
                    {maskedKey}
                  </code>
                  <div className="flex gap-2">
                    <Button variant="outlined" size="sm" disabled={disabled} onClick={() => openDialog(svc.id)}>{t.updateKey}</Button>
                    <Button variant="text" size="sm" disabled={disabled} onClick={() => removeKey(svc.id)}>{t.removeKey}</Button>
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
                  <Button variant="outlined" size="sm" icon="add" disabled={disabled} onClick={() => openDialog(svc.id)}>{t.addKey}</Button>
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
            <Button onClick={saveKey} disabled={disabled} loading={saveMutation.isPending}>{t.saveKey}</Button>
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
