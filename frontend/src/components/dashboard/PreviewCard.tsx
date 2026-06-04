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
        className="eink-screen"
        style={{
          aspectRatio: '250 / 122',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <div className="loadbox" style={{ padding: 0, color: '#111' }}>
          <Spinner />
          <span style={{ fontSize: 12 }}>{t.previewLoading}</span>
        </div>
      </div>
    );
  }
  if (state === 'error') {
    return (
      <div
        className="eink-screen"
        style={{
          aspectRatio: '250 / 122',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#fff',
        }}
      >
        <div className="eink-error">
          <Icon name="cloud_off" />
          <strong style={{ fontWeight: 500, fontSize: 13 }}>{t.previewError}</strong>
          <span className="muted" style={{ fontSize: 12 }}>
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
    setState('loading');
    setTimeout(() => {
      setState('ok');
      setRefreshToken((x) => x + 1);
    }, 750);
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

  return (
    <Card
      icon="preview"
      title={t.previewTitle}
      desc={t.previewSub}
      action={
        <div className="seg" role="group" aria-label="View mode">
          <button
            className={view === 'device' ? 'is-active' : ''}
            onClick={() => setView('device')}
          >
            {t.viewDevice}
          </button>
          <button
            className={view === 'raw' ? 'is-active' : ''}
            onClick={() => setView('raw')}
          >
            {t.viewRaw}
          </button>
          <button
            className={view === 'clear' ? 'is-active' : ''}
            onClick={() => setView('clear')}
          >
            {t.viewClear}
          </button>
          <button
            className={view === 'server' ? 'is-active' : ''}
            onClick={() => setView('server')}
          >
            Server
          </button>
        </div>
      }
    >
      <div className="eink-panel">
        <div className="eink-stage">
          {view === 'server' ? (
            <div
              className="eink-screen"
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
                <div className="eink-error" style={{ padding: 8 }}>
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
            <div className="eink-bezel">
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
              <div className="eink-bezel__brand">e-ink · 2.13″</div>
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

        <div className="eink-meta">
          <span>
            <Icon name="history" /> {t.lastUpdated} {lastUpdated}
          </span>
          <span>
            <Icon name="autorenew" /> {t.nextRefresh} {countdown}s
          </span>
        </div>

        <div className="row-between">
          <span className="eink-note">
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
          <div className="info-banner" style={{ background: 'rgba(211,151,10,0.10)' }}>
            <Icon name="warning" style={{ color: 'var(--palette-warning-main)' }} />
            <span>{t.missingApiKey}</span>
          </div>
        )}
      </div>
    </Card>
  );
}
