import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useGlobalSocketStore } from '../store/useGlobalSocketStore';
import { useAuth } from '../context/AuthContext';
import { useData } from '../hooks/useData';
import { appendMessageToCache, updateConversationPreview } from '../../features/messages/shared/utils/cacheUtils';

export function useGlobalSocketSync() {
  const queryClient = useQueryClient();
  const { socket, isConnected } = useGlobalSocketStore();
  const { currentUser } = useAuth();
  const { conversations } = useData() || {};
  const joinedRoomsRef = useRef(false);

  // 1. Join Conversation Rooms for O(1) Routing
  useEffect(() => {
    if (socket && isConnected && conversations && conversations.length > 0) {
      // Re-join if connection dropped, or if we haven't joined yet
      const conversationIds = conversations.map(c => c.id || c.publicId).filter(Boolean);
      socket.emit('conversation:join_rooms', { conversationIds });
      joinedRoomsRef.current = true;
    }
  }, [socket, isConnected, conversations]);

  // 2. Global Event Listeners
  useEffect(() => {
    if (!socket || !currentUser) return;

    const handleNewMessage = (payload) => {
      const message = payload?.message || payload;
      const conversationId = payload?.conversationId || message?.conversationId;
      if (!message || !conversationId) return;

      appendMessageToCache(queryClient, conversationId, message);
      
      // Update unread count if we are not the sender
      const isFromMe = message.senderId === currentUser.id;
      const unreadIncrement = isFromMe ? 0 : 1;
      updateConversationPreview(queryClient, conversationId, message.text || message.payload?.text, message.createdAt, unreadIncrement);

      // Emit delivered ACK globally if we received it
      if (!isFromMe) {
        socket.emit('message:delivered', { conversationId, messageId: message.id });
      }
    };

    const handleDomainEvent = (event) => {
      if (!event || !event.type) return;

      switch (event.type) {
        case 'follow.created':
        case 'follow.deleted': {
          const { followerId, followingUsername, followerStats, targetStats } = event.data;
          
          const isFollowing = event.type === 'follow.created';
          const isCurrentUserFollower = followerId === currentUser.id;

          // 1. Update Target User Profile Stats
          queryClient.setQueryData(['profile', followingUsername], (old) => {
            if (!old) return old;
            return {
              ...old,
              stats: {
                ...old.stats,
                followers: targetStats?.followersCount ?? old.stats.followers,
              },
              // If the current user is the one who followed/unfollowed, update the boolean
              ...(isCurrentUserFollower ? { isFollowing } : {})
            };
          });

          // 2. Update Current User Profile Stats (if they were the actor)
          if (isCurrentUserFollower) {
            queryClient.setQueryData(['profile', currentUser.username], (old) => {
              if (!old) return old;
              return {
                ...old,
                stats: {
                  ...old.stats,
                  following: followerStats?.followingCount ?? old.stats.following,
                }
              };
            });

            // 3. Update following/followers lists (optimistic removal/addition could be done here, 
            // but invalidation ensures we get the rich user object from the backend)
            queryClient.invalidateQueries({ queryKey: ['following', currentUser.username] });
            queryClient.invalidateQueries({ queryKey: ['followers', followingUsername] });
          }
          break;
        }
        
        // Add more domain events here in the future (e.g. post.liked, comment.created)
        default:
          break;
      }
    };

    socket.on('domainEvent', handleDomainEvent);
    socket.on('message:new', handleNewMessage);
    
    return () => {
      socket.off('domainEvent', handleDomainEvent);
      socket.off('message:new', handleNewMessage);
    };
  }, [socket, queryClient, currentUser]);
}
