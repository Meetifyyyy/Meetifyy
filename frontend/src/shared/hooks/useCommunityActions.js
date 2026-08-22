import { useMutation, useQueryClient } from '@tanstack/react-query';
import { communitiesApi, postsApi } from '../api/apiClient';
import { showToast } from '../utils/toast';
import { addCreatedPostToCaches } from '../../features/feed/utils/postCache';

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
      // The verified storage key, not the display URL. `media.url` happened to
      // round-trip because the server strips a `/api/media/` prefix back off it,
      // which is an accident of that one URL shape rather than a contract.
      const mediaKey = media?.mediaKey || media?.url || (typeof media === 'string' ? media : undefined);
      const newPost = await postsApi.createPost({
        text,
        communityId,
        mediaKey,
        mentions,
        poll: poll || undefined,
      });
      // Same shared writer the home composer uses, so a community post shows up
      // in the community view, the author's profile and the home feed together.
      addCreatedPostToCaches(queryClient, newPost);
      queryClient.invalidateQueries({ queryKey: ['communities'] });
      if (communityId) {
        queryClient.invalidateQueries({ queryKey: ['community', communityId] });
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
