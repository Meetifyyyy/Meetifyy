import { useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { useGlobalSocketStore } from '../store/useGlobalSocketStore';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useNavigate } from 'react-router-dom';
import Avatar from './avatar/Avatar';
import { parseConversationRoute } from '../utils/conversationUrl';
import { messagesApi } from '../api/apiClient';
import { useGlobalSocketSync } from '../hooks/useGlobalSocketSync';

export default function SocketManager() {
  const { session, isLoggedIn } = useAuth();
  const { connect, disconnect, socket } = useGlobalSocketStore();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  useGlobalSocketSync();

  useEffect(() => {
    if (isLoggedIn && session?.access_token) {
      const deviceId = localStorage.getItem('meetifyy_deviceId');
      connect(session.access_token, deviceId);
    } else {
      disconnect();
    }
  }, [isLoggedIn, session?.access_token, connect, disconnect]);

  useEffect(() => {
    if (!socket) return;

    const handleNewNotification = (notification) => {
      // Invalidate queries so useNotifications hook fetches the latest
      queryClient.invalidateQueries({ queryKey: ['notifications'] });

      // Smart toast logic: suppress if user is on the exact screen or if muted
      const currentEntityId = notification.entityId || notification.metadata?.conversationId;
      const pubId = notification.metadata?.publicId;
      const intId = notification.metadata?.internalId;
      const targetIds = [currentEntityId, pubId, intId].filter(Boolean);

      const convs = queryClient.getQueryData(['conversations']) || [];
      const currentPath = window.location.pathname;
      const isMessagesRoute = currentPath.startsWith('/messages') || currentPath.startsWith('/inbox');
      
      let isViewingEntity = false;
      if (notification.type?.toUpperCase() === 'MESSAGE' && isMessagesRoute) {
        const pathParts = currentPath.split('/').filter(Boolean);
        const param1 = pathParts[1];
        const param2 = pathParts[2];
        const routeInfo = parseConversationRoute(param1, param2);
        const viewedId = routeInfo.publicId;

        if (viewedId) {
          if (viewedId === currentEntityId || (pubId && viewedId === pubId) || (intId && viewedId === intId)) {
            isViewingEntity = true;
          }

          if (!isViewingEntity) {
            const activeConv = convs.find(c => 
              c.id === viewedId || c.publicId === viewedId || c.internalId === viewedId
            );
            if (activeConv) {
              const convIds = [activeConv.id, activeConv.publicId, activeConv.internalId].filter(Boolean);
              if (targetIds.some(tId => convIds.includes(tId))) {
                isViewingEntity = true;
              }
            }
          }
        }
      }

      const targetConv = convs.find(c => {
        const cIds = [c.id, c.publicId, c.internalId].filter(Boolean);
        return targetIds.some(tId => cIds.includes(tId));
      });
      const isMuted = Boolean(targetConv?.muted || targetConv?.isMuted);

      if (isViewingEntity) {
        const convIdToRead = pubId || currentEntityId;
        if (convIdToRead) {
          if (socket?.connected) {
            socket.emit('conversation:mark_seen', { conversationId: convIdToRead });
          } else {
            messagesApi.markAsRead(convIdToRead).catch(() => {});
          }
        }
      } else if (!isMuted) {
        toast.custom((t) => {
          const isGroupMessage = Boolean(notification.metadata?.isGroup || notification.metadata?.conversationType === 'GROUP');
          const actorName = notification.actor?.displayName || notification.actor?.username || notification.metadata?.actorDisplayName || notification.metadata?.actorName || notification.metadata?.username || 'Someone';
          const actorAvatar = notification.actor?.avatar || notification.metadata?.actorAvatar || '';
          const groupName = notification.metadata?.conversationName || notification.title || 'Group';
          const groupAvatar = notification.metadata?.conversationAvatar || '';

          const notifType = (notification.type || '').toLowerCase();

          let bodyText = notification.body || notification.title || '';
          if (notifType === 'follow') {
            bodyText = 'started following you.';
          } else if (notifType === 'like') {
            bodyText = 'liked your post.';
          } else if (notifType === 'comment_like') {
            bodyText = 'liked your comment.';
          } else if (notifType === 'comment') {
            if (notification.metadata?.isReply || bodyText.includes('replied to your comment:')) {
              if (bodyText.includes('replied to your comment:')) {
                bodyText = bodyText.substring(bodyText.indexOf('replied to your comment:')).trim();
              } else {
                bodyText = 'replied to your comment.';
              }
            } else if (bodyText.includes('commented:')) {
              bodyText = bodyText.substring(bodyText.indexOf('commented:')).trim();
            } else {
              bodyText = 'commented on your post.';
            }
          } else if (notifType === 'mention') {
            bodyText = 'mentioned you.';
          } else if (notifType === 'message') {
            const textSnippet = notification.metadata?.messageText || notification.body || '';
            if (isGroupMessage) {
              bodyText = `${actorName}: ${textSnippet}`;
            } else {
              bodyText = textSnippet;
            }
          } else if (notifType === 'join_request') {
            bodyText = 'requested to join your activity.';
          } else if (bodyText.startsWith(actorName)) {
            bodyText = bodyText.substring(actorName.length).trim();
          }

          if (!bodyText) {
            bodyText = notification.title || 'sent a notification.';
          }

          const handleClick = () => {
            toast.dismiss(t);
            if (notifType === 'message') {
              const convId = notification.metadata?.conversationId || notification.entityId;
              if (convId) {
                navigate(`/messages/${convId}`);
                return;
              }
            }
            navigate('/notifications');
          };

          return (
            <div
              onClick={handleClick}
              style={{
                background: 'var(--color-bg-white, #ffffff)',
                border: '1px solid var(--color-border, #e2e8f0)',
                boxShadow: '0 12px 32px -4px rgba(0, 0, 0, 0.12), 0 4px 12px -2px rgba(0, 0, 0, 0.06)',
                borderRadius: '16px',
                padding: '12px 16px',
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                width: '360px',
                boxSizing: 'border-box',
                cursor: 'pointer',
                fontFamily: 'var(--font-family-sans, sans-serif)',
                transition: 'transform 0.15s ease, box-shadow 0.15s ease',
              }}
            >
              <div style={{ flexShrink: 0 }}>
                <Avatar 
                  src={isGroupMessage ? groupAvatar : actorAvatar} 
                  name={isGroupMessage ? groupName : actorName} 
                  size="40px" 
                  isGroup={isGroupMessage} 
                />
              </div>

              <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '2px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', width: '100%' }}>
                  <strong style={{ color: 'var(--color-text-main, #0f172a)', fontWeight: 700, fontSize: '0.86rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {isGroupMessage ? groupName : actorName}
                  </strong>
                  <span style={{ fontSize: '0.72rem', color: 'var(--color-text-light, #94a3b8)', fontWeight: 500, flexShrink: 0 }}>
                    just now
                  </span>
                </div>

                {isGroupMessage ? (
                  <div style={{ fontSize: '0.82rem', color: 'var(--color-text-muted, #475569)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    <span style={{ fontWeight: 600, color: 'var(--color-text-main, #0f172a)' }}>{actorName}:</span> {notification.metadata?.messageText || ''}
                  </div>
                ) : (
                  <div style={{ fontSize: '0.83rem', color: 'var(--color-text-muted, #475569)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {bodyText}
                  </div>
                )}
              </div>
            </div>
          );
        }, { duration: 5000 });
      }
    };

    const handleNotificationCount = ({ count }) => {
      queryClient.setQueryData(['notifications', 'unreadCount'], { count });
    };

    const handlePresenceUpdate = ({ userId, status, lastActive }) => {
      if (!userId) return;
      const isOnline = status === 'online';

      queryClient.setQueryData(['conversations'], (old) => {
        if (!Array.isArray(old)) return old;
        return old.map((c) => {
          const isTarget = String(c.targetUser?.id) === String(userId) || String(c.userId) === String(userId);
          if (isTarget) {
            return {
              ...c,
              online: isOnline,
              targetUser: c.targetUser ? {
                ...c.targetUser,
                isOnline,
                lastActive: lastActive || c.targetUser.lastActive
              } : null
            };
          }
          return c;
        });
      });

      queryClient.setQueryData(['users'], (old) => {
        if (!Array.isArray(old)) return old;
        return old.map((u) => {
          if (String(u.id) === String(userId)) {
            return {
              ...u,
              isOnline,
              lastActive: lastActive || u.lastActive
            };
          }
          return u;
        });
      });

      queryClient.setQueryData(['campusUsers'], (old) => {
        if (!Array.isArray(old)) return old;
        return old.map((u) => {
          if (String(u.id) === String(userId)) {
            return {
              ...u,
              isOnline,
              lastActive: lastActive || u.lastActive
            };
          }
          return u;
        });
      });

      queryClient.setQueryData(['user', userId], (old) => {
        if (!old) return old;
        return {
          ...old,
          isOnline,
          lastActive: lastActive || old.lastActive
        };
      });
    };

    const handleGroupMemberChange = () => {
      queryClient.invalidateQueries({ queryKey: ['conversations'] });
    };

    const handleConversationUpdated = (payload) => {
      if (!payload) return;
      const convId = payload.conversationId || payload.id || payload.publicId;

      queryClient.setQueryData(['conversations'], (old) => {
        if (!Array.isArray(old)) return old;

        const exists = old.some(c => c.id === convId || c.publicId === convId || c.internalId === convId);
        if (!exists) {
          queryClient.invalidateQueries({ queryKey: ['conversations'] });
          return old;
        }

        const currentPath = window.location.pathname;
        const isMessagesRoute = currentPath.startsWith('/messages') || currentPath.startsWith('/inbox');
        const pathParts = currentPath.split('/').filter(Boolean);
        const param1 = pathParts[1];
        const param2 = pathParts[2];
        const routeInfo = isMessagesRoute ? parseConversationRoute(param1, param2) : { publicId: null };
        const viewedId = routeInfo.publicId;

        return old.map((c) => {
          if (c.id === convId || c.publicId === convId || c.internalId === convId) {
            const isViewing = isMessagesRoute && viewedId && (
              viewedId === c.id || viewedId === c.publicId || viewedId === c.internalId
            );

            const lastMsg = payload.lastMessage;
            return {
              ...c,
              ...(payload.name ? { name: payload.name } : {}),
              ...(payload.avatar !== undefined ? { avatar: payload.avatar, avatarKey: payload.avatar } : {}),
              ...(payload.description !== undefined ? { description: payload.description } : {}),
              ...(lastMsg ? { lastMessage: lastMsg, updatedAt: lastMsg.createdAt } : {}),
              ...(payload.ownerId ? { ownerId: payload.ownerId } : {}),
              unreadCount: isViewing ? 0 : (lastMsg ? (c.unreadCount || 0) + 1 : (c.unreadCount || 0)),
              unread: isViewing ? 0 : (lastMsg ? (c.unread || 0) + 1 : (c.unread || 0)),
            };
          }
          return c;
        });
      });
    };

    const handleMessageUpdated = (payload) => {
      if (!payload || !payload.id) return;
      const keys = [payload.conversationId, payload.publicId, payload.internalId].filter(Boolean);
      const uniqueKeys = [...new Set(keys)];
      uniqueKeys.forEach(convKey => {
        queryClient.setQueryData(['messages', convKey], (old) => {
          if (!old || !old.messages) return old;
          if (payload.state === 'UNSENT' || payload.deleted || payload.deletedAt) {
            return {
              ...old,
              messages: old.messages.filter(m => m.id !== payload.id)
            };
          }
          return {
            ...old,
            messages: old.messages.map(m => m.id === payload.id ? { ...m, ...payload } : m)
          };
        });
      });
    };

    const handleGlobalConversationSeen = (payload) => {
      if (!payload) return;
      const convId = payload.conversationId || payload.realConvId;
      if (!convId || !payload.lastReadAt) return;

      const currentUserId = session?.user?.id;
      const isRecipientReader = !payload.readerId || String(payload.readerId) !== String(currentUserId);
      if (!isRecipientReader) return;

      const lastReadTime = new Date(payload.lastReadAt).getTime();
      const keys = [payload.conversationId, payload.realConvId, payload.publicId].filter(Boolean);
      const uniqueKeys = [...new Set(keys)];

      uniqueKeys.forEach((convKey) => {
        queryClient.setQueryData(['messages', convKey], (oldData) => {
          if (!oldData) return oldData;

          const updateMessageList = (messages) => {
            if (!Array.isArray(messages)) return messages;
            return messages.map((msg) => {
              const isMyMsg = msg.from === 'me' || (currentUserId && String(msg.senderId) === String(currentUserId)) || msg.senderId === 'me';
              if (isMyMsg && msg.status !== 'read') {
                const msgTime = new Date(msg.createdAt).getTime();
                if (isNaN(msgTime) || msgTime <= lastReadTime + 2000) {
                  return { ...msg, status: 'read' };
                }
              }
              return msg;
            });
          };

          if (oldData.pages) {
            return {
              ...oldData,
              pages: oldData.pages.map((page) => ({
                ...page,
                messages: updateMessageList(page.messages),
              })),
            };
          }

          if (oldData.messages) {
            return {
              ...oldData,
              messages: updateMessageList(oldData.messages),
            };
          }

          return oldData;
        });
      });
    };

    const handleGlobalMessageDelivered = (payload) => {
      if (!payload) return;
      const convId = payload.conversationId || payload.realConvId;
      if (!convId || !payload.messageId) return;

      const keys = [payload.conversationId, payload.realConvId, payload.publicId].filter(Boolean);
      const uniqueKeys = [...new Set(keys)];

      uniqueKeys.forEach((convKey) => {
        queryClient.setQueryData(['messages', convKey], (oldData) => {
          if (!oldData) return oldData;

          const updateMessageList = (messages) => {
            if (!Array.isArray(messages)) return messages;
            return messages.map((msg) => {
              if (msg.id === payload.messageId && msg.status !== 'read' && msg.status !== 'seen') {
                return { ...msg, status: 'delivered' };
              }
              return msg;
            });
          };

          if (oldData.pages) {
            return {
              ...oldData,
              pages: oldData.pages.map((page) => ({
                ...page,
                messages: updateMessageList(page.messages),
              })),
            };
          }

          if (oldData.messages) {
            return {
              ...oldData,
              messages: updateMessageList(oldData.messages),
            };
          }

          return oldData;
        });
      });
    };

    socket.on('notification:new', handleNewNotification);
    socket.on('notification:count', handleNotificationCount);
    socket.on('presence:update', handlePresenceUpdate);
    socket.on('conversation:updated', handleConversationUpdated);
    socket.on('message:updated', handleMessageUpdated);
    socket.on('message:delivered', handleGlobalMessageDelivered);
    socket.on('messages:seen', handleGlobalConversationSeen);
    socket.on('conversation:seen', handleGlobalConversationSeen);
    socket.on('group:member_added', handleGroupMemberChange);
    socket.on('group:member_removed', handleGroupMemberChange);

    return () => {
      socket.off('notification:new', handleNewNotification);
      socket.off('notification:count', handleNotificationCount);
      socket.off('presence:update', handlePresenceUpdate);
      socket.off('conversation:updated', handleConversationUpdated);
      socket.off('message:updated', handleMessageUpdated);
      socket.off('message:delivered', handleGlobalMessageDelivered);
      socket.off('messages:seen', handleGlobalConversationSeen);
      socket.off('conversation:seen', handleGlobalConversationSeen);
      socket.off('group:member_added', handleGroupMemberChange);
      socket.off('group:member_removed', handleGroupMemberChange);
    };
  }, [socket, queryClient, navigate, session?.user?.id]);

  return null;
}
