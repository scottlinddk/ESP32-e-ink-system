import React, { useLayoutEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../hooks/useAuth';
import { useApp } from '../../lib/appContext';
import { getDeviceDeliveryStatus, requestDeviceRefresh, setDeviceInstantUpdates, type DeviceDeliveryStatus } from '../../lib/api';
import { Button } from '../ui/button';
import { Switch } from '../ui/Switch';

export function deviceRefreshPending(status?: DeviceDeliveryStatus): boolean {
  return !!(status?.configured && status.refreshRequestId && !status.refreshAppliedAt);
}

/** An online device applies a request within seconds; stop fast polling if it never answers. */
const INSTANT_POLL_MS = 3_000;
const INSTANT_POLL_WINDOW_MS = 2 * 60_000;
export function deviceRefreshPollInterval(status: DeviceDeliveryStatus | undefined, now = Date.now()): number | false {
  if (!deviceRefreshPending(status)) return false;
  const requestedAt = Date.parse(status!.refreshRequestedAt ?? '');
  const recent = Number.isFinite(requestedAt) && now - requestedAt < INSTANT_POLL_WINDOW_MS;
  return status!.instantUpdates && recent ? INSTANT_POLL_MS : 60_000;
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
    refetchInterval: (query) => deviceRefreshPollInterval(query.state.data),
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
  const instant = useMutation({
    mutationFn: async (enabled: boolean) => {
      await queryClient.cancelQueries({ queryKey, exact: true });
      const token = await getToken();
      if (!token) throw new Error(da ? 'Log ind igen.' : 'Please sign in again.');
      const result = await setDeviceInstantUpdates(token, deviceId, enabled);
      queryClient.setQueryData(queryKey, result);
      return result;
    },
    retry: false,
  });
  const report = status.data;
  const pending = deviceRefreshPending(report);
  const instantOn = report?.instantUpdates === true;
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
      : pending && instantOn ? <p role="status" className="m-0">{da ? 'Sendt — skærmen opdateres om få sekunder, når enheden er online.' : 'Sent — the screen updates within seconds while the device is online.'}
        {report.refreshRequestedAt && <> <time dateTime={report.refreshRequestedAt}>{format(report.refreshRequestedAt)}</time></>}</p>
      : pending ? <p role="status" className="m-0">{da ? 'I kø — venter på næste kontakt fra enheden.' : 'Queued — waiting for the next device check-in.'}
        {report.refreshRequestedAt && <> <time dateTime={report.refreshRequestedAt}>{format(report.refreshRequestedAt)}</time></>}</p>
      : report.refreshRequestId && report.refreshAppliedAt ? <p role="status" className="m-0">{da ? 'Enheden har rapporteret, at opdateringen blev anvendt.' : 'The device reported applying the update.'}
        {' '}<time dateTime={report.refreshAppliedAt}>{format(report.refreshAppliedAt)}</time></p> : null}
    {refresh.isError && <p role="alert" className="m-0 text-warning">{da ? 'Kunne ikke anmode om opdatering.' : 'Could not request an update.'} {refresh.error.message}</p>}
    {report?.configured && <label className="flex items-center gap-2">
      <Switch checked={instantOn} disabled={instant.isPending}
        onChange={(event) => instant.mutate(event.target.checked)}
        label={da ? 'Øjeblikkelige opdateringer (USB-strøm)' : 'Instant updates (USB power)'} />
      <span>{da ? 'Øjeblikkelige opdateringer (USB-strøm)' : 'Instant updates (USB power)'}</span>
    </label>}
    {instant.isError && <p role="alert" className="m-0 text-warning">{da ? 'Kunne ikke ændre øjeblikkelige opdateringer.' : 'Could not change instant updates.'} {instant.error.message}</p>}
    <p className="m-0 text-fg2">{instantOn ? (da
      ? 'Enheden forbliver online og spørger efter anmodninger med få sekunders mellemrum, så en opdatering normalt vises inden for ca. 10 sekunder og kan tilsidesætte stille timer. Brug kun med USB-strøm: et batteri aflades hurtigt. Kræver opdateret firmware; en sovende enhed skifter tilstand ved sin næste planlagte kontakt. Status bekræfter enhedens rapport, ikke en visuel kontrol af skærmen.'
      : 'The device stays online and checks for requests every few seconds, so an update usually appears within about 10 seconds and can override quiet hours. Use only with USB power: staying online drains a battery quickly. Requires updated firmware; a sleeping device switches mode at its next scheduled check-in. Status confirms the device’s report, not a visual check of the screen.')
      : da
      ? 'Anmodningen gemmes til næste kontakt fra enheden og kan tilsidesætte stille timer. Den vækker ikke en sovende skærm; næste planlagte kontakt kan være efter de stille timer. Slå øjeblikkelige opdateringer til for USB-forsynede skærme for at undgå ventetiden. Status bekræfter enhedens rapport, ikke en visuel kontrol af skærmen.'
      : 'The request is queued for the next device check-in and can override quiet hours. It does not wake a sleeping display; the next scheduled check-in may be after quiet hours. Turn on instant updates for USB-powered displays to skip the wait. Status confirms the device’s report, not a visual check of the screen.'}</p>
  </section>;
}
