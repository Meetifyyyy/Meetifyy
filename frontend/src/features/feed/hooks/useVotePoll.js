import { useMutation, useQueryClient } from '@tanstack/react-query';
import { postsApi } from '@shared/api/apiClient';
import { showToast } from '@shared/utils/toast';

const updatePollInCache = (oldData, postId, updatedPollOrIndices, currentUserId) => {
  if (!oldData) return oldData;

  const updatePost = (p) => {
    if (!p || p.id !== postId || !p.poll) return p;

    let nextPoll = p.poll;
    if (typeof updatedPollOrIndices === 'object' && updatedPollOrIndices !== null && !Array.isArray(updatedPollOrIndices)) {
      nextPoll = {
        ...p.poll,
        ...updatedPollOrIndices,
        selectedUsers: {
          ...(p.poll.selectedUsers || {}),
          ...(updatedPollOrIndices.selectedUsers || {}),
          ...(currentUserId && updatedPollOrIndices.myVotes ? { [currentUserId]: updatedPollOrIndices.myVotes } : {})
        }
      };
    } else if (Array.isArray(updatedPollOrIndices)) {
      const idx = updatedPollOrIndices[0];
      const currentOptions = p.poll.options || [];
      const updatedOptions = currentOptions.map((opt, i) => {
        if (i === idx) {
          const currentVotes = typeof opt === 'object' ? Number(opt.votes || opt.voteCount || 0) : 0;
          return typeof opt === 'object' ? { ...opt, votes: currentVotes + 1 } : { text: opt, votes: 1 };
        }
        return opt;
      });
      const newTotal = (p.poll.totalVotes || 0) + 1;
      const myVotes = [idx];
      nextPoll = {
        ...p.poll,
        options: updatedOptions,
        totalVotes: newTotal,
        votedOptionIndex: idx,
        myVotes,
        selectedUsers: {
          ...(p.poll.selectedUsers || {}),
          ...(currentUserId ? { [currentUserId]: myVotes } : {})
        }
      };
    }

    return {
      ...p,
      poll: nextPoll,
    };
  };

  if (oldData.id === postId) return updatePost(oldData);
  if (Array.isArray(oldData)) return oldData.map(updatePost);
  if (oldData.posts && Array.isArray(oldData.posts)) return { ...oldData, posts: oldData.posts.map(updatePost) };
  if (oldData.pages) {
    return {
      ...oldData,
      pages: oldData.pages.map((page) => {
        if (page.posts) return { ...page, posts: page.posts.map(updatePost) };
        if (page.items) return { ...page, items: page.items.map(updatePost) };
        return page;
      })
    };
  }
  return oldData;
};

export function useVotePoll() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ postId, indices, optionId }) => {
      return postsApi.voteInPoll(postId, { indices, optionId });
    },

    onMutate: async ({ postId, indices, currentUserId }) => {
      const POST_LIST_KEYS = ['feed', 'posts', 'user-posts', 'bookmarks', 'community-posts'];
      const isPostListQuery = (query) => POST_LIST_KEYS.includes(query.queryKey[0]);

      // Snapshot caches for rollback
      const snapshots = queryClient.getQueriesData({ predicate: isPostListQuery });
      const previousPost = queryClient.getQueryData(['post', postId]);

      const updater = (old) => updatePollInCache(old, postId, indices, currentUserId);
      queryClient.setQueriesData({ predicate: isPostListQuery }, updater);
      queryClient.setQueryData(['post', postId], updater);

      return { snapshots, previousPost, postId };
    },

    onError: (_err, { postId }, context) => {
      if (context?.snapshots) {
        context.snapshots.forEach(([queryKey, data]) => {
          if (data !== undefined) queryClient.setQueryData(queryKey, data);
        });
      }
      if (context?.previousPost) {
        queryClient.setQueryData(['post', postId], context.previousPost);
      }
      showToast("Couldn't submit vote", 'error');
    },

    onSuccess: (result, { postId, currentUserId }) => {
      // Reconcile with server response if server returned updated poll object
      if (result && (result.poll || result.options)) {
        const updater = (old) => updatePollInCache(old, postId, result.poll || result, currentUserId);
        const POST_LIST_KEYS = ['feed', 'posts', 'user-posts', 'bookmarks', 'community-posts'];
        queryClient.setQueriesData({ predicate: (q) => POST_LIST_KEYS.includes(q.queryKey[0]) }, updater);
        queryClient.setQueryData(['post', postId], updater);
      }
    },
  });
}
