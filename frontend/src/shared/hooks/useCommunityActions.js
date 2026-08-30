import { useMutation, useQueryClient } from '@tanstack/react-query';
import { communitiesApi, postsApi } from '../api/apiClient';
import { showToast } from '../utils/toast';
import { addCreatedPostToCaches } from '../../features/feed/utils/postCache';
import { patchCommunityMemberRole } from '../utils/communityCache';
import { openVerificationModal } from '../stores/verificationModalStore';

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

  const checkVerification = () => {
    try {
      const savedUser = localStorage.getItem('currentUser');
      if (savedUser) {
        const parsed = JSON.parse(savedUser);
        if (parsed?.verificationStatus !== 'VERIFIED') {
          openVerificationModal('Verify your account to create communities.');
          throw new Error('Verify your account to create communities');
        }
      }
    } catch (e) {
      if (e?.message?.includes('Verify your account')) throw e;
    }
  };

  const createCampusGroup = async (name, desc, avatar) => {
    checkVerification();
    const res = await createCommMutation.mutateAsync({ name, description: desc, avatarKey: avatar });
    return res.id;
  };

  const addCommunity = async (data) => {
    checkVerification();
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
      const mediaKeys = Array.isArray(media) 
        ? media.map(m => m.mediaKey || m.url || (typeof m === 'string' ? m : undefined)).filter(Boolean)
        : [];
      
      const newPost = await postsApi.createPost({
        text,
        communityId,
        mediaKeys: mediaKeys.length > 0 ? mediaKeys : undefined,
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
      // Seed the cache immediately so the UI reflects the change before the
      // re-fetch lands — but MERGE it. The update endpoint returns the bare
      // Community row, while this cache holds the enriched detail payload
      // (members, isJoined, userRole, online). Replacing it wholesale made
      // the Join button flip back and the member strip empty out for the
      // second or two until the refetch returned.
      if (updated?.id) {
        queryClient.setQueryData(['community', id], (prev) =>
          (prev ? { ...prev, ...updated } : updated));
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

  /**
   * Promote a member to moderator, or demote one back.
   *
   * Patched into the cache rather than invalidated, for the same reason
   * membership changes are: only one member's badge moves, and reloading the
   * community for it would swap the page for a skeleton. The realtime
   * `community.roleUpdated` event applies the identical patch for everyone
   * else in the room, so both paths converge on the same state.
   *
   * The server re-checks that the caller owns the community — this is a
   * convenience, not the authorization.
   */
  const setMemberRole = async (communityId, memberId, role, currentUserId) => {
    // Optimistic: the badge flips immediately.
    patchCommunityMemberRole(queryClient, communityId, memberId, role, currentUserId);
    try {
      await communitiesApi.updateMemberRole(communityId, memberId, role);
      return true;
    } catch (err) {
      // Put it back. Demoting from MODERATOR restores MEMBER and vice versa,
      // which is the only pair this control can produce.
      patchCommunityMemberRole(
        queryClient, communityId, memberId,
        role === 'MODERATOR' ? 'MEMBER' : 'MODERATOR',
        currentUserId,
      );
      showToast(err?.message || "Couldn't update this member's role", 'error');
      return false;
    }
  };

  return {
    createCampusGroup, addCommunity, addPost, updateCommunity, kickMember,
    setMemberRole, createCommMutation,
  };
}
