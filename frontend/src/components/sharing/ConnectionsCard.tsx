import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { acceptConnection, removeConnection, requestConnection } from '../../lib/api';
import { useApp } from '../../lib/appContext';
import { useApiToken, useConnections, useInvalidateSharing, userLabel } from '../../hooks/useSharing';
import { Card } from '../ui/card';
import { Button } from '../ui/button';
import { Chip } from '../ui/Chip';
import { Field } from '../ui/Field';
import { Input } from '../ui/input';

export function ConnectionsCard() {
  const { lang, toast } = useApp();
  const da = lang === 'da';
  const token = useApiToken();
  const connections = useConnections();
  const refresh = useInvalidateSharing();
  const [email, setEmail] = useState('');
  const fail = (error: unknown) => toast({ type: 'error', title: error instanceof Error ? error.message : (da ? 'Noget gik galt.' : 'Something went wrong.') });

  const invite = useMutation({
    mutationFn: async () => requestConnection(await token(), email),
    onSuccess: () => {
      setEmail(''); refresh('connections');
      // Deliberately the same for every address: the app never confirms whether an account exists.
      toast({ type: 'success', title: da ? 'Hvis adressen har en konto, har personen fået din anmodning.' : 'If that address has an account, they now have your request.' });
    },
    onError: fail,
  });
  const accept = useMutation({ mutationFn: async (id: string) => acceptConnection(await token(), id), onSuccess: () => refresh('connections'), onError: fail });
  const remove = useMutation({ mutationFn: async (id: string) => removeConnection(await token(), id), onSuccess: () => refresh('connections', 'devices', 'shared-items'), onError: fail });

  const rows = connections.data ?? [];
  const incoming = rows.filter((row) => row.status === 'incoming');
  const connected = rows.filter((row) => row.status === 'connected');
  const outgoing = rows.filter((row) => row.status === 'outgoing');

  return <Card icon="group" title={da ? 'Forbindelser' : 'Connections'}
    desc={da ? 'Forbind med andre brugere via e-mail. Først når de accepterer, kan I dele enheder og indhold.' : 'Connect with other users by email. You can share devices and content once they accept.'}>
    <form className="flex gap-3 items-end max-[560px]:flex-col max-[560px]:items-stretch" onSubmit={(event) => { event.preventDefault(); if (email.trim()) invite.mutate(); }}>
      <div className="flex-1"><Field label={da ? 'E-mailadresse' : 'Email address'} htmlFor="connect-email">
        <Input id="connect-email" type="email" autoComplete="off" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="name@example.com" />
      </Field></div>
      <Button type="submit" icon="person_add" loading={invite.isPending} disabled={!email.trim()}>{da ? 'Send anmodning' : 'Send request'}</Button>
    </form>

    {connections.isPending && <p className="text-sm text-fg2 mt-4">{da ? 'Henter…' : 'Loading…'}</p>}
    {connections.isError && <p role="alert" className="text-sm text-error mt-4">{da ? 'Kunne ikke hente forbindelser.' : 'Could not load connections.'} <Button variant="text" onClick={() => void connections.refetch()}>{da ? 'Prøv igen' : 'Retry'}</Button></p>}

    {incoming.length > 0 && <section className="mt-5" aria-label={da ? 'Indkomne anmodninger' : 'Incoming requests'}>
      <h3 className="text-sm font-medium m-0 mb-2">{da ? 'Anmodninger til dig' : 'Requests for you'}</h3>
      <ul className="list-none p-0 m-0 flex flex-col gap-2">{incoming.map((row) => <li key={row.id} className="flex items-center gap-3 justify-between flex-wrap">
        <span className="text-sm">{userLabel(row.user)}</span>
        <span className="flex gap-2">
          <Button size="sm" loading={accept.isPending && accept.variables === row.id} onClick={() => accept.mutate(row.id)}>{da ? 'Acceptér' : 'Accept'}</Button>
          <Button size="sm" variant="outlined" onClick={() => remove.mutate(row.id)}>{da ? 'Afvis' : 'Decline'}</Button>
        </span>
      </li>)}</ul>
    </section>}

    {connected.length > 0 && <section className="mt-5" aria-label={da ? 'Forbundne' : 'Connected'}>
      <h3 className="text-sm font-medium m-0 mb-2">{da ? 'Forbundet' : 'Connected'}</h3>
      <ul className="list-none p-0 m-0 flex flex-col gap-2">{connected.map((row) => <li key={row.id} className="flex items-center gap-3 justify-between flex-wrap">
        <span className="text-sm">{userLabel(row.user)}</span>
        <Button size="sm" variant="danger-outlined" aria-label={`${da ? 'Afbryd forbindelsen til' : 'Disconnect'} ${row.user.email}`}
          onClick={() => { if (window.confirm(da ? `Afbryd forbindelsen til ${row.user.email}? Delte enheder fjernes for jer begge.` : `Disconnect from ${row.user.email}? Devices shared between you stop being shared.`)) remove.mutate(row.id); }}>
          {da ? 'Afbryd' : 'Disconnect'}</Button>
      </li>)}</ul>
    </section>}

    {outgoing.length > 0 && <section className="mt-5" aria-label={da ? 'Afsendte anmodninger' : 'Sent requests'}>
      <h3 className="text-sm font-medium m-0 mb-2">{da ? 'Afventer svar' : 'Waiting for a reply'}</h3>
      <ul className="list-none p-0 m-0 flex flex-col gap-2">{outgoing.map((row) => <li key={row.id} className="flex items-center gap-3 justify-between flex-wrap">
        <span className="text-sm">{userLabel(row.user)} <Chip variant="warning">{da ? 'Afventer' : 'Pending'}</Chip></span>
        <Button size="sm" variant="text" onClick={() => remove.mutate(row.id)}>{da ? 'Annullér' : 'Cancel'}</Button>
      </li>)}</ul>
    </section>}

    {connections.isSuccess && rows.length === 0 && <p className="text-sm text-fg2 mt-4 mb-0">{da ? 'Ingen forbindelser endnu.' : 'No connections yet.'}</p>}
  </Card>;
}
