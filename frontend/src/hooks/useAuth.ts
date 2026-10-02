import { useAuth as useClerkAuth, useClerk, useUser } from '@clerk/clerk-react';
import { useCallback } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { loginUser } from '../lib/api';

/**
 * Unified auth hook — wraps Clerk and provides token-fetching helpers
 */
export function useAuth() {
  const { isLoaded, isSignedIn, getToken, signOut } = useClerkAuth();
  const { user } = useUser();
  const clerk = useClerk();
  const queryClient = useQueryClient();

  const getAuthToken = useCallback(async (): Promise<string | null> => {
    const owner = user?.id;
    if (!isSignedIn || !owner || clerk.user?.id !== owner) return null;
    const token = await getToken();
    // Check Clerk's live account, so route navigation can reuse in-flight queries
    // but an old form can never continue with another account's token.
    return clerk.user?.id === owner ? token : null;
  }, [isSignedIn, getToken, user?.id, clerk]);

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
