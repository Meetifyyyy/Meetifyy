import { useMutation, useQueryClient } from '@tanstack/react-query';
import { communitiesApi, postsApi } from '../api/apiClient';
import { showToast } from '../utils/toast';

/**
 * The community / post write actions `useData` used to define inline.
 *
 * Extracted verbatim -- same mutation, same cache invalidations and seeding,
 * same toast-on-error behaviour, carried over from the former `useData`
 * mega-hook.
 */
export function useCommunityActions() {
  const queryClient = useQueryClient();

  const createCommMutation = useMutation({
    mutationFn: (data) => communitiesApi.create(data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['communities'] }),
  });

  const createCampusGroup = async (name, desc, avatar) => {
    const res = await createCommMutation.mutateAsync({ name, description: desc, avatarKey: avatar });
    return res.id;
  };

  const addCommunity = async (data) => {
    const res = await createCommMutation.mutateAsync({
      name: data.name,
      description: data.desc,
      avatarKey: data.avatar,
      isCampusCommunity: data.isCampusCommunity,
      // Previously dropped here. The create dialog collects a palette colour and
      // a privacy choice, and neither reached the API — every community was
      // stored with a null colour and as public, regardless of what was picked.
      color: data.color,
      privacy: data.privacy,
      isPrivate: data.isPrivate,
    });
    return res.id;
  };

  const addPost = async (text, poll, communityId, media, mentions) => {
    try {
      const mediaKey = media?.url || (typeof media === 'string' ? media : undefined);
      const newPost = await postsApi.createPost({
        text,
        communityId,
        mediaKey,
        mentions,
        poll: poll || undefined,
      });
      queryClient.invalidateQueries({ queryKey: ['posts'] });
      queryClient.invalidateQueries({ queryKey: ['feed'] });
      queryClient.invalidateQueries({ queryKey: ['communities'] });
      if (communityId) {
        queryClient.invalidateQueries({ queryKey: ['community', communityId] });
        queryClient.invalidateQueries({ queryKey: ['community-posts', communityId] });
        queryClient.setQueryData(['community-posts', communityId], (old = []) => {
          if (!newPost) return old;
          const list = Array.isArray(old) ? old : (old?.posts || []);
          if (list.some(p => p.id === newPost.id)) return old;
          return [newPost, ...list];
        });
      }
      return newPost;
    } catch (err) {
      showToast(err?.message || "Couldn't create post", 'error');
      throw err;
    }
  };

  const updateCommunity = async (id, data) => {
    try {
      const updated = await communitiesApi.updateGroupInfo(id, data);
      // Seed the cache immediately so the UI reflects the change before the re-fetch lands
      if (updated?.id) {
        queryClient.setQueryData(['community', id], updated);
      }
      queryClient.invalidateQueries({ queryKey: ['communities'] });
      queryClient.invalidateQueries({ queryKey: ['community', id] });
      return updated;
    } catch (err) {
      showToast(err?.message || "Couldn't update community", 'error');
      throw err;
    }
  };

  // CommunityAdminModal has always called `kickMember(communityId, memberId)`,
  // but useData never returned such a key -- the destructure yielded undefined
  // and confirming a kick threw "kickMember is not a function". Implemented
  // here against the endpoint the modal was clearly written for. The caller
  // shows its own success/error toast, so this only does the call plus the
  // cache invalidations the other community writes use.
  const kickMember = async (communityId, memberId) => {
    await communitiesApi.removeGroupMember(communityId, memberId);
    queryClient.invalidateQueries({ queryKey: ['communities'] });
    queryClient.invalidateQueries({ queryKey: ['community', communityId] });
  };

  return { createCampusGroup, addCommunity, addPost, updateCommunity, kickMember, createCommMutation };
}
