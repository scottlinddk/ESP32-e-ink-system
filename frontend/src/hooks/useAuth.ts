import { useAuth as useClerkAuth, useUser } from '@clerk/react-router';
import { useCallback } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { loginUser } from '../lib/api';

/**
 * Unified auth hook — wraps Clerk and provides token-fetching helpers
 */
export function useAuth() {
  const { isLoaded, isSignedIn, getToken, signOut } = useClerkAuth();
  const { user } = useUser();
  const queryClient = useQueryClient();

  const getAuthToken = useCallback(async (): Promise<string | null> => {
    if (!isSignedIn) return null;
    return getToken();
  }, [isSignedIn, getToken]);

  const handleSignOut = useCallback(async () => {
    await signOut();
    queryClient.clear();
  }, [signOut, queryClient]);

  return {
    isLoaded,
    isSignedIn: isSignedIn ?? false,
    user,
    getToken: getAuthToken,
    signOut: handleSignOut,
  };
}

/**
 * Hook to sync Clerk user into our backend after sign-in
 */
export function useSyncUser() {
  const { getToken } = useAuth();

  return useMutation({
    mutationFn: async () => {
      const token = await getToken();
      if (!token) throw new Error('Not authenticated');
      return loginUser(token);
    },
  });
}
