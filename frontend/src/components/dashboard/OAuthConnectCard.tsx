import React, { useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useApp } from '../../lib/appContext';
import { useAuth } from '../../hooks/useAuth';
import { getOAuthAuthorizeUrl, getOAuthStatus, disconnectOAuth } from '../../lib/api';
import { Chip } from '../ui/Chip';
import { Button } from '../ui/button';

interface OAuthConnectCardProps {
  provider: 'strava' | 'google_calendar';
  name: string;
  icon: string;
  connectHint: string;
  onConnected?: () => void;
}

export function OAuthConnectCard({
  provider,
  name,
  icon,
  connectHint,
  onConnected,
}: OAuthConnectCardProps) {
  const app = useApp();
  const t = app.t;
  const { getToken } = useAuth();
  const queryClient = useQueryClient();
  const statusKey = ['oauth-status', provider];

  const { data: status } = useQuery({
    queryKey: statusKey,
    queryFn: async () => {
      const token = await getToken();
      if (!token) throw new Error('Not authenticated');
      return getOAuthStatus(token, provider);
    },
  });

  // If a fresh OAuth connection just landed (?strava=connected), refetch status
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get(provider === 'strava' ? 'strava' : 'gcal') === 'connected') {
      queryClient.invalidateQueries({ queryKey: statusKey });
      onConnected?.();
      const url = new URL(window.location.href);
      url.searchParams.delete(provider === 'strava' ? 'strava' : 'gcal');
      window.history.replaceState({}, '', url.toString());
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const connectMutation = useMutation({
    mutationFn: async () => {
      const token = await getToken();
      if (!token) throw new Error('Not authenticated');
      return getOAuthAuthorizeUrl(token, provider);
    },
    onSuccess: ({ url }) => {
      window.location.href = url;
    },
    onError: (e: Error) => {
      app.toast({ type: 'error', title: `Could not connect ${name}`, msg: e.message });
    },
  });

  const disconnectMutation = useMutation({
    mutationFn: async () => {
      const token = await getToken();
      if (!token) throw new Error('Not authenticated');
      return disconnectOAuth(token, provider);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: statusKey });
      app.toast({ type: 'info', title: `${name} disconnected` });
    },
    onError: (e: Error) => {
      app.toast({ type: 'error', title: `Failed to disconnect`, msg: e.message });
    },
  });

  const connected = status?.connected ?? false;

  return (
    <div className="bg-surface rounded-md border border-border px-4 py-3.5">
      <div className="flex items-center justify-between mb-2.5">
        <div className="font-medium">{name}</div>
        <Chip variant={connected ? 'success' : 'error'} dot>
          {connected ? t.stravaConnected : t.stravaNotConnected}
        </Chip>
      </div>
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <span className="text-xs text-fg3">{connectHint}</span>
        <div className="flex gap-2">
          {connected ? (
            <Button
              variant="text"
              size="sm"
              onClick={() => disconnectMutation.mutate()}
              loading={disconnectMutation.isPending}
            >
              {t.stravaDisconnect}
            </Button>
          ) : (
            <Button
              variant="outlined"
              size="sm"
              icon={icon}
              onClick={() => connectMutation.mutate()}
              loading={connectMutation.isPending}
            >
              {t.stravaConnectBtn}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
