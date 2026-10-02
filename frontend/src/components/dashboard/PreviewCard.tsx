// The dashboard shows the same server-rendered pixels used by the display.
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
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

type PushState = 'idle' | 'selecting' | 'fetching' | 'pushing' | 'refreshing' | 'done' | 'error';

export function PreviewCard(props: { deviceId?: string; deviceName?: string; hardwareId?: string; expectedDeviceName?: string | null }) {
  const { user } = useAuth();
  return <DevicePreview key={`${user?.id}:${props.deviceId ?? 'shared'}`} {...props} />;
}

function DevicePreview({ deviceId, deviceName, hardwareId, expectedDeviceName }: { deviceId?: string; deviceName?: string; hardwareId?: string; expectedDeviceName?: string | null }) {
  const { t, lang } = useApp();
  const da = lang === 'da';
  const navigate = useNavigate();
  const { getToken, isSignedIn, user } = useAuth();
  const { data: preferences } = usePreferences(deviceId);
  const timezone = preferences?.display_timezone ?? 'Europe/Copenhagen';
  const [image, setImage] = useState<{ url: string; blob: Blob } | null>(null);
  const [pushState, setPushState] = useState<PushState>('idle');
  const [pushProgress, setPushProgress] = useState(0);
  const [pushError, setPushError] = useState<string | null>(null);
  const [pushedName, setPushedName] = useState('');
  const pushRequest = useRef<AbortController | null>(null);
  useLayoutEffect(() => () => { pushRequest.current?.abort(); }, []);
  const bluetoothSupported = typeof navigator !== 'undefined' && !!navigator.bluetooth;

  // Preference and credential saves invalidate the common ['preview'] prefix.
  // Cache the Blob, not its object URL: each mounted view owns and releases its URL.
  const preview = useQuery({
    queryKey: ['preview', user?.id, deviceId, 'bmp'],
    enabled: isSignedIn && !!user?.id,
    queryFn: async ({ signal }) => {
      const token = await getToken();
      signal.throwIfAborted();
      if (!token) throw new Error(t.previewSignIn);
      return fetchPreviewBmp(token, signal, deviceId);
    },
    staleTime: 60_000,
    refetchInterval: 60_000,
  });

  useEffect(() => {
    if (!preview.data) { setImage(null); return; }
    const url = URL.createObjectURL(preview.data.blob);
    setImage({ url, blob: preview.data.blob });
    return () => URL.revokeObjectURL(url);
  }, [preview.data]);
  const imageSrc = image?.blob === preview.data?.blob ? image?.url : undefined;
  const metadata = preview.data?.metadata;

  async function pushToDisplay() {
    pushRequest.current?.abort();
    const controller = new AbortController();
    pushRequest.current = controller;
    const targetDeviceId = deviceId;
    setPushState('selecting');
    setPushProgress(0);
    setPushError(null);
    setPushedName('');
    try {
      // bleImagePush opens the picker immediately, within this click's user
      // activation. Token and image requests run only after a device is selected.
      const result = await bleImagePush({
        signal: controller.signal,
        expectedDeviceName: expectedDeviceName || undefined,
        loadPixels: async () => {
          controller.signal.throwIfAborted();
          setPushState('fetching');
          const token = await getToken();
          controller.signal.throwIfAborted();
          if (!token) throw new Error(t.previewSignIn);
          return fetchPreviewFrame(token, targetDeviceId, controller.signal);
        },
        onProgress: ({ sent, total }) => {
          if (controller.signal.aborted) return;
          setPushState('pushing');
          setPushProgress(Math.round((sent / total) * 100));
        },
        onRefreshing: () => { if (!controller.signal.aborted) setPushState('refreshing'); },
      });
      if (controller.signal.aborted) return;
      setPushedName(result.device.name || (da ? 'unavngivet Bluetooth-enhed' : 'unnamed Bluetooth device'));
      setPushState('done');
    } catch (err) {
      if (controller.signal.aborted) return;
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
  const updatedAt = metadata ? new Date(metadata.renderedAt) : null;

  return (
    <Card icon="preview" title={deviceName ? `${t.previewTitle} · ${deviceName}` : t.previewTitle}
      desc={metadata ? `${metadata.profile.width} × ${metadata.profile.height} px · ${metadata.profile.rotation}° · 1-bit` : (da ? 'Servergenereret billede fra gemte indstillinger' : 'Server-rendered image from saved settings')}>
      <div className="flex flex-col gap-3">
        {deviceId && <p className="text-xs text-fg2 m-0 break-all">{da ? 'Hardware-ID' : 'Hardware ID'}: <code>{hardwareId || '—'}</code><br />UUID: <code>{deviceId}</code></p>}
        <p className="text-xs text-fg2 m-0">{t.previewSavedSettings}</p>
        {metadata && <div className="text-xs text-fg2 grid gap-1" aria-live="polite">
          <strong>{da ? 'Gengivet layout' : 'Rendered layout'}: {metadata.layoutName}</strong>
          <span>{metadata.mode === 'slideshow' ? 'Slideshow' : (da ? 'Fast layout' : 'Single layout')}{metadata.quiet ? (da ? ' · Stille timer' : ' · Quiet hours') : ''}</span>
          {metadata.nextTransition && <span>{da ? 'Næste sideskift eller pausegrænse' : 'Next page or quiet-hours boundary'}: <time dateTime={metadata.nextTransition}>{new Date(metadata.nextTransition).toLocaleString(t.locale, { timeZone: timezone })}</time> · {timezone}</span>}
        </div>}
        <div className="eink-bezel w-full" aria-busy={preview.isFetching}>
          {imageSrc ? (
            <img
              src={imageSrc}
              alt={t.previewImageAlt}
              className="eink-screen"
              style={{ width: '100%', height: 'auto', imageRendering: 'pixelated', display: 'block' }}
            />
          ) : (
            <div className="eink-screen flex items-center justify-center" style={{ aspectRatio: metadata ? `${metadata.profile.width} / ${metadata.profile.height}` : '250 / 122' }}>
              <div className="p-5 text-center text-xs flex flex-col items-center gap-2" style={{ color: '#111' }}>
                {preview.isPending || preview.data ? <><Spinner /><span>{t.previewLoading}</span></> : (
                  <><Icon name="cloud_off" /><strong>{t.previewError}</strong></>
                )}
              </div>
            </div>
          )}
          <div className="absolute bottom-1.5 left-0 right-0 text-center text-[8px] tracking-[0.14em] uppercase text-black/40 font-mono [data-theme='dark']_&:text-white/35">
            e-ink · monochrome
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
            <span>{da ? 'Gengivet' : 'Rendered'} <time dateTime={updatedAt.toISOString()}>{updatedAt.toLocaleString(t.locale, { timeZone: timezone })}</time> · {timezone}</span>
          )}
          {preview.isFetching && <span>{t.previewLoading}</span>}
        </div>

        <div className="flex flex-wrap gap-2">
          <Button variant="outlined" size="sm" icon="grid_view" disabled={!metadata} onClick={() => navigate(deviceLayoutPath(deviceId, metadata?.layoutId ?? undefined))}>
            {t.layoutEditLayout}
          </Button>
          <Button variant="outlined" size="sm" icon="refresh" onClick={() => void preview.refetch()} disabled={preview.isFetching}>
            {da ? 'Opdatér forhåndsvisning' : 'Refresh preview'}
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
        {imageSrc && <a href={imageSrc} download="display.bmp" className="text-xs underline">Download display image (BMP)</a>}
        <p className="text-xs text-fg2 m-0">{da ? 'Forhåndsvisningen viser serverens gengivne billede. Den bekræfter ikke, hvad den fysiske skærm har modtaget.' : 'The preview shows the server-rendered image. It does not confirm what the physical display has received.'}</p>
        <p className="text-xs text-fg2 m-0">{t.pushSetup}</p>
        <p className="text-xs text-fg2 m-0">{expectedDeviceName
          ? (da ? `Bluetooth-navnet skal være ${expectedDeviceName}.` : `The Bluetooth name must be ${expectedDeviceName}.`)
          : (da ? 'Der er ikke gemt et Bluetooth-navn. Vælg den rigtige fysiske skærm i Bluetooth-vælgeren; navnet vises efter overførslen.' : 'No Bluetooth name is registered. Choose the correct physical display in the Bluetooth picker; its name is shown after transfer.')}</p>
        {!bluetoothSupported && <p className="text-xs text-fg2 m-0">{t.pushUnsupported}</p>}
        {pushState === 'done' && <p role="status" className="text-xs text-fg2 m-0">{pushedName}: {t.pushComplete}</p>}
        {pushError && <p role={pushState === 'error' ? 'alert' : 'status'} className="text-xs text-warning m-0">{pushError}</p>}
      </div>
    </Card>
  );
}
