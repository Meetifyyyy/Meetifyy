import { idbDelete } from '@shared/lib/idb';
import { CAMPUS_AFFILIATION_QUERY_KEY, CAMPUS_GATED_QUERY_KEYS } from '@shared/lib/campusAccess';

/**
 * Drops every cached piece of campus content, in memory and in the IndexedDB
 * mirrors behind the directory and campus communities.
 *
 * Called whenever access to Campus changes in either direction: losing it must
 * take the old college's content with it (locking the page only hides it), and
 * gaining or switching it must not show another college's cached lists.
 */
export function dropCampusCaches(queryClient) {
  for (const key of CAMPUS_GATED_QUERY_KEYS) {
    queryClient.removeQueries({ queryKey: key });
  }
  // Campus activities are scoped to the college too.
  queryClient.removeQueries({ queryKey: ['activities', 'campus'] });
  queryClient.removeQueries({ queryKey: ['activities', 'college'] });
  queryClient.invalidateQueries({ queryKey: CAMPUS_AFFILIATION_QUERY_KEY });
  idbDelete('profiles', 'campus_users').catch(() => {});
  idbDelete('communities', 'campus').catch(() => {});
}
