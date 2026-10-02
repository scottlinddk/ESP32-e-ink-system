import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../hooks/useAuth';
import { usePreferences, useSavePreferences } from '../../hooks/usePreferences';
import { createCustomWebhookToken, deleteCustomWebhookToken, getCustomWebhookStatus } from '../../lib/api';
import { Card } from '../ui/card';
import { Button } from '../ui/button';
import { Field } from '../ui/Field';

export function CustomWebhookCard() {
  const { getToken, isSignedIn, user } = useAuth();
  const queryClient = useQueryClient();
  const preferences = usePreferences();
  const timezone = preferences.data?.display_timezone ?? 'Europe/Copenhagen';
  const save = useSavePreferences();
  const dirty = useRef(false);
  const [enabled, setEnabled] = useState(false);
  const [ttl, setTtl] = useState('60');
  const [issuedToken, setIssuedToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const status = useQuery({
    queryKey: ['custom-webhook', user?.id], enabled: isSignedIn && !!user?.id, refetchInterval: 60000,
    queryFn: async () => {
      const token = await getToken();
      if (!token) throw new Error('Not authenticated');
      return getCustomWebhookStatus(token);
    },
  });
  useEffect(() => {
    if (preferences.data && !dirty.current) {
      setEnabled(preferences.data.show_custom_webhook ?? false);
      setTtl(String(preferences.data.custom_webhook_ttl_minutes ?? 60));
    }
  }, [preferences.data]);

  const disabled = busy || save.isPending || preferences.isLoading || preferences.isError || !preferences.data;
  async function tokenAction(action: 'issue' | 'revoke') {
    setBusy(true); setError(''); setMessage('');
    try {
      const token = await getToken();
      if (!token) throw new Error('Not authenticated');
      if (action === 'issue') {
        setIssuedToken((await createCustomWebhookToken(token)).token);
      } else {
        await deleteCustomWebhookToken(token);
        setIssuedToken('');
        setMessage('Token revoked and previous sensor data cleared.');
      }
      await queryClient.invalidateQueries({ queryKey: ['custom-webhook'] });
      await queryClient.invalidateQueries({ queryKey: ['preview'] });
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Could not update the token.'); }
    finally { setBusy(false); }
  }
  async function saveSettings() {
    const minutes = Number(ttl);
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 1440) { setError('Choose a whole number from 1 to 1440 minutes.'); return; }
    setError(''); setMessage('');
    try {
      await save.mutateAsync({ show_custom_webhook: enabled, custom_webhook_ttl_minutes: minutes });
      dirty.current = false;
      await queryClient.invalidateQueries({ queryKey: ['custom-webhook'] });
      setMessage('Sensor display settings saved.');
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Could not save sensor settings.'); }
  }

  return <Card title="Home Assistant and custom sensors" icon="sensors" desc="Send sensor readings to your display with a dedicated integration token.">
    <div className="grid gap-4">
      {status.isLoading && <p role="status">Loading integration status…</p>}
      {status.isError && <p role="alert">Could not load integration status. <Button variant="text" onClick={() => status.refetch()}>Retry</Button></p>}
      {status.data && <div className="text-sm text-fg2">
        <p className="m-0">{status.data.configured ? 'Token active' : 'No active token'} · {status.data.state === 'fresh' ? 'Readings are fresh' : status.data.state === 'stale' ? 'Readings are stale' : 'Waiting for readings'}</p>
        {status.data.observedAt && <p className="m-0 mt-1">Observed {new Date(status.data.observedAt).toLocaleString(undefined, { timeZone: timezone })} · {timezone} · {status.data.rowCount} rows</p>}
      </div>}
      <div className="flex gap-2 flex-wrap">
        <Button disabled={busy || status.isLoading || status.isError} onClick={() => tokenAction('issue')}>
          {status.data?.configured ? 'Replace token' : 'Create token'}
        </Button>
        <Button variant="outlined" disabled={busy || !status.data?.configured} onClick={() => tokenAction('revoke')}>Revoke token</Button>
        <Button variant="text" disabled={busy} onClick={() => status.refetch()}>Refresh status</Button>
      </div>
      <p className="text-xs text-fg2 m-0">Replacing or revoking a token stops the old integration and clears its previous readings.</p>
      {issuedToken && <Field label="New integration token" htmlFor="custom-webhook-token" helper="Copy it now into your integration's secrets. It is shown once and is not stored in this browser.">
        <input id="custom-webhook-token" type="text" readOnly value={issuedToken} autoComplete="off" spellCheck={false} className="w-full font-mono text-xs border border-border rounded-md p-2 bg-surface" onFocus={(event) => event.target.select()} />
        <Button variant="text" size="sm" onClick={() => setIssuedToken('')}>Hide token</Button>
      </Field>}
      {preferences.isError && <p role="alert">Could not load saved sensor settings. <Button variant="text" onClick={() => preferences.refetch()}>Retry</Button></p>}
      <fieldset disabled={disabled} className="border-0 p-0 m-0 grid gap-3">
        <label className="flex gap-2 items-center"><input type="checkbox" checked={enabled} onChange={(event) => { dirty.current = true; setEnabled(event.target.checked); }} /> Show sensor readings</label>
        <Field label="Mark readings stale after (minutes)" htmlFor="custom-webhook-ttl">
          <input id="custom-webhook-ttl" type="number" min={1} max={1440} step={1} value={ttl} onChange={(event) => { dirty.current = true; setTtl(event.target.value); }} className="w-full border border-border rounded-md p-2 bg-surface" />
        </Field>
        <Button onClick={saveSettings} loading={save.isPending}>Save sensor settings</Button>
      </fieldset>
      <p className="text-sm text-fg2 m-0">Send a JSON POST to <code>/api/custom-webhook/ingest</code> with your token in the <code>Authorization: Bearer …</code> header. Add <strong>Custom sensors</strong> in the <Link to="/layout" className="underline">layout editor</Link>.</p>
      <a className="text-sm underline" href="https://github.com/scottlinddk/ESP32-e-ink-system/blob/main/docs/CUSTOM_WEBHOOK.md" target="_blank" rel="noreferrer">Setup and Home Assistant example</a>
      {message && <p role="status" className="text-sm m-0">{message}</p>}
      {error && <p role="alert" className="text-error m-0">{error}</p>}
    </div>
  </Card>;
}
