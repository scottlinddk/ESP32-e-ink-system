// =========================================================================
// PreviewCard.tsx — live e-ink preview card
// =========================================================================
import React, { useState, useEffect, useRef, ReactNode } from 'react';
import { useApp } from '../../lib/appContext';
import { useAuth } from '../../hooks/useAuth';
import { Card } from '../ui/card';
import { Button } from '../ui/button';
import { Spinner } from '../ui/Spinner';
import { Icon } from '../ui/Logo';
import { EInk } from '../eink/EInk';
import { einkContent } from '../../lib/mockData';
import { fetchPreviewBmp } from '../../lib/api';
import { cn } from '../../lib/utils';

type PreviewState = 'loading' | 'ok' | 'error';
type ViewMode = 'device' | 'raw' | 'clear' | 'server';

interface EinkSurfaceProps {
  state: PreviewState;
  t: ReturnType<typeof useApp>['t'];
  onRetry: () => void;
  sources: { energy: boolean; weather: boolean; news: boolean };
  keys: { weather: boolean; news: boolean };
  data: ReturnType<typeof einkContent>;
  lang: string;
  strings: React.ComponentProps<typeof EInk>['strings'];
  refreshToken: number;
  view: 'device' | 'raw' | 'clear';
}

function EinkSurface({ state, t, onRetry, ...einkProps }: EinkSurfaceProps) {
  if (state === 'loading') {
    return (
      <div
        className="block w-full h-auto [image-rendering:pixelated] bg-white border border-black/[0.35] rounded-[1px]"
        style={{
          aspectRatio: '250 / 122',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <div className="flex flex-col items-center gap-2 p-0" style={{ color: '#111' }}>
          <Spinner />
          <span style={{ fontSize: 12 }}>{t.previewLoading}</span>
        </div>
      </div>
    );
  }
  if (state === 'error') {
    return (
      <div
        className="block w-full h-auto [image-rendering:pixelated] bg-white border border-black/[0.35] rounded-[1px]"
        style={{
          aspectRatio: '250 / 122',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#fff',
        }}
      >
        <div className="p-5 text-center text-warning text-sm flex flex-col items-center gap-2 [&_.material-symbols-outlined]:text-[28px]">
          <Icon name="cloud_off" />
          <strong style={{ fontWeight: 500, fontSize: 13 }}>{t.previewError}</strong>
          <span className="text-fg-2 text-xs" style={{ fontSize: 12 }}>
            {t.previewErrorMsg}
          </span>
          <Button variant="outlined" size="sm" icon="refresh" onClick={onRetry}>
            {t.retry}
          </Button>
        </div>
      </div>
    );
  }
  return <EInk {...einkProps} />;
}

export function PreviewCard() {
  const app = useApp();
  const { getToken, isSignedIn } = useAuth();
  const t = app.t;
  const p = app.prefs;
  const [view, setView] = useState<ViewMode>('device');
  const [refreshToken, setRefreshToken] = useState(0);
  const [state, setState] = useState<PreviewState>('ok');
  const [countdown, setCountdown] = useState(30);
  const [serverBmpSrc, setServerBmpSrc] = useState<string | null>(null);
  const [serverLoading, setServerLoading] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const prevBmpSrc = useRef<string | null>(null);

  const sources = { energy: p.energy.on, weather: p.weather.on, news: p.news.on };
  const keys = {
    weather: app.apiKeys.openweather?.status === 'connected',
    news: app.apiKeys.newsapi?.status === 'connected',
  };
  const data = einkContent(app.lang);

  const enabledCount = Object.values(sources).filter(Boolean).length;
  const availCount =
    (sources.energy ? 1 : 0) +
    (sources.weather && keys.weather ? 1 : 0) +
    (sources.news && keys.news ? 1 : 0);
  const hardError = !app.online || (enabledCount > 0 && availCount === 0);

  function refresh() {
    if (hardError) {
      setState('error');
      setCountdown(30);
      return;
    }
    setRefreshToken((x) => x + 1);
    setCountdown(30);
  }

  useEffect(() => {
    setState(hardError ? 'error' : 'ok');
  }, [hardError]);

  useEffect(() => {
    const id = setInterval(() => {
      setCountdown((c) => {
        if (c <= 1) {
          refresh();
          return 30;
        }
        return c - 1;
      });
    }, 1000);
    return () => clearInterval(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hardError, app.online]);

  // Fetch the server-rendered BMP whenever the server tab is active or manually refreshed
  useEffect(() => {
    if (view !== 'server' || !isSignedIn) return;
    let cancelled = false;

    setServerLoading(true);
    setServerError(null);

    getToken().then((token) => {
      if (!token) { setServerError('Not authenticated'); setServerLoading(false); return; }
      return fetchPreviewBmp(token);
    }).then((blobUrl) => {
      if (cancelled || !blobUrl) return;
      // Revoke previous blob URL to avoid memory leaks
      if (prevBmpSrc.current) URL.revokeObjectURL(prevBmpSrc.current);
      prevBmpSrc.current = blobUrl;
      setServerBmpSrc(blobUrl);
      setServerLoading(false);
    }).catch((err: unknown) => {
      if (cancelled) return;
      setServerError(err instanceof Error ? err.message : 'Failed to load');
      setServerLoading(false);
    });

    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, refreshToken, isSignedIn]);

  // Revoke blob URL on unmount
  useEffect(() => {
    return () => { if (prevBmpSrc.current) URL.revokeObjectURL(prevBmpSrc.current); };
  }, []);

  const lastUpdated = t.justNow;

  const segBtnClass = (active: boolean) =>
    cn(
      'border-none bg-transparent text-fg-2 text-xs font-medium px-[14px] py-1.5 cursor-pointer',
      active && 'bg-accent text-fg-on',
    );

  return (
    <Card
      icon="preview"
      title={t.previewTitle}
      desc={t.previewSub}
      action={
        <div
          className="inline-flex border border-[var(--color-border)] rounded-lg overflow-hidden self-center"
          role="group"
          aria-label="View mode"
        >
          <button className={segBtnClass(view === 'device')} onClick={() => setView('device')}>
            {t.viewDevice}
          </button>
          <button className={segBtnClass(view === 'raw')} onClick={() => setView('raw')}>
            {t.viewRaw}
          </button>
          <button className={segBtnClass(view === 'clear')} onClick={() => setView('clear')}>
            {t.viewClear}
          </button>
          <button className={segBtnClass(view === 'server')} onClick={() => setView('server')}>
            {t.viewServer}
          </button>
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        <div className="flex flex-col items-center gap-1">
          {view === 'server' ? (
            <div
              className="block w-full h-auto [image-rendering:pixelated] bg-white border border-black/[0.35] rounded-[1px]"
              style={{
                width: 250,
                height: 122,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: '#fff',
                border: '1px solid #ccc',
              }}
            >
              {serverLoading && <Spinner />}
              {serverError && (
                <div className="p-5 text-center text-warning text-sm flex flex-col items-center gap-2 [&_.material-symbols-outlined]:text-[28px]" style={{ padding: 8 }}>
                  <Icon name="cloud_off" />
                  <span style={{ fontSize: 11 }}>{serverError}</span>
                  <Button variant="outlined" size="sm" icon="refresh" onClick={refresh}>
                    {t.retry}
                  </Button>
                </div>
              )}
              {!serverLoading && !serverError && serverBmpSrc && (
                <img
                  src={serverBmpSrc}
                  alt="Server-rendered e-ink display"
                  width={250}
                  height={122}
                  style={{ imageRendering: 'pixelated', display: 'block' }}
                />
              )}
            </div>
          ) : view === 'device' ? (
            <div className="bg-gradient-to-b from-[#e9eaec] to-[#d3d6da] px-[14px] pt-4 pb-[22px] rounded-[10px] shadow-2 border border-black/[0.12] relative w-full dark:from-[#2a2c2f] dark:to-[#17191b] dark:border-black/50">
              <EinkSurface
                state={state}
                t={t}
                onRetry={refresh}
                sources={sources}
                keys={keys}
                data={data}
                lang={app.lang}
                strings={t}
                refreshToken={refreshToken}
                view="device"
              />
              <div className="absolute bottom-1.5 left-0 right-0 text-center text-[8px] tracking-[0.14em] uppercase text-black/40 font-mono dark:text-white/35">
                e-ink · 2.13″
              </div>
            </div>
          ) : (
            <EinkSurface
              state={state}
              t={t}
              onRetry={refresh}
              sources={sources}
              keys={keys}
              data={data}
              lang={app.lang}
              strings={t}
              refreshToken={refreshToken}
              view={view as 'raw' | 'clear'}
            />
          )}
        </div>

        <div className="flex items-center justify-between text-xs text-fg-3 font-mono [&_.material-symbols-outlined]:text-[14px] [&_.material-symbols-outlined]:align-[-2px]">
          <span>
            <Icon name="history" /> {t.lastUpdated} {lastUpdated}
          </span>
          <span>
            <Icon name="autorenew" /> {t.nextRefresh} {countdown}s
          </span>
        </div>

        <div className="flex items-center justify-between gap-4">
          <span className="text-xs text-fg-3 flex items-center gap-1.5 [&_.material-symbols-outlined]:text-[15px]">
            <Icon name="info" />
            {t.updateEvery}
          </span>
          <div style={{ display: 'flex', gap: 8 }}>
            <Button
              variant="outlined"
              size="sm"
              icon="grid_view"
              onClick={() => app.nav('layout')}
            >
              {t.layoutEditLayout}
            </Button>
            <Button
              variant="outlined"
              size="sm"
              icon="refresh"
              onClick={refresh}
              disabled={state === 'loading'}
            >
              {t.refreshNow}
            </Button>
          </div>
        </div>

        {enabledCount > 0 && availCount < enabledCount && !hardError && (
          <div
            className="flex gap-[10px] items-start px-[14px] py-3 rounded text-fg-2 text-sm leading-[1.5] [&_.material-symbols-outlined]:text-[19px] [&_.material-symbols-outlined]:text-warning [&_.material-symbols-outlined]:flex-shrink-0 [&_.material-symbols-outlined]:mt-[1px]"
            style={{ background: 'rgba(211,151,10,0.10)' }}
          >
            <Icon name="warning" />
            <span>{t.missingApiKey}</span>
          </div>
        )}
      </div>
    </Card>
  );
}
