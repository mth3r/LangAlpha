import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '../lib/queryKeys';
import { getPreferences } from '../pages/Dashboard/utils/api';
import type { UserPreferences } from '../types/api';

/**
 * Shared hook for user preferences.
 * Replaces manual useEffect+useState fetching of /api/v1/users/me/preferences.
 * All consumers share a single cached entry — updates propagate automatically.
 */
export function usePreferences() {
  const { data, ...rest } = useQuery({
    queryKey: queryKeys.user.preferences(),
    queryFn: getPreferences as () => Promise<UserPreferences>,
    staleTime: 5 * 60_000,
    retry: false,
  });
  return { preferences: data ?? null, ...rest };
}
