import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { fetchPreviewBmp, revokeDeviceShare, type SharedDevice } from '../../lib/api';
import { useApp } from '../../lib/appContext';
import { useApiToken, useDeviceList, useInvalidateSharing, userLabel } from '../../hooks/useSharing';
import { Card } from '../ui/card';
import { Button } from '../ui/button';
import { Chip } from '../ui/Chip';

/** The saved screen, drawn by the server with the owner's data. Pixels only: no settings are fetched. */
function SharedPreview({ device }: { device: SharedDevice }) {
  const { lang } = useApp();
  const da = lang === 'da';
  const token = useApiToken();
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    let objectUrl: string | null = null;
    setUrl(null); setFailed(false);
    token().then((value) => fetchPreviewBmp(value, controller.signal, device.id)).then(({ blob }) => {
      objectUrl = URL.createObjectURL(blob); setUrl(objectUrl);
    }).catch(() => { if (!controller.signal.aborted) setFailed(true); });
    return () => { controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [device.id, token]);
  if (failed) return <p role="alert" className="text-sm text-fg2 m-0">{da ? 'Forhåndsvisningen er ikke tilgængelig lige nu.' : 'The preview is not available right now.'}</p>;
  if (!url) return <p role="status" className="text-sm text-fg2 m-0">{da ? 'Henter forhåndsvisning…' : 'Loading preview…'}</p>;
  return <img src={url} alt={`${da ? 'Forhåndsvisning af' : 'Preview of'} ${device.device_name}`} className="w-full max-w-[500px] border border-border rounded-sm bg-white" style={{ imageRendering: 'pixelated' }} />;
}

export function SharedWithMeCard() {
  const { lang, toast } = useApp();
  const da = lang === 'da';
  const token = useApiToken();
  const devices = useDeviceList();
  const refresh = useInvalidateSharing();
  const leave = useMutation({
    mutationFn: async (deviceId: string) => revokeDeviceShare(await token(), deviceId, 'me'),
    onSuccess: () => refresh('devices'),
    onError: (error) => toast({ type: 'error', title: error instanceof Error ? error.message : (da ? 'Noget gik galt.' : 'Something went wrong.') }),
  });
  const shared = devices.data?.shared_devices ?? [];
  if (devices.isSuccess && shared.length === 0) return null;

  return <Card icon="devices" title={da ? 'Delt med dig' : 'Shared with you'}
    desc={da ? 'Enheder andre har givet dig adgang til. Skærmen tegnes med ejerens datakilder.' : 'Devices other people gave you access to. The screen is drawn with the owner’s data sources.'}>
    <div className="flex flex-col gap-6">{shared.map((device) => <section key={device.id} aria-label={device.device_name}>
      <div className="flex items-center gap-3 justify-between flex-wrap mb-3">
        <div><h3 className="text-sm font-medium m-0">{device.device_name}</h3>
          <p className="text-xs text-fg2 m-0">{da ? 'Ejer' : 'Owner'}: {userLabel(device.owner)}</p></div>
        <span className="flex items-center gap-2">
          <Chip variant={device.role === 'editor' ? 'info' : 'default'}>{device.role === 'editor' ? (da ? 'Redaktør' : 'Editor') : (da ? 'Kan se' : 'Viewer')}</Chip>
          {device.role === 'editor' && <Link to={`/layout?device=${encodeURIComponent(device.id)}`} className="text-sm text-accent no-underline">{da ? 'Redigér layout' : 'Edit layout'}</Link>}
          <Button size="sm" variant="outlined" loading={leave.isPending && leave.variables === device.id}
            onClick={() => { if (window.confirm(da ? `Forlad ${device.device_name}? Du mister adgangen.` : `Leave ${device.device_name}? You lose access.`)) leave.mutate(device.id); }}>
            {da ? 'Forlad' : 'Leave'}</Button>
        </span>
      </div>
      <SharedPreview device={device} />
    </section>)}</div>
  </Card>;
}
