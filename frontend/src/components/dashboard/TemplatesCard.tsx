import React, { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../hooks/useAuth';
import { useApp } from '../../lib/appContext';
import { DisplayTemplate, exportDisplayTemplate, getStarterTemplates, importDisplayTemplate, validateDisplayTemplate } from '../../lib/api';
import { readTemplateFile } from '../../lib/templateFile';
import { Card } from '../ui/card';
import { Button } from '../ui/button';

const COPY = {
  en: {
    title: 'Layout templates', description: 'Back up your saved display settings or reuse a starter layout.',
    privacy: 'Exports contain layout and source settings, including weather coordinates. API keys, private feed URLs and device credentials are excluded.',
    export: 'Export settings', file: 'Review a JSON template', starter: 'Starter layouts', review: 'Review before applying',
    effect: 'Only the listed settings will be replaced. Existing credentials and other settings stay in place. Data sources may need credentials on this account.',
    apply: 'Apply template', cancel: 'Cancel', applied: 'Template applied', loading: 'Working…',
    ready: 'No changes are saved until you apply the reviewed template.', details: 'Settings to apply', exportFailed: 'Could not export settings',
    widgets: 'Widgets', settings: 'settings', on: 'on', off: 'off', defaultLayout: 'Default layout',
  },
  da: {
    title: 'Layoutskabeloner', description: 'Gem en kopi af dine displayindstillinger, eller brug et startlayout.',
    privacy: 'Eksporten indeholder layout og kildeindstillinger, herunder vejrkoordinater. API-nøgler, private feed-URL’er og enhedsoplysninger medtages ikke.',
    export: 'Eksportér indstillinger', file: 'Gennemse en JSON-skabelon', starter: 'Startlayouts', review: 'Gennemse før anvendelse',
    effect: 'Kun de viste indstillinger erstattes. Eksisterende legitimationsoplysninger og øvrige indstillinger bevares. Datakilder kan kræve legitimationsoplysninger på denne konto.',
    apply: 'Anvend skabelon', cancel: 'Annuller', applied: 'Skabelonen er anvendt', loading: 'Arbejder…',
    ready: 'Ingen ændringer gemmes, før du anvender den gennemgåede skabelon.', details: 'Indstillinger der anvendes', exportFailed: 'Kunne ikke eksportere indstillinger',
    widgets: 'Widgets', settings: 'indstillinger', on: 'til', off: 'fra', defaultLayout: 'Standardlayout',
  },
};

export function TemplatesCard() {
  const { getToken, user, isSignedIn } = useAuth();
  const { lang } = useApp();
  const copy = COPY[lang];
  const queryClient = useQueryClient();
  const [review, setReview] = useState<DisplayTemplate | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const pending = useRef<AbortController | undefined>(undefined);
  const fileInput = useRef<HTMLInputElement>(null);
  const starters = useQuery({
    queryKey: ['template-starters', user?.id], enabled: isSignedIn,
    queryFn: async () => { const token = await getToken(); if (!token) throw new Error('Sign in required'); return getStarterTemplates(token); },
    staleTime: Infinity,
  });
  useEffect(() => {
    pending.current?.abort();
    setReview(null); setError(null); setNotice(null); setBusy(false);
    return () => { pending.current?.abort(); };
  }, [user?.id]);

  async function checkTemplate(load: () => Promise<unknown>) {
    pending.current?.abort();
    const request = new AbortController();
    pending.current = request;
    setBusy(true); setReview(null); setError(null); setNotice(null);
    try {
      const value = await load();
      request.signal.throwIfAborted();
      const token = await getToken();
      if (!token) throw new Error('Sign in required');
      request.signal.throwIfAborted();
      const result = await validateDisplayTemplate(token, value, request.signal);
      if (!request.signal.aborted) setReview(result.template);
    } catch (err) {
      if (!request.signal.aborted) setError(err instanceof Error ? err.message : 'Invalid template');
    } finally { if (!request.signal.aborted) setBusy(false); }
  }

  async function download() {
    setBusy(true); setError(null); setNotice(null);
    try {
      const token = await getToken();
      if (!token) throw new Error('Sign in required');
      const template = await exportDisplayTemplate(token);
      const url = URL.createObjectURL(new Blob([JSON.stringify(template)], { type: 'application/json' }));
      const anchor = document.createElement('a');
      anchor.href = url; anchor.download = 'eink-display-template.json';
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch (err) { setError(err instanceof Error ? err.message : copy.exportFailed); }
    finally { setBusy(false); }
  }

  async function apply() {
    if (!review) return;
    setBusy(true); setError(null);
    try {
      const token = await getToken();
      if (!token) throw new Error('Sign in required');
      await importDisplayTemplate(token, review);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['preferences'] }),
        queryClient.invalidateQueries({ queryKey: ['preview'] }),
      ]);
      setReview(null); setNotice(copy.applied);
    } catch (err) { setError(err instanceof Error ? err.message : 'Import failed'); }
    finally { setBusy(false); }
  }

  return (
    <Card icon="file_copy" title={copy.title} desc={copy.description}>
      <div className="flex flex-col gap-3" aria-busy={busy}>
        <p className="text-xs text-fg2 m-0">{copy.privacy}</p>
        <div className="flex flex-wrap gap-2">
          <Button variant="outlined" size="sm" disabled={busy} onClick={download}>{copy.export}</Button>
          <Button variant="outlined" size="sm" disabled={busy} onClick={() => fileInput.current?.click()}>{copy.file}</Button>
          <input ref={fileInput} type="file" accept=".json,application/json" className="hidden" aria-label={copy.file}
            onChange={(event) => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ''; if (file) void checkTemplate(() => readTemplateFile(file)); }} />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-fg2">{copy.starter}</span>
          {starters.data?.templates.map((starter) => (
            <Button key={starter.id} size="sm" variant="text" disabled={busy} onClick={() => void checkTemplate(async () => starter.template)}>{starter.name}</Button>
          ))}
          {starters.isError && <Button variant="text" size="sm" onClick={() => void starters.refetch()}>Retry</Button>}
        </div>
        {busy && <p role="status" className="text-xs m-0">{copy.loading}</p>}
        {error && <p role="alert" className="text-xs text-warning m-0">{error}</p>}
        {notice && <p role="status" className="text-xs m-0">{notice}</p>}
        {review ? (
          <div className="border border-divider rounded-md p-3 flex flex-col gap-3">
            <strong className="text-sm">{copy.review}</strong>
            <p className="text-xs text-fg2 m-0">{copy.effect}</p>
            <p className="text-xs m-0">{Object.keys(review.settings).length} {copy.settings}
              {review.settings.layout && ` · ${copy.widgets}: ${review.settings.layout.widgets.map((widget) => widget.i).join(', ') || '—'}`}
            </p>
            <details>
              <summary className="text-xs cursor-pointer">{copy.details}</summary>
              <pre className="text-xs whitespace-pre-wrap break-all max-h-64 overflow-auto">{JSON.stringify(review.settings, null, 2)}</pre>
            </details>
            <div className="flex gap-2">
              <Button size="sm" disabled={busy} onClick={apply}>{copy.apply}</Button>
              <Button size="sm" variant="text" disabled={busy} onClick={() => setReview(null)}>{copy.cancel}</Button>
            </div>
          </div>
        ) : !busy && <p className="text-xs text-fg3 m-0">{copy.ready}</p>}
      </div>
    </Card>
  );
}
