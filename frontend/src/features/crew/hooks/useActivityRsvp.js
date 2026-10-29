import { useCallback } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { activitiesApi } from '@shared/api/apiClient';
import { useGuardedMutation } from '@shared/hooks/useGuardedMutation';
import { showToast } from '@shared/utils/toast';
import { idbDelete } from '@shared/lib/idb';

/**
 * The viewer's answer to an activity, from the detail payload:
 * 'in' (going), 'out' (not going) or null (has not answered).
 *
 * `isNotGoing` is new; `myStatus === 'DECLINED'` is the same fact from a server
 * that predates it.
 */
export function rsvpFromActivity(activity) {
  if (!activity) return null;
  if (activity.isJoined) return 'in';
  if (activity.isNotGoing || activity.myStatus === 'DECLINED') return 'out';
  return null;
}

const idOf = (p) => String(typeof p === 'object' ? (p?.id || p?.userId || p?.user?.id || '') : (p || ''));

/**
 * Applies an answer to the cached detail record so both buttons, the counts and
 * the two attendee lists move together, before the server confirms.
 */
export function patchRsvp(act, choice, currentUser) {
  if (!act || !currentUser) return act;
  const me = String(currentUser.id);
  const before = rsvpFromActivity(act);
  if (before === choice) return act;

  const wasIn = before === 'in';
  const wasOut = before === 'out';
  const goingIn = choice === 'in';

  const members = (act.members || []).filter((m) => String(m.userId) !== me);
  const notGoing = (act.notGoing || []).filter((m) => String(m.userId) !== me);
  const row = { userId: me, status: goingIn ? 'MEMBER' : 'DECLINED', user: currentUser };

  const participants = (Array.isArray(act.participants) ? act.participants : [])
    .map(idOf)
    .filter((p) => p && p !== me);

  const memberCount = typeof act.memberCount === 'number'
    ? Math.max(0, act.memberCount + (goingIn ? 1 : 0) - (wasIn ? 1 : 0))
    : act.memberCount;
  const notGoingCount = Math.max(
    0,
    (typeof act.notGoingCount === 'number' ? act.notGoingCount : notGoing.length + (wasOut ? 1 : 0))
      + (goingIn ? 0 : 1) - (wasOut ? 1 : 0),
  );

  return {
    ...act,
    members: goingIn ? [...members, row] : members,
    notGoing: goingIn ? notGoing : [...notGoing, row],
    participants: goingIn ? [...participants, me] : participants,
    memberCount,
    notGoingCount,
    isJoined: goingIn,
    isNotGoing: !goingIn,
    myStatus: goingIn ? 'MEMBER' : 'DECLINED',
  };
}

/**
 * "I'm in" / "I'm out" on the activity page.
 *
 * One request at a time: the page disables both buttons while `isPending`, so
 * there is no intent to coalesce (the feed cards' join toggle still has its
 * own debounced hook). "I'm in" is the ordinary join, so every join rule —
 * visibility, capacity, start time — applies on the way back in.
 */
export function useActivityRsvp(activityId, { currentUser, onLostAccess } = {}) {
  const queryClient = useQueryClient();
  const cleanId = activityId ? String(activityId).replace(/^(act_)+/, '') : activityId;

  const mutation = useMutation({
    mutationFn: (choice) => (choice === 'in'
      ? activitiesApi.join(cleanId)
      : activitiesApi.decline(cleanId)),
    onMutate: async (choice) => {
      await queryClient.cancelQueries({ queryKey: ['activity', cleanId], exact: true });
      const previous = queryClient.getQueryData(['activity', cleanId]);
      if (previous) {
        queryClient.setQueryData(['activity', cleanId], patchRsvp(previous, choice, currentUser));
      }
      return { previous };
    },
    onError: (err, _choice, context) => {
      if (context?.previous) queryClient.setQueryData(['activity', cleanId], context.previous);
      showToast(err?.message || "Couldn't update your answer", 'error');
    },
    onSuccess: (result, choice) => {
      // Lists and the offline copy of page 1 hold the old attendee count.
      idbDelete('activities', 'all_page1');
      if (choice === 'out' && result?.lostAccess) onLostAccess?.();
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['activities'] });
      queryClient.invalidateQueries({ queryKey: ['activity', cleanId] });
    },
  });

  const { mutate, isPending } = useGuardedMutation(mutation, 'action');

  const answer = useCallback((choice) => {
    if (choice !== 'in' && choice !== 'out') return;
    mutate(choice);
  }, [mutate]);

  return { answer, isPending };
}
