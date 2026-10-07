import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../hooks/useAuth';
import { usePreferences, useSavePreferences } from '../../hooks/usePreferences';
import {
  createAiUsageToken, deleteAiUsageAdminKey, deleteAiUsageToken, getAiUsageStatus, saveAiUsageAdminKey, testAiUsage,
} from '../../lib/api';
import { useApp } from '../../lib/appContext';
import type { AiUsageData, AiUsageProvider } from '../../types';
import { Card } from '../ui/card';
import { Button } from '../ui/button';
import { Field } from '../ui/Field';
import { AiUsageAdminKeys } from './AiUsageAdminKeys';
import { AiUsageSetupGuide } from './AiUsageSetupGuide';

const PROVIDER_NAMES: Record<AiUsageProvider, string> = { claude: 'Claude', openai: 'OpenAI / Codex' };

export function AiUsageCard() {
  const { user } = useAuth();
  return <AiUsageCardContent key={user?.id ?? 'signed-out'} />;
}

function formatUsd(value: number | null): string {
  return value === null ? '–' : `$${value.toFixed(2)}`;
}

function AiUsageCardContent() {
  const { lang } = useApp();
  const da = lang === 'da';
  const locale = da ? 'da-DK' : 'en-GB';
  const { getToken, isSignedIn, user } = useAuth();
  const queryClient = useQueryClient();
  const preferences = usePreferences();
  const timeZone = preferences.data?.display_timezone ?? 'Europe/Copenhagen';
  const save = useSavePreferences();
  const active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [issuedToken, setIssuedToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<'token' | 'preferences' | 'key' | 'test' | ''>('');
  const [message, setMessage] = useState<'revoked' | 'saved' | 'key-saved' | 'key-removed' | ''>('');
  const [result, setResult] = useState<AiUsageData | null>(null);
  const statusKey = ['ai-usage', user?.id];
  const status = useQuery({
    queryKey: statusKey, enabled: isSignedIn && !!user?.id, refetchInterval: 60000,
    queryFn: async () => {
      const token = await getToken();
      if (!token) throw new Error(da ? 'Log ind igen' : 'Please sign in again');
      return getAiUsageStatus(token);
    },
  });
  const shown = enabled ?? preferences.data?.show_ai_usage ?? false;
  const disabled = !isSignedIn || !user?.id || busy;

  /** Runs one authenticated action with shared busy, error and refresh handling. */
  async function run(kind: NonNullable<typeof error>, action: (token: string) => Promise<void>) {
    if (disabled) return;
    setBusy(true); setError(''); setMessage('');
    try {
      const token = await getToken();
      if (!active.current) return;
      if (!token) throw new Error('Not authenticated');
      await action(token);
      await queryClient.invalidateQueries({ queryKey: statusKey });
      await queryClient.invalidateQueries({ queryKey: ['preview'] });
    } catch { if (active.current) setError(kind); }
    finally { if (active.current) setBusy(false); }
  }

  const issue = () => run('token', async (token) => { const created = await createAiUsageToken(token); if (active.current) setIssuedToken(created.token); });
  const revoke = () => run('token', async (token) => { await deleteAiUsageToken(token); if (active.current) { setIssuedToken(''); setMessage('revoked'); } });
  const saveKey = (provider: AiUsageProvider, key: string) => run('key', async (token) => { await saveAiUsageAdminKey(token, provider, key); if (active.current) setMessage('key-saved'); });
  const removeKey = (provider: AiUsageProvider) => run('key', async (token) => { await deleteAiUsageAdminKey(token, provider); if (active.current) setMessage('key-removed'); });
  const test = () => run('test', async (token) => { const tested = await testAiUsage(token); if (active.current) setResult(tested.aiUsage); });

  async function saveEnabled() {
    setError(''); setMessage('');
    try {
      await save.mutateAsync({ show_ai_usage: shown });
      if (active.current) { setEnabled(null); setMessage('saved'); }
    } catch { if (active.current) setError('preferences'); }
  }

  const when = (iso: string | null) => iso ? new Date(iso).toLocaleString(locale, { timeZone, dateStyle: 'short', timeStyle: 'short' }) : (da ? 'aldrig' : 'never');

  return <Card title={da ? 'AI-forbrug: Claude og ChatGPT/Codex' : 'AI usage: Claude and ChatGPT/Codex'} icon="token"
    desc={da ? 'Vis kvoter, tokens og pris for Claude Code og Codex på displayet. Serveren gemmer seneste rapport, så widgetten virker, selv når computeren er slukket.'
      : 'Show quota, tokens and cost for Claude Code and Codex on the display. The server keeps the latest report, so the widget works while your computer is off.'}>
    <div className="grid gap-4">
      {status.isLoading && <p role="status">{da ? 'Indlæser status…' : 'Loading status…'}</p>}
      {status.isError && <p role="alert">{da ? 'Kunne ikke indlæse status.' : 'Could not load status.'} <Button variant="text" onClick={() => status.refetch()}>{da ? 'Prøv igen' : 'Retry'}</Button></p>}
      {status.data && <div className="text-sm text-fg2 grid gap-1">
        <p className="m-0">{status.data.configured ? (da ? 'Indsamler-token aktiv' : 'Collector token active') : (da ? 'Ingen indsamler-token' : 'No collector token')}
          {status.data.receivedAt && <> · {da ? 'sidst modtaget' : 'last received'} {when(status.data.receivedAt)}</>}</p>
        {(['claude', 'openai'] as const).map((provider) => {
          const report = status.data.reports[provider];
          if (!report.limitsObservedAt && !report.machines.length && !status.data.adminKeys[provider]) return null;
          return <p key={provider} className="m-0">
            <strong>{PROVIDER_NAMES[provider]}</strong>: {da ? 'kvote' : 'quota'} {when(report.limitsObservedAt)}
            {report.machines.length > 0 && <> · {report.machines.map((machine) => `${machine.name} (${machine.day})`).join(', ')}</>}
            {status.data.adminKeys[provider] && <> · Admin API</>}
          </p>;
        })}
      </div>}

      <div className="flex gap-2 flex-wrap">
        <Button disabled={disabled || !status.data} onClick={issue}>{status.data?.configured ? (da ? 'Udskift token' : 'Replace token') : (da ? 'Opret token' : 'Create token')}</Button>
        <Button variant="outlined" disabled={disabled || !status.data?.configured} onClick={revoke}>{da ? 'Tilbagekald token' : 'Revoke token'}</Button>
        <Button variant="text" disabled={disabled} onClick={test}>{da ? 'Test nu' : 'Test now'}</Button>
      </div>
      <p className="text-xs text-fg2 m-0">{da ? 'Udskiftning eller tilbagekaldelse stopper de gamle indsamlere og sletter de gemte rapporter.' : 'Replacing or revoking the token stops existing collectors and clears the stored reports.'}</p>
      {issuedToken && <Field label={da ? 'Ny indsamler-token' : 'New collector token'} htmlFor="ai-usage-token"
        helper={da ? 'Kopiér den nu ind i indsamlerens init-kommando. Den vises kun én gang.' : 'Copy it now into the collector’s init command. It is shown once.'}>
        <input id="ai-usage-token" type="text" readOnly value={issuedToken} autoComplete="off" spellCheck={false}
          className="w-full font-mono text-xs border border-border rounded-md p-2 bg-surface" onFocus={(event) => event.target.select()} />
        <Button variant="text" size="sm" onClick={() => setIssuedToken('')}>{da ? 'Skjul token' : 'Hide token'}</Button>
      </Field>}

      {result && <div className="text-sm border border-border rounded-md p-3 grid gap-1" role="status">
        {result.providers.length === 0 && <p className="m-0">{da ? 'Ingen data endnu. Kør indsamleren eller gem en Admin API-nøgle.' : 'No data yet. Run the collector or save an Admin API key.'}</p>}
        {result.providers.map((provider) => <p key={provider.provider} className="m-0">
          <strong>{provider.label}</strong>
          {provider.limits.map((limit) => ` · ${limit.label} ${limit.usedPercent === null ? (da ? 'nulstillet' : 'reset') : `${Math.round(limit.usedPercent)}%`}`).join('')}
          {provider.today && ` · ${da ? 'i dag' : 'today'} ${provider.today.tokens.toLocaleString(locale)} tokens ≈ ${formatUsd(provider.today.costUsd)}${provider.today.partial ? '+' : ''}`}
          {provider.monthCostUsd !== null && ` · ${da ? 'måned' : 'month'} ${formatUsd(provider.monthCostUsd)}`}
          {provider.adminError && <span className="text-error"> · {provider.adminError.message}</span>}
        </p>)}
        <p className="m-0 text-xs text-fg2">{da ? '≈ er et skøn ud fra offentlige API-priser. Månedsbeløbet er den faktiske API-regning.' : '≈ is an estimate at public API prices. The month is the actual API bill.'}</p>
      </div>}

      <AiUsageAdminKeys da={da} configured={status.data?.adminKeys} disabled={disabled || !status.data} onSave={saveKey} onRemove={removeKey} />

      <fieldset disabled={disabled || save.isPending || !preferences.data} className="border-0 p-0 m-0 grid gap-3">
        <label className="flex gap-2 items-center"><input type="checkbox" checked={shown} onChange={(event) => setEnabled(event.target.checked)} /> {da ? 'Vis AI-forbrug på displayet' : 'Show AI usage on the display'}</label>
        <Button onClick={saveEnabled} loading={save.isPending}>{da ? 'Gem' : 'Save'}</Button>
      </fieldset>
      <p className="text-sm text-fg2 m-0">{da ? 'Aktivér, gem, og tilføj ' : 'Enable, save, and add '}<strong>{da ? 'AI-forbrug' : 'AI usage'}</strong>{da ? ' i ' : ' in the '}<Link to="/layout" className="underline">{da ? 'layouteditoren' : 'layout editor'}</Link>.</p>

      <AiUsageSetupGuide da={da} timeZone={timeZone} />
      <a className="text-sm underline" href="https://github.com/scottlinddk/ESP32-e-ink-system/blob/main/docs/AI_USAGE.md" target="_blank" rel="noreferrer">{da ? 'Teknisk vejledning og HTTP-format' : 'Technical guide and HTTP contract'}</a>

      {message && <p role="status" className="text-sm m-0">{{
        revoked: da ? 'Token tilbagekaldt og rapporter slettet.' : 'Token revoked and reports cleared.',
        saved: da ? 'Indstilling gemt.' : 'Setting saved.',
        'key-saved': da ? 'Admin API-nøgle gemt krypteret.' : 'Admin API key saved encrypted.',
        'key-removed': da ? 'Admin API-nøgle fjernet.' : 'Admin API key removed.',
      }[message]}</p>}
      {error && <p role="alert" className="text-error m-0">{{
        token: da ? 'Kunne ikke opdatere token. Log ind igen om nødvendigt.' : 'Could not update the token. Sign in again if needed.',
        preferences: da ? 'Kunne ikke gemme indstillingen.' : 'Could not save the setting.',
        key: da ? 'Nøglen blev afvist. Brug en Admin API-nøgle.' : 'The key was rejected. Use an Admin API key.',
        test: da ? 'Testen mislykkedes. Prøv igen om et minut.' : 'The test failed. Try again in a minute.',
      }[error]}</p>}
    </div>
  </Card>;
}
