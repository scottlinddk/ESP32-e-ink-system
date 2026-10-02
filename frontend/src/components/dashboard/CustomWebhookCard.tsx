import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../hooks/useAuth';
import { usePreferences, useSavePreferences } from '../../hooks/usePreferences';
import { createCustomWebhookToken, deleteCustomWebhookToken, getCustomWebhookStatus } from '../../lib/api';
import { useApp } from '../../lib/appContext';
import { homeAssistantSetup } from '../../lib/homeAssistantSetup';
import { Card } from '../ui/card';
import { Button } from '../ui/button';
import { Field } from '../ui/Field';

export function CustomWebhookCard() {
  const { user } = useAuth();
  return <CustomWebhookCardContent key={user?.id ?? 'signed-out'} />;
}

function CustomWebhookCardContent() {
  const { lang } = useApp();
  const da = lang === 'da';
  const { getToken, isSignedIn, user } = useAuth();
  const queryClient = useQueryClient();
  const preferences = usePreferences();
  const timezone = preferences.data?.display_timezone ?? 'Europe/Copenhagen';
  const save = useSavePreferences();
  const dirty = useRef(false);
  const active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const [enabled, setEnabled] = useState(false);
  const [ttl, setTtl] = useState('60');
  const [issuedToken, setIssuedToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<'token' | 'preferences' | 'ttl' | ''>('');
  const [message, setMessage] = useState<'revoked' | 'saved' | ''>('');
  const setup = homeAssistantSetup(typeof window === 'undefined' ? undefined : window.location.origin);
  const status = useQuery({
    queryKey: ['custom-webhook', user?.id], enabled: isSignedIn && !!user?.id, refetchInterval: 60000,
    queryFn: async () => {
      const token = await getToken();
      if (!active.current) throw new Error('Cancelled');
      if (!token) throw new Error(da ? 'Log ind igen' : 'Please sign in again');
      return getCustomWebhookStatus(token);
    },
  });
  useEffect(() => {
    if (preferences.data && !dirty.current) {
      setEnabled(preferences.data.show_custom_webhook ?? false);
      setTtl(String(preferences.data.custom_webhook_ttl_minutes ?? 60));
    }
  }, [preferences.data]);

  const disabled = !isSignedIn || !user?.id || busy || save.isPending || preferences.isLoading || preferences.isError || !preferences.data;
  const tokenDisabled = !isSignedIn || !user?.id || busy || status.isLoading || status.isError || !status.data;
  async function tokenAction(action: 'issue' | 'revoke') {
    if (tokenDisabled) return;
    setBusy(true); setError(''); setMessage('');
    try {
      const token = await getToken();
      if (!active.current) return;
      if (!token) throw new Error('Not authenticated');
      if (action === 'issue') {
        const result = await createCustomWebhookToken(token);
        if (!active.current) return;
        setIssuedToken(result.token);
      } else {
        await deleteCustomWebhookToken(token);
        if (!active.current) return;
        setIssuedToken('');
        setMessage('revoked');
      }
      await queryClient.invalidateQueries({ queryKey: ['custom-webhook', user?.id] });
      await queryClient.invalidateQueries({ queryKey: ['preview'] });
    } catch { if (active.current) setError('token'); }
    finally { if (active.current) setBusy(false); }
  }
  async function saveSettings() {
    if (disabled) return;
    const minutes = Number(ttl);
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 1440) { setError('ttl'); return; }
    setError(''); setMessage('');
    try {
      await save.mutateAsync({ show_custom_webhook: enabled, custom_webhook_ttl_minutes: minutes });
      if (!active.current) return;
      dirty.current = false;
      await queryClient.invalidateQueries({ queryKey: ['custom-webhook', user?.id] });
      if (active.current) setMessage('saved');
    } catch { if (active.current) setError('preferences'); }
  }

  return <Card title={da ? 'Home Assistant og egne sensorer' : 'Home Assistant and custom sensors'} icon="sensors"
    desc={da ? 'Send målinger til widgeten Custom sensors med en særskilt integrationstoken.' : 'Send readings to the Custom sensors widget with a dedicated integration token.'}>
    <div className="grid gap-4">
      {status.isLoading && <p role="status">{da ? 'Indlæser integrationsstatus…' : 'Loading integration status…'}</p>}
      {status.isError && <p role="alert">{da ? 'Kunne ikke indlæse integrationsstatus.' : 'Could not load integration status.'} <Button variant="text" onClick={() => status.refetch()}>{da ? 'Prøv igen' : 'Retry'}</Button></p>}
      {status.data && <div className="text-sm text-fg2">
        <p className="m-0">{status.data.configured ? (da ? 'Token aktiv' : 'Token active') : (da ? 'Ingen aktiv token' : 'No active token')} · {status.data.state === 'fresh' ? (da ? 'Målingerne er friske' : 'Readings are fresh') : status.data.state === 'stale' ? (da ? 'Målingerne er forældede' : 'Readings are stale') : (da ? 'Venter på målinger' : 'Waiting for readings')}</p>
        {status.data.observedAt && <p className="m-0 mt-1">{da ? 'Målt' : 'Observed'} {new Date(status.data.observedAt).toLocaleString(da ? 'da-DK' : 'en-GB', { timeZone: timezone })} · {timezone} · {status.data.rowCount} {da ? 'rækker' : 'rows'}</p>}
      </div>}
      <div className="flex gap-2 flex-wrap">
        <Button disabled={tokenDisabled} onClick={() => tokenAction('issue')}>
          {status.data?.configured ? (da ? 'Udskift token' : 'Replace token') : (da ? 'Opret token' : 'Create token')}
        </Button>
        <Button variant="outlined" disabled={tokenDisabled || !status.data?.configured} onClick={() => tokenAction('revoke')}>{da ? 'Tilbagekald token' : 'Revoke token'}</Button>
        <Button variant="text" disabled={busy || !isSignedIn || !user?.id} onClick={() => status.refetch()}>{da ? 'Opdatér status' : 'Refresh status'}</Button>
      </div>
      <p className="text-xs text-fg2 m-0">{da ? 'Udskiftning eller tilbagekaldelse stopper den gamle integration og sletter dens tidligere målinger.' : 'Replacing or revoking a token stops the old integration and clears its previous readings.'}</p>
      {issuedToken && <Field label={da ? 'Ny integrationstoken' : 'New integration token'} htmlFor="custom-webhook-token"
        helper={da ? 'Kopiér den nu til integrationens secrets. Den vises kun én gang og gemmes ikke i browseren.' : 'Copy it now into your integration’s secrets. It is shown once and is not stored in this browser.'}>
        <input id="custom-webhook-token" type="text" readOnly value={issuedToken} autoComplete="off" spellCheck={false} className="w-full font-mono text-xs border border-border rounded-md p-2 bg-surface" onFocus={(event) => event.target.select()} />
        <Button variant="text" size="sm" onClick={() => setIssuedToken('')}>{da ? 'Skjul token' : 'Hide token'}</Button>
      </Field>}
      {preferences.isError && <p role="alert">{da ? 'Kunne ikke indlæse sensorindstillinger.' : 'Could not load saved sensor settings.'} <Button variant="text" onClick={() => preferences.refetch()}>{da ? 'Prøv igen' : 'Retry'}</Button></p>}
      <fieldset disabled={disabled} className="border-0 p-0 m-0 grid gap-3">
        <label className="flex gap-2 items-center"><input type="checkbox" checked={enabled} onChange={(event) => { dirty.current = true; setEnabled(event.target.checked); }} /> {da ? 'Vis sensormålinger' : 'Show sensor readings'}</label>
        <Field label={da ? 'Markér målinger som forældede efter (minutter)' : 'Mark readings stale after (minutes)'} htmlFor="custom-webhook-ttl">
          <input id="custom-webhook-ttl" type="number" min={1} max={1440} step={1} value={ttl} onChange={(event) => { dirty.current = true; setTtl(event.target.value); }} className="w-full border border-border rounded-md p-2 bg-surface" />
        </Field>
        <Button onClick={saveSettings} loading={save.isPending}>{da ? 'Gem sensorindstillinger' : 'Save sensor settings'}</Button>
      </fieldset>
      <p className="text-sm text-fg2 m-0">{da ? 'Aktivér kilden ovenfor, gem, og tilføj ' : 'Enable the source above, save, and add '}<strong>Custom sensors</strong>{da ? ' i ' : ' in the '}<Link to="/layout" className="underline">{da ? 'layouteditoren' : 'layout editor'}</Link>{da ? '. Webhooken sender nye målinger til serveren; skærmen ændres ved næste hentning eller Bluetooth-overførsel.' : '. The webhook updates the server readings; the screen changes on its next fetch or Bluetooth transfer.'}</p>
      <details className="border border-border rounded-md p-3">
        <summary className="cursor-pointer font-medium text-sm">{da ? 'Opsæt Home Assistant trin for trin' : 'Set up Home Assistant step by step'}</summary>
        <div className="grid gap-3 mt-3 text-sm">
          <p className="m-0">{da ? 'Home Assistant sender målinger ud til denne app. Du behøver ikke gøre Home Assistant offentligt tilgængelig.' : 'Home Assistant sends readings to this app. You do not need to expose Home Assistant publicly.'}</p>
          <Field label={da ? 'Modtageradresse (JSON POST)' : 'Ingest endpoint (JSON POST)'} htmlFor="custom-webhook-endpoint">
            <input id="custom-webhook-endpoint" type="text" readOnly value={setup.endpoint} className="w-full font-mono text-xs border border-border rounded-md p-2 bg-surface" onFocus={(event) => event.target.select()} />
          </Field>
          {setup.needsHttpsHost && <p className="text-xs text-warning m-0">{da ? 'Du bruger localhost eller en usikker adresse. Erstat YOUR-DISPLAY-HOST med din udrullede apps HTTPS-adresse, som Home Assistant kan nå. Brug ikke localhost eller Vites proxyadresse.' : 'This is localhost or an insecure address. Replace YOUR-DISPLAY-HOST with your deployed app’s HTTPS address reachable from Home Assistant. Do not use localhost or the Vite proxy address.'}</p>}
          <p className="m-0">{da ? '1. Opret en token ovenfor. Tilføj dette i secrets.yaml, og indsæt din integrationstoken i stedet for pladsholderen. Brug ikke dit login-token.' : '1. Create a token above. Add this to secrets.yaml and replace the token placeholder with your integration token. Do not use your sign-in token.'}</p>
          <pre className="overflow-x-auto text-xs bg-surface p-3 rounded-md"><code>{setup.secrets}</code></pre>
          <p className="m-0">{da ? '2. Tilføj kommandoen i configuration.yaml, og udskift sensorernes entity-ID’er med dine egne. Flet med en eksisterende rest_command-sektion; opret ikke samme YAML-nøgle to gange.' : '2. Add the command to configuration.yaml and replace the sensor entity IDs with your own. Merge with an existing rest_command section; do not duplicate YAML keys.'}</p>
          <pre className="overflow-x-auto text-xs bg-surface p-3 rounded-md"><code>{setup.restCommand}</code></pre>
          <p className="m-0">{da ? '3. Tilføj denne regel i automations.yaml, og genstart derefter Home Assistant. Den sender hvert femte minut; vælg en levetid over fem minutter ovenfor.' : '3. Add this rule to automations.yaml, then restart Home Assistant. It sends every five minutes; choose a freshness lifetime longer than five minutes above.'}</p>
          <pre className="overflow-x-auto text-xs bg-surface p-3 rounded-md"><code>{setup.automation}</code></pre>
          <p className="m-0">{da ? '4. Kør rest_command.update_eink_sensors i Home Assistants udviklerværktøjer/handlinger. Tryk derefter Opdatér status her. Friske målinger vises i widgeten efter næste skærmopdatering.' : '4. Run rest_command.update_eink_sensors in Home Assistant’s developer tools/actions. Then choose Refresh status here. Fresh readings appear in the widget after the next display refresh.'}</p>
          <p className="m-0 text-xs">{da ? 'Payloaden indeholder 1–12 rækker med entydige etiketter. Værdier skal være tekst. JSON-filteret undgår fejl ved anførselstegn i sensorværdier.' : 'The payload contains 1–12 rows with unique labels. Values must be strings. The JSON filter safely handles quotes in sensor values.'}</p>
          <div className="flex flex-wrap gap-3 text-xs">
            <a className="underline" href="https://www.home-assistant.io/integrations/rest_command/" target="_blank" rel="noreferrer">{da ? 'Home Assistant: REST-kommandoer' : 'Home Assistant: REST commands'}</a>
            <a className="underline" href="https://www.home-assistant.io/docs/configuration/secrets/" target="_blank" rel="noreferrer">{da ? 'YAML-hemmeligheder' : 'YAML secrets'}</a>
            <a className="underline" href="https://www.home-assistant.io/docs/automation/trigger/#time-pattern-trigger" target="_blank" rel="noreferrer">{da ? 'Tidsstyrede udløsere' : 'Time-pattern triggers'}</a>
          </div>
        </div>
      </details>
      <a className="text-sm underline" href="https://github.com/scottlinddk/ESP32-e-ink-system/blob/main/docs/CUSTOM_WEBHOOK.md" target="_blank" rel="noreferrer">{da ? 'Teknisk vejledning og HTTP-format' : 'Technical guide and HTTP contract'}</a>
      {message && <p role="status" className="text-sm m-0">{message === 'revoked' ? (da ? 'Token tilbagekaldt og tidligere målinger slettet.' : 'Token revoked and previous sensor data cleared.') : (da ? 'Sensorindstillinger gemt.' : 'Sensor display settings saved.')}</p>}
      {error && <p role="alert" className="text-error m-0">{error === 'ttl'
        ? (da ? 'Vælg et helt tal fra 1 til 1440 minutter.' : 'Choose a whole number from 1 to 1440 minutes.')
        : error === 'token' ? (da ? 'Kunne ikke opdatere token. Kontrollér forbindelsen, og log ind igen om nødvendigt.' : 'Could not update the token. Check your connection and sign in again if needed.')
        : (da ? 'Kunne ikke gemme sensorindstillinger.' : 'Could not save sensor settings.')}</p>}
    </div>
  </Card>;
}
