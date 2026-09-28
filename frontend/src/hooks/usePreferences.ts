import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from './useAuth';
import { getPreferences, savePreferences, getApiKeys, saveApiKey } from '../lib/api';
import { UserPreferences } from '../types';

const PREFS_QUERY_KEY = ['preferences'] as const;
const API_KEYS_QUERY_KEY = ['api-keys'] as const;

export function usePreferences() {
  const { getToken, isSignedIn, user } = useAuth();

  return useQuery({
    queryKey: [...PREFS_QUERY_KEY, user?.id],
    enabled: isSignedIn && !!user?.id,
    queryFn: async () => {
      const token = await getToken();
      if (!token) throw new Error('Not authenticated');
      const result = await getPreferences(token);
      return result.preferences;
    },
    staleTime: 2 * 60 * 1000, // 2 minutes
  });
}

export function useSavePreferences() {
  const { getToken, user } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (prefs: Partial<UserPreferences>) => {
      const ownerId = user?.id;
      if (!ownerId) throw new Error('Not authenticated');
      const token = await getToken();
      if (!token) throw new Error('Not authenticated');
      const result = await savePreferences(token, prefs);
      // Capture the owner before awaiting. A completion after account switching
      // must never write the previous owner's data into the new owner's cache.
      queryClient.setQueryData([...PREFS_QUERY_KEY, ownerId], result.preferences);
      return result.preferences;
    },
    onSuccess: () => {
      // Invalidate preview data so it reflects new preferences
      queryClient.invalidateQueries({ queryKey: ['preview'] });
    },
  });
}

export function useApiKeys() {
  const { getToken, isSignedIn, user } = useAuth();

  return useQuery({
    queryKey: [...API_KEYS_QUERY_KEY, user?.id],
    enabled: isSignedIn && !!user?.id,
    queryFn: async () => {
      const token = await getToken();
      if (!token) throw new Error('Not authenticated');
      const result = await getApiKeys(token);
      return result.api_keys;
    },
  });
}

export function useSaveApiKey() {
  const { getToken } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ provider, api_key }: { provider: string; api_key: string }) => {
      const token = await getToken();
      if (!token) throw new Error('Not authenticated');
      const result = await saveApiKey(token, provider, api_key);
      return result.api_key;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: API_KEYS_QUERY_KEY });
      queryClient.invalidateQueries({ queryKey: ['preview'] });
    },
  });
}
