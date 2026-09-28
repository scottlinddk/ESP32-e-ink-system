import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../hooks/useAuth';
import { useApp } from '../../lib/appContext';
import { createDeviceDeliveryToken, getDeviceDeliveryStatus, revokeDeviceDeliveryToken } from '../../lib/api';
import { Button } from '../ui/button';

export function DeviceDeliveryCard({ deviceId }: { deviceId: string }) {
  const { user } = useAuth();
  return <DeliverySettings key={`${user?.id ?? 'signed-out'}:${deviceId}`} deviceId={deviceId} />;
}
function DeliverySettings({ deviceId }: { deviceId: string }) {
  const { user, getToken, isSignedIn } = useAuth();
  const { lang } = useApp();
  const da = lang === 'da';
  const queryClient = useQueryClient();
  const queryKey = ['device-delivery', user?.id, deviceId];
  const [secret, setSecret] = useState('');
  const [error, setError] = useState('');
  const token = async () => { const value = await getToken(); if (!value) throw new Error('Please sign in again'); return value; };
  const status = useQuery({ queryKey, enabled: isSignedIn, queryFn: async () => getDeviceDeliveryStatus(await token(), deviceId) });
  const change = useMutation({
    mutationFn: async (revoke: boolean) => {
      setSecret(''); setError('');
      if (revoke) { await revokeDeviceDeliveryToken(await token(), deviceId); return ''; }
      return (await createDeviceDeliveryToken(await token(), deviceId)).token;
    },
    onSuccess: (created) => { setSecret(created); void queryClient.invalidateQueries({ queryKey }); },
    onError: (err: Error) => setError(err.message),
  });
  const report = status.data;
  return (
    <details className="col-span-full border-t border-divider pt-3 text-sm">
      <summary className="cursor-pointer font-medium">{da ? 'Automatiske opdateringer' : 'Automatic updates'}</summary>
      <div className="grid gap-3 pt-3">
        <p className="m-0 text-fg2">{da ? 'Forbind referenceklienten til denne enhed med et enhedstoken. Et nyt token erstatter det gamle.' : 'Connect the reference client to this device with a device token. Creating a new token replaces the previous one.'}</p>
        <p className="m-0">{status.isPending ? (da ? 'Indlæser…' : 'Loading…') : status.isError ? (da ? 'Kunne ikke hente status' : 'Could not load status') : report?.configured ? (da ? 'Token aktivt' : 'Token active') : (da ? 'Intet aktivt token' : 'No active token')}</p>
        <div className="flex gap-2 flex-wrap">
          <Button size="sm" loading={change.isPending} disabled={!isSignedIn} onClick={() => change.mutate(false)}>{report?.configured ? (da ? 'Erstat token' : 'Replace token') : (da ? 'Opret token' : 'Create token')}</Button>
          {report?.configured && <Button size="sm" variant="danger-outlined" disabled={change.isPending} onClick={() => change.mutate(true)}>{da ? 'Tilbagekald token' : 'Revoke token'}</Button>}
          <Button size="sm" variant="text" onClick={() => status.refetch()}>{da ? 'Opdatér status' : 'Refresh status'}</Button>
        </div>
        {secret && <div className="grid gap-2">
          <p className="m-0">{da ? 'Kopiér nu. Tokenet vises kun denne gang og skal gemmes som DEVICE_TOKEN.' : 'Copy now. This token is shown only once; store it as DEVICE_TOKEN.'}</p>
          <code className="break-all rounded bg-black/5 p-3 select-all">{secret}</code>
          <Button size="sm" variant="text" onClick={() => setSecret('')}>{da ? 'Skjul token' : 'Hide token'}</Button>
        </div>}
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 m-0 text-fg2">
          <dt>DISPLAY_DEVICE_ID</dt><dd className="m-0 font-mono break-all">{deviceId}</dd>
          <dt>{da ? 'Seneste rapport' : 'Last report'}</dt><dd className="m-0">{report?.lastSeenAt ? new Date(report.lastSeenAt).toLocaleString() : (da ? 'Aldrig' : 'Never')}</dd>
          <dt>{da ? 'Rapporteret firmware' : 'Reported firmware'}</dt><dd className="m-0">{report?.firmwareVersion ?? '—'}</dd>
          <dt>{da ? 'Rapporteret batteri' : 'Reported battery'}</dt><dd className="m-0">{report?.batteryPercent == null ? '—' : `${report.batteryPercent}%`}</dd>
          <dt>RSSI</dt><dd className="m-0">{report?.rssi == null ? '—' : `${report.rssi} dBm`}</dd>
          <dt>{da ? 'Rapporteret anvendt billede' : 'Reported applied image'}</dt><dd className="m-0 font-mono break-all">{report?.lastAppliedHash ?? (da ? 'Ikke rapporteret' : 'Not reported')}</dd>
        </dl>
        {error && <p role="alert" className="m-0">{error}</p>}
      </div>
    </details>
  );
}
