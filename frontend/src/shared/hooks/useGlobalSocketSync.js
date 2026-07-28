import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useGlobalSocketStore } from '../store/useGlobalSocketStore';
import { useAuth } from '../context/AuthContext';
import { useData } from '../hooks/useData';

export function useGlobalSocketSync() {
  const queryClient = useQueryClient();
  const { socket, isConnected } = useGlobalSocketStore();
  const { currentUser } = useAuth();
  const { conversations } = useData() || {};
  const conversationsRef = useRef(conversations);

  // Keep ref in sync so the reconnect handler always sees the latest conversations
  useEffect(() => {
    conversationsRef.current = conversations;
  }, [conversations]);

  // 1. Join Conversation Rooms for O(1) routing — run on initial connect AND reconnects
  useEffect(() => {
    if (!socket || !isConnected) return;

    const joinAllRooms = () => {
      const convs = conversationsRef.current;
      if (!convs || convs.length === 0) return;

      // Send BOTH id and publicId so the backend room matches regardless of which alias it used
      const conversationIds = [];
      convs.forEach((c) => {
        if (c.id) conversationIds.push(c.id);
        if (c.publicId && c.publicId !== c.id) conversationIds.push(c.publicId);
        if (c.internalId && c.internalId !== c.id && c.internalId !== c.publicId) {
          conversationIds.push(c.internalId);
        }
      });

      const unique = [...new Set(conversationIds.filter(Boolean))];
      if (unique.length > 0) {
        socket.emit('conversation:join_rooms', { conversationIds: unique });
      }
    };

    // Join now (handles initial connect + when conversations load after connect)
    joinAllRooms();

    // Re-join on every reconnect — socket.on('connect') fires on reconnect too
    socket.on('connect', joinAllRooms);
    return () => {
      socket.off('connect', joinAllRooms);
    };
  }, [socket, isConnected]);

  // 2. Global domain event listener (follow/unfollow, etc.)
  useEffect(() => {
    if (!socket || !currentUser) return;

    const handleDomainEvent = (event) => {
      if (!event || !event.type) return;

      switch (event.type) {
        case 'follow.created':
        case 'follow.deleted': {
          const { followerId, followingUsername, followerStats, targetStats } = event.data;
          const isFollowing = event.type === 'follow.created';
          const isCurrentUserFollower = followerId === currentUser.id;

          queryClient.setQueryData(['profile', followingUsername], (old) => {
            if (!old) return old;
            return {
              ...old,
              stats: {
                ...old.stats,
                followers: targetStats?.followersCount ?? old.stats.followers,
              },
              ...(isCurrentUserFollower ? { isFollowing } : {}),
            };
          });

          if (isCurrentUserFollower) {
            queryClient.setQueryData(['profile', currentUser.username], (old) => {
              if (!old) return old;
              return {
                ...old,
                stats: {
                  ...old.stats,
                  following: followerStats?.followingCount ?? old.stats.following,
                },
              };
            });
            queryClient.invalidateQueries({ queryKey: ['following', currentUser.username] });
            queryClient.invalidateQueries({ queryKey: ['followers', followingUsername] });
          }
          break;
        }

        case 'invitation:new':
        case 'invitation:updated': {
          queryClient.invalidateQueries({ queryKey: ['activity-pending-invitations'] });
          queryClient.invalidateQueries({ queryKey: ['notifications'] });
          queryClient.invalidateQueries({ queryKey: ['notifications', 'unreadCount'] });
          queryClient.invalidateQueries({ queryKey: ['activities'] });
          break;
        }

        default:
          break;
      }
    };

    const handleDirectInvitationEvent = () => {
      queryClient.invalidateQueries({ queryKey: ['activity-pending-invitations'] });
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
      queryClient.invalidateQueries({ queryKey: ['notifications', 'unreadCount'] });
      queryClient.invalidateQueries({ queryKey: ['activities'] });
    };

    socket.on('domainEvent', handleDomainEvent);
    socket.on('invitation:new', handleDirectInvitationEvent);
    socket.on('invitation:updated', handleDirectInvitationEvent);

    return () => {
      socket.off('domainEvent', handleDomainEvent);
      socket.off('invitation:new', handleDirectInvitationEvent);
      socket.off('invitation:updated', handleDirectInvitationEvent);
    };
  }, [socket, queryClient, currentUser]);
}
