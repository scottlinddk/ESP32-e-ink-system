// The dashboard shows the same server-rendered pixels used by the display.
import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useApp } from '../../lib/appContext';
import { useAuth } from '../../hooks/useAuth';
import { Card } from '../ui/card';
import { Button } from '../ui/button';
import { Spinner } from '../ui/Spinner';
import { Icon } from '../ui/Logo';
import { fetchPreviewBmp, fetchPreviewRaw } from '../../lib/api';
import { bleImagePush, BleSelectionCancelledError } from '../../lib/bleImagePush';

type PushState = 'idle' | 'selecting' | 'fetching' | 'pushing' | 'done' | 'error';

export function PreviewCard() {
  const { t } = useApp();
  const navigate = useNavigate();
  const { getToken, isSignedIn, user } = useAuth();
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [pushState, setPushState] = useState<PushState>('idle');
  const [pushProgress, setPushProgress] = useState(0);
  const [pushError, setPushError] = useState<string | null>(null);
  const bluetoothSupported = typeof navigator !== 'undefined' && !!navigator.bluetooth;

  // Preference and credential saves invalidate the common ['preview'] prefix.
  // Cache the Blob, not its object URL: each mounted view owns and releases its URL.
  const preview = useQuery({
    queryKey: ['preview', 'bmp', user?.id],
    enabled: isSignedIn && !!user?.id,
    queryFn: async ({ signal }) => {
      const token = await getToken();
      if (!token) throw new Error(t.previewSignIn);
      return fetchPreviewBmp(token, signal);
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
          return fetchPreviewRaw(token);
        },
        onProgress: ({ sent, total }) => {
          setPushState('pushing');
          setPushProgress(Math.round((sent / total) * 100));
        },
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

  const pushBusy = pushState === 'selecting' || pushState === 'fetching' || pushState === 'pushing';
  const updatedAt = preview.dataUpdatedAt ? new Date(preview.dataUpdatedAt) : null;

  return (
    <Card icon="preview" title={t.previewTitle} desc={t.previewSub}>
      <div className="flex flex-col gap-3">
        <p className="text-xs text-fg2 m-0">{t.previewSavedSettings}</p>
        <div className="eink-bezel w-full" aria-busy={preview.isFetching}>
          {imageSrc ? (
            <img
              src={imageSrc}
              alt={t.previewImageAlt}
              width={250}
              height={122}
              className="eink-screen"
              style={{ width: '100%', height: 'auto', imageRendering: 'pixelated', display: 'block' }}
            />
          ) : (
            <div className="eink-screen flex items-center justify-center" style={{ aspectRatio: '250 / 122' }}>
              <div className="p-5 text-center text-xs flex flex-col items-center gap-2" style={{ color: '#111' }}>
                {preview.isPending ? <><Spinner /><span>{t.previewLoading}</span></> : (
                  <><Icon name="cloud_off" /><strong>{t.previewError}</strong></>
                )}
              </div>
            </div>
          )}
          <div className="absolute bottom-1.5 left-0 right-0 text-center text-[8px] tracking-[0.14em] uppercase text-black/40 font-mono [data-theme='dark']_&:text-white/35">
            e-ink · 2.13″
          </div>
        </div>

        {preview.isError && (
          <div role="alert" className="text-xs text-warning flex flex-col gap-1">
            <strong>{imageSrc ? t.previewStale : t.previewError}</strong>
            <span>{t.previewErrorMsg} ({preview.error.message})</span>
          </div>
        )}

        <div className="flex flex-wrap justify-between gap-2 text-xs text-fg3" aria-live="polite">
          {updatedAt && (
            <span>{t.lastUpdated} <time dateTime={updatedAt.toISOString()}>{updatedAt.toLocaleString(t.locale)}</time></span>
          )}
          {preview.isFetching && <span>{t.previewLoading}</span>}
        </div>

        <div className="flex flex-wrap gap-2">
          <Button variant="outlined" size="sm" icon="grid_view" onClick={() => navigate('/layout')}>
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
              : pushState === 'done' ? t.pushAgain
              : t.pushToDisplay}
          </Button>
        </div>
        {!bluetoothSupported && <p className="text-xs text-fg2 m-0">{t.pushUnsupported}</p>}
        {pushState === 'done' && <p role="status" className="text-xs text-fg2 m-0">{t.pushComplete}</p>}
        {pushError && <p role={pushState === 'error' ? 'alert' : 'status'} className="text-xs text-warning m-0">{pushError}</p>}
      </div>
    </Card>
  );
}
