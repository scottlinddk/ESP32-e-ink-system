import { useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from './useAuth';
import { getConnections, getDevices, getSharedItems } from '../lib/api';

/** A fresh Clerk token, or an error the mutation/query surfaces. */
export function useApiToken() {
  const { getToken } = useAuth();
  return useCallback(async () => {
    const token = await getToken();
    if (!token) throw new Error('Please sign in again.');
    return token;
  }, [getToken]);
}

export function useConnections() {
  const { user } = useAuth();
  const token = useApiToken();
  return useQuery({ queryKey: ['connections', user?.id], enabled: !!user?.id, queryFn: async () => (await getConnections(await token())).connections });
}

/** Shares the cache entry the dashboard uses for the device list. */
export function useDeviceList() {
  const { user } = useAuth();
  const token = useApiToken();
  return useQuery({ queryKey: ['devices', user?.id], enabled: !!user?.id, queryFn: async () => getDevices(await token()) });
}

export function useSharedItems(box: 'inbox' | 'sent') {
  const { user } = useAuth();
  const token = useApiToken();
  return useQuery({ queryKey: ['shared-items', user?.id, box], enabled: !!user?.id, queryFn: async () => (await getSharedItems(await token(), box)).items });
}

/** Refreshes everything sharing touches after a change. */
export function useInvalidateSharing() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  return useCallback((...keys: Array<'connections' | 'shared-items' | 'devices' | 'device-shares'>) => {
    for (const key of keys) void queryClient.invalidateQueries({ queryKey: [key, user?.id] });
  }, [queryClient, user?.id]);
}

export const userLabel = (user: { email: string; display_name: string | null }) => user.display_name ? `${user.display_name} (${user.email})` : user.email;
