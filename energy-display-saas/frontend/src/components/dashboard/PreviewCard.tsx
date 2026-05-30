// =========================================================================
// PreviewCard.tsx — live e-ink preview card
// =========================================================================
import React, { useState, useEffect, ReactNode } from 'react';
import { useApp } from '../../lib/appContext';
import { Card } from '../ui/card';
import { Button } from '../ui/button';
import { Spinner } from '../ui/Spinner';
import { Icon } from '../ui/Logo';
import { EInk } from '../eink/EInk';
import { einkContent } from '../../lib/mockData';

type PreviewState = 'loading' | 'ok' | 'error';

interface EinkSurfaceProps {
  state: PreviewState;
  t: ReturnType<typeof useApp>['t'];
  onRetry: () => void;
  sources: { energy: boolean; weather: boolean; news: boolean };
  keys: { weather: boolean; news: boolean };
  data: ReturnType<typeof einkContent>;
  lang: string;
  refreshToken: number;
  view: 'device' | 'raw';
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
  const t = app.t;
  const p = app.prefs;
  const [view, setView] = useState<'device' | 'raw'>('device');
  const [refreshToken, setRefreshToken] = useState(0);
  const [state, setState] = useState<PreviewState>('ok');
  const [countdown, setCountdown] = useState(30);

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

  const lastUpdated = app.lang === 'da' ? 'lige nu' : 'just now';

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
        </div>
      }
    >
      <div className="eink-panel">
        <div className="eink-stage">
          {view === 'device' ? (
            <div className="eink-bezel">
              <EinkSurface
                state={state}
                t={t}
                onRetry={refresh}
                sources={sources}
                keys={keys}
                data={data}
                lang={app.lang}
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
              refreshToken={refreshToken}
              view="raw"
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

        {enabledCount > 0 && availCount < enabledCount && !hardError && (
          <div className="info-banner" style={{ background: 'rgba(211,151,10,0.10)' }}>
            <Icon name="warning" style={{ color: 'var(--palette-warning-main)' }} />
            <span>
              {app.lang === 'da'
                ? 'En valgt kilde mangler sin API-nøgle og vises ikke.'
                : 'An enabled source is missing its API key and won\'t show.'}
            </span>
          </div>
        )}
      </div>
    </Card>
  );
}
