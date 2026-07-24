import { useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { useGlobalSocketStore } from '../store/useGlobalSocketStore';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useNavigate } from 'react-router-dom';
import Avatar from './avatar/Avatar';

export default function SocketManager() {
  const { session, isLoggedIn } = useAuth();
  const { connect, disconnect, socket } = useGlobalSocketStore();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

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

      // Smart toast logic: suppress if user is on the exact screen
      const isViewingEntity =
        (notification.type === 'MESSAGE' && window.location.pathname.includes(`/messages/${notification.entityId}`));

      if (!isViewingEntity) {
        toast.custom((t) => {
          const actorName = notification.actor?.displayName || notification.actor?.username || notification.metadata?.actorDisplayName || notification.metadata?.actorName || notification.metadata?.username || 'Someone';
          const actorAvatar = notification.actor?.avatar || notification.metadata?.actorAvatar || '';
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
            bodyText = notification.metadata?.messageText || 'sent you a message.';
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
                <Avatar src={actorAvatar} name={actorName} size="40px" />
              </div>

              <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '2px' }}>
                <div style={{ fontSize: '0.85rem', lineHeight: '1.3', color: 'var(--color-text-muted, #475569)', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  <strong style={{ color: 'var(--color-text-main, #0f172a)', fontWeight: 700 }}>{actorName}</strong>{' '}
                  {bodyText}
                </div>
                <span style={{ fontSize: '0.72rem', color: 'var(--color-text-light, #94a3b8)', fontWeight: 500 }}>
                  just now
                </span>
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
      queryClient.setQueriesData({ queryKey: ['conversations'] }, (old) => {
        if (!Array.isArray(old)) return old;
        return old.map((c) => {
          if (c.targetUser?.id === userId) {
            return {
              ...c,
              targetUser: {
                ...c.targetUser,
                isOnline: status === 'online',
                lastActive: lastActive || c.targetUser.lastActive
              }
            };
          }
          return c;
        });
      });
    };

    const handleConversationUpdated = ({ conversationId, lastMessage }) => {
      queryClient.setQueryData(['conversations'], (old) => {
        if (!Array.isArray(old)) return old;
        const isViewing = window.location.pathname.includes(`/messages/${conversationId}`);

        return old.map((c) => {
          if (c.id === conversationId) {
            return {
              ...c,
              lastMessage,
              updatedAt: lastMessage.createdAt,
              unreadCount: isViewing ? 0 : (c.unreadCount || 0) + 1,
              unread: isViewing ? 0 : (c.unread || 0) + 1,
            };
          }
          return c;
        });
      });
    };

    socket.on('notification:new', handleNewNotification);
    socket.on('notification:count', handleNotificationCount);
    socket.on('presence:update', handlePresenceUpdate);
    socket.on('conversation:updated', handleConversationUpdated);

    return () => {
      socket.off('notification:new', handleNewNotification);
      socket.off('notification:count', handleNotificationCount);
      socket.off('presence:update', handlePresenceUpdate);
      socket.off('conversation:updated', handleConversationUpdated);
    };
  }, [socket, queryClient, navigate]);

  return null;
}
