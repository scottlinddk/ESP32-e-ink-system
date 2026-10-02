import React, { useLayoutEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../hooks/useAuth';
import { useApp } from '../../lib/appContext';
import { getDeviceDeliveryStatus, requestDeviceRefresh, type DeviceDeliveryStatus } from '../../lib/api';
import { Button } from '../ui/button';

export function deviceRefreshPending(status?: DeviceDeliveryStatus): boolean {
  return !!(status?.configured && status.refreshRequestId && !status.refreshAppliedAt);
}

interface Props { deviceId: string; deviceName?: string; hardwareId?: string; timezone: string }
export function DeviceRefreshControl(props: Props) {
  const { user, isSignedIn } = useAuth();
  return isSignedIn && user ? <RefreshControl key={`${user.id}:${props.deviceId}`} {...props} /> : null;
}

function RefreshControl({ deviceId, deviceName, hardwareId, timezone }: Props) {
  const { user, getToken } = useAuth();
  const { lang } = useApp();
  const da = lang === 'da';
  const queryClient = useQueryClient();
  const queryKey = ['device-delivery', user!.id, deviceId];
  const activeRequest = useRef<AbortController | null>(null);
  useLayoutEffect(() => () => { activeRequest.current?.abort(); }, []);
  const status = useQuery({
    queryKey,
    queryFn: async ({ signal }) => {
      const token = await getToken();
      signal.throwIfAborted();
      if (!token) throw new Error(da ? 'Log ind igen.' : 'Please sign in again.');
      return getDeviceDeliveryStatus(token, deviceId, signal);
    },
    staleTime: 60_000, retry: false, refetchOnWindowFocus: false,
    refetchInterval: (query) => deviceRefreshPending(query.state.data) ? 60_000 : false,
  });
  const refresh = useMutation({
    mutationFn: async () => {
      activeRequest.current?.abort();
      const controller = new AbortController();
      activeRequest.current = controller;
      // A status read started before this request must not replace the queued result.
      await queryClient.cancelQueries({ queryKey, exact: true });
      const token = await getToken();
      controller.signal.throwIfAborted();
      if (!token) throw new Error(da ? 'Log ind igen.' : 'Please sign in again.');
      const result = await requestDeviceRefresh(token, deviceId, controller.signal);
      // A shared observer may have started another read while the POST was pending.
      await queryClient.cancelQueries({ queryKey, exact: true });
      controller.signal.throwIfAborted();
      queryClient.setQueryData(queryKey, result);
      return result;
    },
    retry: false,
  });
  const report = status.data;
  const pending = deviceRefreshPending(report);
  const format = (value: string) => `${new Date(value).toLocaleString(da ? 'da-DK' : 'en-GB', { timeZone: timezone })} · ${timezone}`;

  return <section aria-label={da ? 'Opdatér fysisk skærm' : 'Update physical screen'} className="border-t border-divider pt-3 grid gap-2 text-xs">
    <strong>{deviceName || deviceId}{hardwareId ? ` · ${hardwareId}` : ''}</strong>
    <div className="flex flex-wrap gap-2">
      <Button size="sm" icon="sync" loading={refresh.isPending}
        disabled={status.isPending || status.isError || !report?.configured || pending}
        onClick={() => refresh.mutate()}>{da ? 'Opdatér enhedens skærm' : 'Update device screen'}</Button>
      {(pending || status.isError) && <Button size="sm" variant="text" disabled={status.isFetching || refresh.isPending}
        onClick={() => void status.refetch()}>{da ? 'Tjek status' : 'Check status'}</Button>}
    </div>
    {status.isPending ? <p role="status" className="m-0">{da ? 'Henter leveringsstatus…' : 'Loading delivery status…'}</p>
      : status.isError ? <p role="alert" className="m-0 text-warning">{da ? 'Kunne ikke hente leveringsstatus.' : 'Could not load delivery status.'} {status.error.message}</p>
      : !report?.configured ? <p className="m-0">{da ? 'Automatiske opdateringer skal konfigureres først. ' : 'Set up automatic updates first. '}
        <Link className="underline" to={`/devices#device-${encodeURIComponent(deviceId)}`}>{da ? 'Åbn enhedens opsætning' : 'Open device setup'}</Link></p>
      : pending ? <p role="status" className="m-0">{da ? 'I kø — venter på næste kontakt fra enheden.' : 'Queued — waiting for the next device check-in.'}
        {report.refreshRequestedAt && <> <time dateTime={report.refreshRequestedAt}>{format(report.refreshRequestedAt)}</time></>}</p>
      : report.refreshRequestId && report.refreshAppliedAt ? <p role="status" className="m-0">{da ? 'Enheden har rapporteret, at opdateringen blev anvendt.' : 'The device reported applying the update.'}
        {' '}<time dateTime={report.refreshAppliedAt}>{format(report.refreshAppliedAt)}</time></p> : null}
    {refresh.isError && <p role="alert" className="m-0 text-warning">{da ? 'Kunne ikke anmode om opdatering.' : 'Could not request an update.'} {refresh.error.message}</p>}
    <p className="m-0 text-fg2">{da
      ? 'Anmodningen gemmes til næste kontakt fra enheden og kan tilsidesætte stille timer. Den vækker ikke en sovende skærm; næste planlagte kontakt kan være efter de stille timer. Status bekræfter enhedens rapport, ikke en visuel kontrol af skærmen.'
      : 'The request is queued for the next device check-in and can override quiet hours. It does not wake a sleeping display; the next scheduled check-in may be after quiet hours. Status confirms the device’s report, not a visual check of the screen.'}</p>
  </section>;
}
