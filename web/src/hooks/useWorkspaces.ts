import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { queryKeys } from '../lib/queryKeys';
import { getWorkspaces } from '../pages/ChatAgent/utils/api';

interface UseWorkspacesOptions {
  limit?: number;
  offset?: number;
  sortBy?: string;
  enabled?: boolean;
}

/**
 * Shared hook for workspace list queries.
 * Uses keepPreviousData for smooth pagination transitions.
 * All consumers with the same params share one cached entry.
 */
export function useWorkspaces({ limit = 20, offset = 0, sortBy = 'custom', enabled = true }: UseWorkspacesOptions = {}) {
  const params = { limit, offset, sortBy };
  return useQuery({
    queryKey: queryKeys.workspaces.list(params),
    queryFn: () => getWorkspaces(limit, offset, sortBy),
    enabled,
    staleTime: 30_000,
    placeholderData: keepPreviousData,
  });
}
