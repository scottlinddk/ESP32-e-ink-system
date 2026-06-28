// =========================================================================
// PreviewCard.tsx — live e-ink preview card
// =========================================================================
import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useApp } from '../../lib/appContext';
import { useAuth } from '../../hooks/useAuth';
import { Card } from '../ui/card';
import { Button } from '../ui/button';
import { Spinner } from '../ui/Spinner';
import { Icon } from '../ui/Logo';
import { EInk } from '../eink/EInk';
import type { SourceId } from '../eink/EInk';
import { einkContent } from '../../lib/mockData';
import { fetchPreviewBmp, fetchPreviewRaw, getEvCredentialStatus } from '../../lib/api';
import { bleImagePush } from '../../lib/bleImagePush';

const EINK_W = 250;

type PreviewState = 'loading' | 'ok' | 'error';
type ViewMode = 'device' | 'raw' | 'clear' | 'ideal';

interface EinkSurfaceProps {
  state: PreviewState;
  t: ReturnType<typeof useApp>['t'];
  onRetry: () => void;
  sources: Record<SourceId, boolean>;
  keys: { weather: boolean; news: boolean; monta: boolean; zaptec: boolean };
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
        className="eink-screen flex items-center justify-center"
        style={{ aspectRatio: '250 / 122' }}
      >
        <div className="flex flex-col items-center gap-3 text-xs" style={{ color: '#111' }}>
          <Spinner />
          <span>{t.previewLoading}</span>
        </div>
      </div>
    );
  }
  if (state === 'error') {
    return (
      <div
        className="eink-screen flex items-center justify-center bg-white"
        style={{ aspectRatio: '250 / 122' }}
      >
        <div className="p-5 text-center text-warning text-sm flex flex-col items-center gap-2 [&_.material-symbols-outlined]:text-[28px]">
          <Icon name="cloud_off" />
          <strong className="font-medium text-[13px]">{t.previewError}</strong>
          <span className="text-fg2 text-xs">{t.previewErrorMsg}</span>
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
  const navigate = useNavigate();
  const { getToken, isSignedIn } = useAuth();
  const t = app.t;
  const p = app.prefs;
  const [view, setView] = useState<ViewMode>('device');
  const [refreshToken, setRefreshToken] = useState(0);
  const [state, setState] = useState<PreviewState>('ok');
  const [countdown, setCountdown] = useState(30);
  const [idealBmpSrc, setIdealBmpSrc] = useState<string | null>(null);
  const [idealLoading, setIdealLoading] = useState(false);
  const [idealError, setIdealError] = useState<string | null>(null);
  const [pushState, setPushState] = useState<'idle' | 'fetching' | 'pushing' | 'done' | 'error'>('idle');
  const [pushProgress, setPushProgress] = useState(0);
  const prevBmpSrc = useRef<string | null>(null);

  const { data: montaCred } = useQuery({
    queryKey: ['ev-credentials', 'monta'],
    queryFn: async () => {
      const token = await getToken();
      if (!token) throw new Error('Not authenticated');
      return getEvCredentialStatus(token, 'monta');
    },
    enabled: isSignedIn,
  });

  const { data: zaptecCred } = useQuery({
    queryKey: ['ev-credentials', 'zaptec'],
    queryFn: async () => {
      const token = await getToken();
      if (!token) throw new Error('Not authenticated');
      return getEvCredentialStatus(token, 'zaptec');
    },
    enabled: isSignedIn,
  });

  const sources: Record<SourceId, boolean> = {
    energy: p.energy.on,
    weather: p.weather.on,
    news: p.news.on,
    monta: p.monta?.on ?? false,
    zaptec: p.zaptec?.on ?? false,
  };
  const keys = {
    weather: app.apiKeys.openweather?.status === 'connected',
    news: app.apiKeys.newsapi?.status === 'connected',
    monta: montaCred?.configured ?? false,
    zaptec: zaptecCred?.configured ?? false,
  };
  const data = einkContent(app.lang);

  const enabledCount = Object.values(sources).filter(Boolean).length;
  const availCount =
    (sources.energy ? 1 : 0) +
    (sources.weather && keys.weather ? 1 : 0) +
    (sources.news && keys.news ? 1 : 0) +
    (sources.monta && keys.monta ? 1 : 0) +
    (sources.zaptec && keys.zaptec ? 1 : 0);
  const hardError = !app.online || (enabledCount > 0 && availCount === 0);

  function refresh() {
    if (hardError) {
      setState('error');
      setCountdown(30);
      return;
    }
    setState('ok');
    setRefreshToken((x) => x + 1);
    setCountdown(30);
  }

  async function pushToDisplay() {
    const token = await getToken();
    if (!token) return;
    try {
      setPushState('fetching');
      const pixels = await fetchPreviewRaw(token);
      setPushState('pushing');
      await bleImagePush({
        pixels,
        onProgress: ({ sent, total }) => setPushProgress(Math.round((sent / total) * 100)),
      });
      setPushState('done');
      setTimeout(() => setPushState('idle'), 3000);
    } catch (err) {
      console.error('BLE push failed:', err);
      setPushState('error');
      setTimeout(() => setPushState('idle'), 4000);
    }
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

  // Fetch server-rendered BMP when ideal tab is active or manually refreshed
  useEffect(() => {
    if (view !== 'ideal' || !isSignedIn) return;
    let cancelled = false;

    setIdealLoading(true);
    setIdealError(null);

    getToken().then((token) => {
      if (!token) { setIdealError('Not authenticated'); setIdealLoading(false); return; }
      return fetchPreviewBmp(token);
    }).then((blobUrl) => {
      if (cancelled || !blobUrl) return;
      if (prevBmpSrc.current) URL.revokeObjectURL(prevBmpSrc.current);
      prevBmpSrc.current = blobUrl;
      setIdealBmpSrc(blobUrl);
      setIdealLoading(false);
    }).catch((err: unknown) => {
      if (cancelled) return;
      setIdealError(err instanceof Error ? err.message : 'Failed to load');
      setIdealLoading(false);
    });

    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, refreshToken, isSignedIn]);

  useEffect(() => {
    return () => { if (prevBmpSrc.current) URL.revokeObjectURL(prevBmpSrc.current); };
  }, []);

  const views: { id: ViewMode; label: string }[] = [
    { id: 'device', label: t.viewDevice },
    { id: 'raw', label: t.viewRaw },
    { id: 'clear', label: t.viewClear },
    { id: 'ideal', label: t.viewIdeal },
  ];

  return (
    <Card
      icon="preview"
      title={t.previewTitle}
      desc={t.previewSub}
    >
      <div className="flex flex-col gap-3">
        {/* View mode tabs — below title to avoid crowding the header on mobile */}
        <div
          className="inline-flex self-center border border-border rounded-md overflow-hidden"
          role="group"
          aria-label="View mode"
        >
          {views.map((v) => (
            <button
              key={v.id}
              className={[
                'border-none text-xs font-medium px-3.5 py-1.5 cursor-pointer transition-[background,color] duration-[150ms]',
                view === v.id ? 'bg-accent text-fg-on' : 'bg-transparent text-fg2 hover:bg-black/[0.05]',
              ].join(' ')}
              onClick={() => setView(v.id)}
            >
              {v.label}
            </button>
          ))}
        </div>

        <div className="flex flex-col items-center gap-1">
          {view === 'ideal' ? (
            <div className="eink-bezel w-full">
              {idealLoading && (
                <div className="eink-screen flex items-center justify-center" style={{ aspectRatio: '250 / 122' }}>
                  <Spinner />
                </div>
              )}
              {idealError && (
                <div
                  className="eink-screen flex items-center justify-center bg-white"
                  style={{ aspectRatio: '250 / 122' }}
                >
                  <div className="p-2 text-center text-warning text-xs flex flex-col items-center gap-2 [&_.material-symbols-outlined]:text-[22px]">
                    <Icon name="cloud_off" />
                    <span>{idealError}</span>
                    <Button variant="outlined" size="sm" icon="refresh" onClick={refresh}>
                      {t.retry}
                    </Button>
                  </div>
                </div>
              )}
              {!idealLoading && !idealError && idealBmpSrc && (
                <img
                  src={idealBmpSrc}
                  alt="Ideal server-rendered e-ink display"
                  style={{
                    maxWidth: EINK_W * 3,
                    width: '100%',
                    imageRendering: 'pixelated',
                    display: 'block',
                  }}
                />
              )}
              <div className="absolute bottom-1.5 left-0 right-0 text-center text-[8px] tracking-[0.14em] uppercase text-black/40 font-mono [data-theme='dark']_&:text-white/35">
                e-ink · 2.13″
              </div>
            </div>
          ) : view === 'device' ? (
            <div className="eink-bezel w-full">
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
              <div className="absolute bottom-1.5 left-0 right-0 text-center text-[8px] tracking-[0.14em] uppercase text-black/40 font-mono [data-theme='dark']_&:text-white/35">
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

        <div className="flex items-center justify-between text-xs text-fg3 font-mono [&_.material-symbols-outlined]:text-[14px] [&_.material-symbols-outlined]:align-[-2px]">
          <span>
            <Icon name="history" /> {t.lastUpdated} {t.justNow}
          </span>
          <span>
            <Icon name="autorenew" /> {t.nextRefresh} {countdown}s
          </span>
        </div>

        <div className="flex items-center justify-between gap-4">
          <span className="text-xs text-fg3 flex items-center gap-1.5 [&_.material-symbols-outlined]:text-[15px]">
            <Icon name="info" />
            {t.updateEvery}
          </span>
          <div className="flex gap-2">
            <Button variant="outlined" size="sm" icon="grid_view" onClick={() => navigate('/layout')}>
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
            <Button
              variant="outlined"
              size="sm"
              icon={pushState === 'done' ? 'check' : pushState === 'error' ? 'error' : 'bluetooth'}
              onClick={pushToDisplay}
              disabled={pushState === 'fetching' || pushState === 'pushing'}
              loading={pushState === 'fetching' || pushState === 'pushing'}
            >
              {pushState === 'fetching' ? 'Fetching…'
                : pushState === 'pushing' ? `${pushProgress}%`
                : pushState === 'done' ? 'Sent!'
                : pushState === 'error' ? 'Failed'
                : 'Push to Display'}
            </Button>
          </div>
        </div>

        {enabledCount > 0 && availCount < enabledCount && !hardError && (
          <div className="flex gap-2.5 items-start px-3.5 py-3 rounded-sm bg-warning/[0.10] text-fg2 text-sm leading-snug [&_.material-symbols-outlined]:text-[19px] [&_.material-symbols-outlined]:text-warning [&_.material-symbols-outlined]:flex-shrink-0 [&_.material-symbols-outlined]:mt-[1px]">
            <Icon name="warning" />
            <span>{t.missingApiKey}</span>
          </div>
        )}
      </div>
    </Card>
  );
}
