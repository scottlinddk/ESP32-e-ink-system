import { useEffect } from 'react';
import { Dashboard } from '@/components/dashboard/Dashboard';
import { useSyncUser } from '@/hooks/useAuth';
import { useAuth } from '@/hooks/useAuth';

/**
 * Dashboard page wrapper — syncs Clerk user into our backend on first load
 */
export function DashboardPage() {
  const { isSignedIn } = useAuth();
  const syncUser = useSyncUser();

  useEffect(() => {
    if (isSignedIn && !syncUser.isSuccess && !syncUser.isPending) {
      syncUser.mutate();
    }
  }, [isSignedIn]); // eslint-disable-line react-hooks/exhaustive-deps

  return <Dashboard />;
}
