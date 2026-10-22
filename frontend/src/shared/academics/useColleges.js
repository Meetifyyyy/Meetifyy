import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@shared/api/apiClient';

/**
 * The college list changes when an admin adds a college — rarely, and never
 * mid-session in a way a picker must see at once. It used to be refetched on
 * every mount; now it is fetched once and shared for a day, the same lifetime
 * `academicCatalog` gives the course catalog. A failed fetch is not cached.
 */
export const COLLEGES_QUERY_KEY = ['academics', 'colleges'];
const DAY_MS = 24 * 60 * 60 * 1000;

export async function fetchColleges() {
  const res = await apiClient.get('/api/academics/colleges');
  return Array.isArray(res?.colleges) ? res.colleges : [];
}

const EMPTY = [];

export function useColleges() {
  const query = useQuery({
    queryKey: COLLEGES_QUERY_KEY,
    queryFn: fetchColleges,
    staleTime: DAY_MS,
    gcTime: DAY_MS,
    refetchOnWindowFocus: false,
    retry: 1,
  });

  return {
    colleges: query.data ?? EMPTY,
    loading: query.isPending,
    error: query.error ? (query.error.message || 'Failed to load colleges') : null,
  };
}
