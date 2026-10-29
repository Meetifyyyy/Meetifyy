import { useMutation, useQueryClient } from '@tanstack/react-query';
import { postsApi } from '@shared/api/apiClient';
import { showToast } from '@shared/utils/toast';
import { isPostListQuery } from '../utils/postCache';
import { useGuardedMutation } from '@shared/hooks/useGuardedMutation';
import { hasVotedIn } from '../utils/pollView';

/**
 * Voting in a poll.
 *
 * - By option id, not by place: an index named whatever option the server
 *   had at that place, which was not always the one on screen.
 * - Shown at once (the vote counted, the results drawn), then reconciled with
 *   the server's poll. A second tap, or a vote from a card that already shows
 *   one, does nothing: the server keeps one vote a person anyway, and answers
 *   a repeat with the vote that stands.
 * - A failure puts back this poll only, as it was, and refetches the post.
 *   Restoring whole cached lists used to undo anything else that changed in
 *   them meanwhile (a like, a new comment count).
 */

/** Applies `change(poll)` to the post `postId` wherever it is cached. */
function mapPost(old, postId, change) {
  if (!old) return old;
  const updatePost = (p) => (p && p.id === postId && p.poll ? { ...p, poll: change(p.poll) } : p);
  if (old.id === postId) return updatePost(old);
  if (Array.isArray(old)) return old.map(updatePost);
  if (old.posts && Array.isArray(old.posts)) return { ...old, posts: old.posts.map(updatePost) };
  if (old.pages) {
    return {
      ...old,
      pages: old.pages.map((page) => {
        if (page.posts) return { ...page, posts: page.posts.map(updatePost) };
        if (page.items) return { ...page, items: page.items.map(updatePost) };
        return page;
      }),
    };
  }
  return old;
}

/** The poll as it reads with this viewer's vote for `optionId` counted. */
export function withOptimisticVote(poll, optionId, viewerId) {
  if (!poll || hasVotedIn(poll, viewerId)) return poll;
  const options = Array.isArray(poll.options) ? poll.options : [];
  const index = options.findIndex((o) => o && typeof o === 'object' && o.id === optionId);
  if (index < 0) return poll;
  const myVotes = [index];
  return {
    ...poll,
    options: options.map((o, i) => (i === index ? { ...o, votes: Number(o.votes ?? o.voteCount ?? 0) + 1 } : o)),
    totalVotes: Number(poll.totalVotes || 0) + 1,
    userVotedOptionId: optionId,
    votedOptionIndex: index,
    myVotes,
    selectedUsers: viewerId ? { ...(poll.selectedUsers || {}), [viewerId]: myVotes } : poll.selectedUsers,
  };
}

/** The server's poll for this viewer, replacing what was shown. */
function withServerPoll(poll, serverPoll, viewerId) {
  if (!serverPoll || typeof serverPoll !== 'object') return poll;
  const myVotes = Array.isArray(serverPoll.myVotes) ? serverPoll.myVotes : poll.myVotes;
  return {
    ...poll,
    ...serverPoll,
    selectedUsers: viewerId && myVotes ? { ...(poll.selectedUsers || {}), [viewerId]: myVotes } : poll.selectedUsers,
  };
}

function writePoll(queryClient, postId, change) {
  const updater = (old) => mapPost(old, postId, change);
  queryClient.setQueriesData({ predicate: isPostListQuery }, updater);
  queryClient.setQueryData(['post', postId], updater);
}

/** This post's poll as cached now, from wherever it is found first. */
function cachedPoll(queryClient, postId) {
  let found = null;
  const look = (data) => {
    mapPost(data, postId, (poll) => {
      if (!found) found = poll;
      return poll;
    });
  };
  look(queryClient.getQueryData(['post', postId]));
  if (!found) queryClient.getQueriesData({ predicate: isPostListQuery }).forEach(([, data]) => look(data));
  return found;
}

export function useVotePoll() {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: ({ postId, optionId }) => postsApi.voteInPoll(postId, { optionId }),

    onMutate: async ({ postId, optionId, currentUserId }) => {
      // A refetch already out would land after this and draw the poll
      // without the vote.
      await Promise.all([
        queryClient.cancelQueries({ predicate: isPostListQuery }),
        queryClient.cancelQueries({ queryKey: ['post', postId] }),
      ]);
      const previousPoll = cachedPoll(queryClient, postId);
      writePoll(queryClient, postId, (poll) => withOptimisticVote(poll, optionId, currentUserId));
      return { previousPoll };
    },

    onError: (_err, { postId }, context) => {
      if (context?.previousPoll) writePoll(queryClient, postId, () => context.previousPoll);
      // Whatever went wrong, the server knows whether the vote counted.
      queryClient.invalidateQueries({ queryKey: ['post', postId] });
      showToast("Couldn't submit vote", 'error');
    },

    onSuccess: (result, { postId, currentUserId }) => {
      if (result?.poll) writePoll(queryClient, postId, (poll) => withServerPoll(poll, result.poll, currentUserId));
    },
  });
  return useGuardedMutation(mutation, 'action');
}
