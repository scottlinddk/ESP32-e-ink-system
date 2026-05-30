import { useQuery } from '@tanstack/react-query';
import { useAuth } from './useAuth';
import { getPreviewData } from '../lib/api';
import { UserPreferences } from '../types';

const PREVIEW_QUERY_KEY = ['preview'] as const;

/**
 * Fetches live preview data from the backend.
 * Refreshes when preferences change (via queryClient.invalidateQueries).
 */
export function useDisplayPreview(preferences?: UserPreferences | null) {
  const { getToken, isSignedIn } = useAuth();

  return useQuery({
    queryKey: [...PREVIEW_QUERY_KEY, preferences],
    enabled: isSignedIn,
    queryFn: async () => {
      const token = await getToken();
      if (!token) throw new Error('Not authenticated');
      return getPreviewData(token);
    },
    staleTime: 10 * 60 * 1000, // 10 minutes — backend caches for longer
    refetchInterval: false,
  });
}

/**
 * Returns a mock display data object built from preferences alone.
 * Used for instant local preview before the API returns.
 */
export function useMockDisplayData(preferences: UserPreferences | null | undefined) {
  if (!preferences) return null;

  return {
    price: preferences.show_energy_price
      ? { now: 142.5, average: 118.3, trend: 'up' as const }
      : undefined,
    weather: preferences.show_weather
      ? { temp: 12, condition: 'cloudy', windSpeed: 6, icon: '04d' }
      : undefined,
    news: preferences.show_news
      ? [
          { title: 'Energipriserne stiger i Danmark', url: '#' },
          { title: 'Nyt vejrsystem passerer Jylland', url: '#' },
          { title: 'Solceller slår rekord i Europa', url: '#' },
        ]
      : undefined,
    nextRefresh: preferences.refresh_interval_minutes * 60 * 1000,
  };
}
