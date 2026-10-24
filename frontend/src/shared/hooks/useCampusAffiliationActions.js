import { useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { campusAffiliationApi } from '@shared/api/apiClient';
import { useAuth } from '@shared/context/AuthContext';
import { applyAffiliationToUser, CAMPUS_AFFILIATION_QUERY_KEY } from '@shared/lib/campusAccess';
import { dropCampusCaches } from '@shared/lib/campusCache';

/**
 * The three writes of the college-email flow, each followed by the same
 * bookkeeping: the signed-in user is patched in place (no re-login), and every
 * campus cache is dropped so nothing from a previous state survives.
 *
 * Errors are thrown as they come from the transport (`err.code` carries the
 * contract's code); callers turn them into words with `describeCampusOtpError`.
 */
export function useCampusAffiliationActions() {
  const { currentUser, updateCurrentUser, refreshCurrentUser } = useAuth();
  const queryClient = useQueryClient();
  const userId = currentUser?.id;

  const sendCode = useCallback(
    async ({ collegeId, email, reauthToken }) => {
      const res = await campusAffiliationApi.sendOtp({ collegeId, email, reauthToken });
      // The pending state now lives on the server; let the status query see it.
      queryClient.invalidateQueries({ queryKey: CAMPUS_AFFILIATION_QUERY_KEY });
      return res;
    },
    [queryClient],
  );

  const applyAffiliation = useCallback(
    (affiliation) => {
      if (currentUser && updateCurrentUser) {
        updateCurrentUser(applyAffiliationToUser(currentUser, affiliation));
      }
      dropCampusCaches(queryClient);
      queryClient.setQueryData([...CAMPUS_AFFILIATION_QUERY_KEY, userId], {
        legacy: false,
        affiliation: affiliation || null,
        pending: null,
      });
      queryClient.invalidateQueries({ queryKey: ['profile'] });
      // Settings → Email shows the college cooldown this change just started.
      queryClient.invalidateQueries({ queryKey: ['account', 'email'] });
      // The server's copy of the user is the truth for everything the patch
      // above cannot know (profileCompletion, mirrored fields). Background.
      Promise.resolve(refreshCurrentUser?.()).catch(() => {});
    },
    [currentUser, updateCurrentUser, queryClient, userId, refreshCurrentUser],
  );

  const verifyCode = useCallback(
    async (code, reauthToken) => {
      const res = await campusAffiliationApi.verify({ code, reauthToken });
      const affiliation = res?.affiliation || null;
      applyAffiliation(affiliation);
      return affiliation;
    },
    [applyAffiliation],
  );

  const removeAffiliation = useCallback(
    async (reauthToken) => {
      await campusAffiliationApi.remove({ reauthToken });
      applyAffiliation(null);
    },
    [applyAffiliation],
  );

  return { sendCode, verifyCode, removeAffiliation, applyAffiliation };
}
