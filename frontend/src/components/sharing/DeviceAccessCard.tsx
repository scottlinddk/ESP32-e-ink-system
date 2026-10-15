import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { getDeviceShares, revokeDeviceShare, shareDevice, type ShareRole } from '../../lib/api';
import { useApp } from '../../lib/appContext';
import { useAuth } from '../../hooks/useAuth';
import { useApiToken, useConnections, useDeviceList, useInvalidateSharing, userLabel } from '../../hooks/useSharing';
import { Card } from '../ui/card';
import { Button } from '../ui/button';
import { Chip } from '../ui/Chip';

const roleName = (role: ShareRole, da: boolean) => role === 'editor' ? (da ? 'Redaktør' : 'Editor') : (da ? 'Kan se' : 'Viewer');

/** The owner decides who may look at, or edit, each of their devices. */
export function DeviceAccessCard() {
  const { lang } = useApp();
  const da = lang === 'da';
  const devices = useDeviceList();
  const owned = devices.data?.devices ?? [];
  return <Card icon="share" title={da ? 'Del dine enheder' : 'Share your devices'}
    desc={da ? 'Samarbejdspartnere ser enhedens skærm med dine datakilder. De ser aldrig dine nøgler, adgangskoder eller private feed-adresser.' : 'Collaborators see the device’s screen drawn with your data sources. They never see your keys, passwords or private feed URLs.'}>
    {devices.isPending && <p className="text-sm text-fg2 m-0">{da ? 'Henter…' : 'Loading…'}</p>}
    {devices.isSuccess && owned.length === 0 && <p className="text-sm text-fg2 m-0">{da ? 'Du har ingen enheder at dele endnu.' : 'You have no devices to share yet.'}</p>}
    <div className="flex flex-col gap-5">{owned.map((device) => <DeviceAccess key={device.id} deviceId={device.id} name={device.device_name} />)}</div>
  </Card>;
}

function DeviceAccess({ deviceId, name }: { deviceId: string; name: string }) {
  const { lang, toast } = useApp();
  const da = lang === 'da';
  const { user } = useAuth();
  const token = useApiToken();
  const refresh = useInvalidateSharing();
  const connections = useConnections();
  const [person, setPerson] = useState('');
  const [role, setRole] = useState<ShareRole>('viewer');
  const shares = useQuery({ queryKey: ['device-shares', user?.id, deviceId], queryFn: async () => (await getDeviceShares(await token(), deviceId)).shares });
  const fail = (error: unknown) => toast({ type: 'error', title: error instanceof Error ? error.message : (da ? 'Noget gik galt.' : 'Something went wrong.') });
  const done = () => { void shares.refetch(); refresh('device-shares'); };

  const add = useMutation({ mutationFn: async (input: { id: string; role: ShareRole }) => shareDevice(await token(), deviceId, input.id, input.role), onSuccess: () => { setPerson(''); done(); }, onError: fail });
  const revoke = useMutation({ mutationFn: async (id: string) => revokeDeviceShare(await token(), deviceId, id), onSuccess: done, onError: fail });

  const sharedIds = new Set(shares.data?.map((share) => share.collaborator.id));
  const available = (connections.data ?? []).filter((row) => row.status === 'connected' && !sharedIds.has(row.user.id));

  return <section aria-label={name}>
    <h3 className="text-sm font-medium m-0 mb-2">{name}</h3>
    {shares.isError && <p role="alert" className="text-sm text-error m-0">{da ? 'Kunne ikke hente adgang.' : 'Could not load access.'}</p>}
    <ul className="list-none p-0 m-0 flex flex-col gap-2">{shares.data?.map((share) => <li key={share.collaborator.id} className="flex items-center gap-3 justify-between flex-wrap">
      <span className="text-sm">{userLabel(share.collaborator)} <Chip variant={share.role === 'editor' ? 'info' : 'default'}>{roleName(share.role, da)}</Chip></span>
      <span className="flex gap-2">
        <Button size="sm" variant="outlined" loading={add.isPending && add.variables?.id === share.collaborator.id}
          onClick={() => add.mutate({ id: share.collaborator.id, role: share.role === 'editor' ? 'viewer' : 'editor' })}>
          {share.role === 'editor' ? (da ? 'Gør til “kan se”' : 'Make viewer') : (da ? 'Gør til redaktør' : 'Make editor')}</Button>
        <Button size="sm" variant="danger-outlined" onClick={() => revoke.mutate(share.collaborator.id)}>{da ? 'Fjern adgang' : 'Remove access'}</Button>
      </span>
    </li>)}</ul>
    {shares.isSuccess && shares.data.length === 0 && <p className="text-sm text-fg2 m-0">{da ? 'Ikke delt med nogen.' : 'Not shared with anyone.'}</p>}
    <form className="flex gap-2 items-center mt-3 flex-wrap" onSubmit={(event) => { event.preventDefault(); if (person) add.mutate({ id: person, role }); }}>
      <select className="select-native" aria-label={`${da ? 'Vælg forbindelse for' : 'Choose a connection for'} ${name}`} value={person} onChange={(event) => setPerson(event.target.value)} disabled={available.length === 0}>
        <option value="">{available.length === 0 ? (da ? 'Ingen forbindelser at tilføje' : 'No connections to add') : (da ? 'Vælg en forbindelse…' : 'Choose a connection…')}</option>
        {available.map((row) => <option key={row.user.id} value={row.user.id}>{userLabel(row.user)}</option>)}
      </select>
      <select className="select-native" aria-label={da ? 'Rolle' : 'Role'} value={role} onChange={(event) => setRole(event.target.value as ShareRole)}>
        <option value="viewer">{da ? 'Kan se' : 'Viewer: can see the screen'}</option>
        <option value="editor">{da ? 'Redaktør' : 'Editor: can change layouts'}</option>
      </select>
      <Button type="submit" size="sm" icon="person_add" disabled={!person} loading={add.isPending && add.variables?.id === person}>{da ? 'Del' : 'Share'}</Button>
    </form>
  </section>;
}
