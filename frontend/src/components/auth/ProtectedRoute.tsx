import { useAuth } from '@clerk/clerk-react';
import { Navigate, useLocation } from 'react-router-dom';
import { FullPageSpinner } from '@/components/common/LoadingSpinner';
import { useApp } from '@/lib/appContext';

interface ProtectedRouteProps {
  children: React.ReactNode;
}

export function ProtectedRoute({ children }: ProtectedRouteProps) {
  const { isLoaded, isSignedIn } = useAuth();
  const location = useLocation();
  const { t } = useApp();

  if (!isLoaded) {
    return <FullPageSpinner label={t.verifyingSession} />;
  }

  if (!isSignedIn) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return <>{children}</>;
}
