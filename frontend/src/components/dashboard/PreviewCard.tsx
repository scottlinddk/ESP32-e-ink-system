// The dashboard shows the same server-rendered pixels used by the display.
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
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
import { slideshowPreviewPages, stepPreviewPage } from '../../lib/deviceSlideshow';
import { DeviceRefreshControl } from './DeviceRefreshControl';

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
  // A chosen slideshow page is previewed instead of the scheduled one. It falls back
  // to the schedule once the slideshow is turned off or that page is removed.
  const slideshowPages = slideshowPreviewPages(preferences);
  const [chosenPageId, setChosenPageId] = useState<string | null>(null);
  const pageId = slideshowPages.some((page) => page.id === chosenPageId) ? chosenPageId! : undefined;
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
    queryKey: ['preview', user?.id, deviceId, 'bmp', pageId ?? null],
    enabled: isSignedIn && !!user?.id,
    queryFn: async ({ signal }) => {
      const token = await getToken();
      signal.throwIfAborted();
      if (!token) throw new Error(t.previewSignIn);
      return fetchPreviewBmp(token, signal, deviceId, pageId);
    },
    staleTime: 60_000,
    refetchInterval: 60_000,
    // Keep the previous page on screen while the next one renders. Its labels come
    // from the same response, so the image and its description stay paired.
    placeholderData: keepPreviousData,
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
    const targetPageId = pageId;
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
          return fetchPreviewFrame(token, targetDeviceId, controller.signal, targetPageId);
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
  const pageIndex = slideshowPages.findIndex((page) => page.id === pageId);
  // Stepping from the live view starts at the page the schedule shows now.
  const stepFrom = pageId ?? (metadata?.mode === 'slideshow' ? metadata.layoutId : null);
  const modeLabel = metadata?.mode === 'slideshow' ? 'Slideshow'
    : metadata?.mode === 'page' ? (da ? 'Valgt slideshow-side' : 'Chosen slideshow page')
    : (da ? 'Fast layout' : 'Single layout');

  return (
    <Card className="dashboard-preview-card" icon="preview" title={deviceName ? `${t.previewTitle} · ${deviceName}` : t.previewTitle}
      desc={metadata ? `${metadata.profile.width} × ${metadata.profile.height} px · ${metadata.profile.rotation}° · 1-bit` : (da ? 'Servergenereret billede fra gemte indstillinger' : 'Server-rendered image from saved settings')}>
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
        </div>

        {slideshowPages.length > 0 && (
          <div className="dashboard-preview-pager" role="group" aria-label={da ? 'Slideshow-sider' : 'Slideshow pages'}>
            <Button variant="outlined" size="sm" icon="chevron_left" aria-label={da ? 'Forrige side' : 'Previous page'}
              onClick={() => setChosenPageId(stepPreviewPage(slideshowPages, stepFrom, -1) ?? null)} />
            <label className="dashboard-preview-pager-select">
              <span className="sr-only">{da ? 'Vis slideshow-side' : 'Show slideshow page'}</span>
              <select value={pageId ?? ''} onChange={(event) => setChosenPageId(event.target.value || null)}>
                <option value="">{da ? 'Aktuel side efter tidsplan' : 'Current page as scheduled'}</option>
                {slideshowPages.map((page, index) => (
                  <option key={page.id} value={page.id}>{`${index + 1}/${slideshowPages.length} · ${page.name}`}</option>
                ))}
              </select>
            </label>
            <Button variant="outlined" size="sm" icon="chevron_right" aria-label={da ? 'Næste side' : 'Next page'}
              onClick={() => setChosenPageId(stepPreviewPage(slideshowPages, stepFrom, 1) ?? null)} />
          </div>
        )}
        {pageId && (
          <p className="text-xs text-fg2 m-0" role="status">
            {da ? `Viser side ${pageIndex + 1} af ${slideshowPages.length}. Skærmen følger stadig tidsplanen.` : `Showing page ${pageIndex + 1} of ${slideshowPages.length}. The display still follows the schedule.`}{' '}
            <button type="button" className="underline bg-transparent border-0 p-0 cursor-pointer text-inherit" onClick={() => setChosenPageId(null)}>
              {da ? 'Vis aktuel side' : 'Show current page'}
            </button>
          </p>
        )}

        {preview.isError && (
          <div role="alert" className="text-xs text-warning flex flex-col gap-1">
            <strong>{imageSrc ? t.previewStale : t.previewError}</strong>
            <span>{t.previewErrorMsg} ({preview.error.message})</span>
          </div>
        )}

        <div className="dashboard-preview-meta text-xs text-fg3" aria-live="polite">
          <p className="text-fg2 m-0">{t.previewSavedSettings}</p>
          {metadata && <div className="text-fg2 grid gap-1">
            <strong>{da ? 'Gengivet layout' : 'Rendered layout'}: {metadata.layoutName}</strong>
            <span>{modeLabel}{metadata.quiet ? (da ? ' · Stille timer' : ' · Quiet hours') : ''}</span>
            {metadata.nextTransition && <span>{da ? 'Næste sideskift eller pausegrænse' : 'Next page or quiet-hours boundary'}: <time dateTime={metadata.nextTransition}>{new Date(metadata.nextTransition).toLocaleString(t.locale, { timeZone: timezone })}</time> · {timezone}</span>}
          </div>}
          {updatedAt && (
            <span>{da ? 'Gengivet' : 'Rendered'} <time dateTime={updatedAt.toISOString()}>{updatedAt.toLocaleString(t.locale, { timeZone: timezone })}</time> · {timezone}</span>
          )}
          {preview.isFetching && <span>{t.previewLoading}</span>}
        </div>

        <div className="flex flex-wrap gap-2">
          <Button size="sm" icon="grid_view" disabled={!metadata} onClick={() => navigate(deviceLayoutPath(deviceId, metadata?.layoutId ?? undefined))}>
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
        {imageSrc && <a href={imageSrc} download="display.bmp" className="text-xs underline">{da ? 'Download skærmbillede (BMP)' : 'Download display image (BMP)'}</a>}
        <p className="text-xs text-fg2 m-0">{da ? 'Forhåndsvisningen viser serverens gengivne billede. Den bekræfter ikke, hvad den fysiske skærm har modtaget.' : 'The preview shows the server-rendered image. It does not confirm what the physical display has received.'}</p>
        {deviceId && <DeviceRefreshControl deviceId={deviceId} deviceName={deviceName} hardwareId={hardwareId} timezone={timezone} />}
        {pageId && <p className="text-xs text-fg2 m-0">{da ? 'Bluetooth-overførsel sender den viste side. Skærmen vender tilbage til tidsplanen ved næste opdatering.' : 'Bluetooth transfer sends the page shown here. The display returns to the schedule at its next refresh.'}</p>}
        {pushState === 'done' && <p role="status" className="text-xs text-fg2 m-0">{pushedName}: {t.pushComplete}</p>}
        {pushError && <p role={pushState === 'error' ? 'alert' : 'status'} className="text-xs text-warning m-0">{pushError}</p>}
        <details className="dashboard-preview-help">
          <summary>{da ? 'Enhed og Bluetooth-oplysninger' : 'Device & Bluetooth details'}</summary>
          <div className="flex flex-col gap-3 mt-3">
            {deviceId && <p className="text-xs text-fg2 m-0 break-all">{da ? 'Hardware-ID' : 'Hardware ID'}: <code>{hardwareId || '—'}</code><br />UUID: <code>{deviceId}</code></p>}
            <p className="text-xs text-fg2 m-0">{t.pushSetup}</p>
            <p className="text-xs text-fg2 m-0">{expectedDeviceName
              ? (da ? `Bluetooth-navnet skal være ${expectedDeviceName}.` : `The Bluetooth name must be ${expectedDeviceName}.`)
              : (da ? 'Der er ikke gemt et Bluetooth-navn. Vælg den rigtige fysiske skærm i Bluetooth-vælgeren; navnet vises efter overførslen.' : 'No Bluetooth name is registered. Choose the correct physical display in the Bluetooth picker; its name is shown after transfer.')}</p>
            {!bluetoothSupported && <p className="text-xs text-fg2 m-0">{t.pushUnsupported}</p>}
          </div>
        </details>
      </div>
    </Card>
  );
}
