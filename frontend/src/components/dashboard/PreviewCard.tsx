// The dashboard shows the same server-rendered pixels used by the display.
import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useApp } from '../../lib/appContext';
import { useAuth } from '../../hooks/useAuth';
import { usePreferences } from '../../hooks/usePreferences';
import { Card } from '../ui/card';
import { Button } from '../ui/button';
import { Spinner } from '../ui/Spinner';
import { Icon } from '../ui/Logo';
import { fetchPreviewBmp, fetchPreviewFrame } from '../../lib/api';
import { bleImagePush, BleSelectionCancelledError } from '../../lib/bleImagePush';
import { deviceLayoutPath } from '../../lib/deviceLayouts';
import { DEFAULT_DISPLAY_PROFILE } from '../../lib/displayProfile';

type PushState = 'idle' | 'selecting' | 'fetching' | 'pushing' | 'refreshing' | 'done' | 'error';

export function PreviewCard({ deviceId, deviceName }: { deviceId?: string; deviceName?: string }) {
  const { t, lang } = useApp();
  const da = lang === 'da';
  const navigate = useNavigate();
  const { getToken, isSignedIn, user } = useAuth();
  const { data: preferences } = usePreferences(deviceId);
  const timezone = preferences?.display_timezone ?? 'Europe/Copenhagen';
  const profile = preferences?.display_profile ?? DEFAULT_DISPLAY_PROFILE;
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [pushState, setPushState] = useState<PushState>('idle');
  const [pushProgress, setPushProgress] = useState(0);
  const [pushError, setPushError] = useState<string | null>(null);
  const bluetoothSupported = typeof navigator !== 'undefined' && !!navigator.bluetooth;

  // Preference and credential saves invalidate the common ['preview'] prefix.
  // Cache the Blob, not its object URL: each mounted view owns and releases its URL.
  const preview = useQuery({
    queryKey: ['preview', user?.id, deviceId, 'bmp'],
    enabled: isSignedIn && !!user?.id,
    queryFn: async ({ signal }) => {
      const token = await getToken();
      if (!token) throw new Error(t.previewSignIn);
      return fetchPreviewBmp(token, signal, deviceId);
    },
    staleTime: 60_000,
    refetchInterval: 60_000,
  });

  useEffect(() => {
    if (!preview.data) { setImageSrc(null); return; }
    const url = URL.createObjectURL(preview.data);
    setImageSrc(url);
    return () => URL.revokeObjectURL(url);
  }, [preview.data]);

  async function pushToDisplay() {
    setPushState('selecting');
    setPushProgress(0);
    setPushError(null);
    try {
      // bleImagePush opens the picker immediately, within this click's user
      // activation. Token and image requests run only after a device is selected.
      await bleImagePush({
        loadPixels: async () => {
          setPushState('fetching');
          const token = await getToken();
          if (!token) throw new Error(t.previewSignIn);
          return fetchPreviewFrame(token, deviceId);
        },
        onProgress: ({ sent, total }) => {
          setPushState('pushing');
          setPushProgress(Math.round((sent / total) * 100));
        },
        onRefreshing: () => setPushState('refreshing'),
      });
      setPushState('done');
    } catch (err) {
      if (err instanceof BleSelectionCancelledError) {
        setPushState('idle');
        setPushError(t.pushCancelled);
      } else {
        setPushState('error');
        setPushError(err instanceof Error ? `${t.pushFailed} ${err.message}` : t.pushFailed);
      }
    }
  }

  const pushBusy = pushState === 'selecting' || pushState === 'fetching' || pushState === 'pushing' || pushState === 'refreshing';
  const updatedAt = preview.dataUpdatedAt ? new Date(preview.dataUpdatedAt) : null;

  return (
    <Card className="dashboard-preview-card" icon="preview" title={deviceName ? `${t.previewTitle} · ${deviceName}` : t.previewTitle}
      desc={`${profile.width} × ${profile.height} px · ${profile.rotation}° · 1-bit`}>
      <div className="flex flex-col gap-3">
        <div className="dashboard-preview-stage">
          <div className="eink-bezel w-full" aria-busy={preview.isFetching}>
            {imageSrc ? (
              <img
                src={imageSrc}
                alt={t.previewImageAlt}
                className="eink-screen"
                style={{ width: '100%', height: 'auto', imageRendering: 'pixelated', display: 'block' }}
              />
            ) : (
              <div className="eink-screen flex items-center justify-center" style={{ aspectRatio: `${profile.width} / ${profile.height}` }}>
                <div className="p-5 text-center text-xs flex flex-col items-center gap-2" style={{ color: '#111' }}>
                  {preview.isPending ? <><Spinner /><span>{t.previewLoading}</span></> : (
                    <><Icon name="cloud_off" /><strong>{t.previewError}</strong></>
                  )}
                </div>
              </div>
            )}
            <div className="absolute bottom-1.5 left-0 right-0 text-center text-[8px] tracking-[0.14em] uppercase text-black/40 font-mono [data-theme='dark']_&:text-white/35">
              e-ink · monochrome
            </div>
          </div>
        </div>

        {preview.isError && (
          <div role="alert" className="text-xs text-warning flex flex-col gap-1">
            <strong>{imageSrc ? t.previewStale : t.previewError}</strong>
            <span>{t.previewErrorMsg} ({preview.error.message})</span>
          </div>
        )}

        <div className="dashboard-preview-meta text-xs text-fg3" aria-live="polite">
          <p className="text-fg2 m-0">{t.previewSavedSettings}</p>
          {updatedAt && (
            <span>{t.lastUpdated} <time dateTime={updatedAt.toISOString()}>{updatedAt.toLocaleString(t.locale, { timeZone: timezone })}</time> · {timezone}</span>
          )}
          {preview.isFetching && <span>{t.previewLoading}</span>}
        </div>

        <div className="flex flex-wrap gap-2">
          <Button size="sm" icon="grid_view" onClick={() => navigate(deviceLayoutPath(deviceId, preferences?.display_schedule?.enabled ? undefined : preferences?.active_layout_id ?? undefined))}>
            {t.layoutEditLayout}
          </Button>
          <Button variant="outlined" size="sm" icon="refresh" onClick={() => void preview.refetch()} disabled={preview.isFetching}>
            {preview.isError ? t.retry : t.refreshNow}
          </Button>
          <Button
            variant="outlined"
            size="sm"
            icon={pushState === 'done' ? 'check' : 'bluetooth'}
            onClick={pushToDisplay}
            disabled={!bluetoothSupported || pushBusy}
            loading={pushBusy}
          >
            {pushState === 'selecting' ? t.pushSelecting
              : pushState === 'fetching' ? t.pushFetching
              : pushState === 'pushing' ? `${pushProgress}%`
              : pushState === 'refreshing' ? t.pushRefreshing
              : pushState === 'done' ? t.pushAgain
              : t.pushToDisplay}
          </Button>
        </div>
        {imageSrc && <a href={imageSrc} download="display.bmp" className="text-xs underline">{da ? 'Download skærmbillede (BMP)' : 'Download display image (BMP)'}</a>}
        <p className="text-xs text-fg2 m-0">{da ? 'Forhåndsvisningen bekræfter ikke, hvad den fysiske skærm har modtaget.' : 'The preview does not confirm what the physical display has received.'}</p>
        {pushState === 'done' && <p role="status" className="text-xs text-fg2 m-0">{t.pushComplete}</p>}
        {pushError && <p role={pushState === 'error' ? 'alert' : 'status'} className="text-xs text-warning m-0">{pushError}</p>}
        <details className="dashboard-preview-help">
          <summary>{da ? 'Enhed og Bluetooth-oplysninger' : 'Device & Bluetooth details'}</summary>
          <div className="flex flex-col gap-3 mt-3">
            {deviceId && <p className="text-xs text-fg2 m-0 break-all">UUID: <code>{deviceId}</code></p>}
            <p className="text-xs text-fg2 m-0">{t.pushSetup}</p>
            {!bluetoothSupported && <p className="text-xs text-fg2 m-0">{t.pushUnsupported}</p>}
          </div>
        </details>
      </div>
    </Card>
  );
}
