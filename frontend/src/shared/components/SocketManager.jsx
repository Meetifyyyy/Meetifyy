import { useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { useGlobalSocketStore } from '../stores/useGlobalSocketStore';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useNavigate } from 'react-router-dom';
import Avatar from './avatar/Avatar';
import { parseConversationRoute } from '../utils/conversationUrl';
import { messagesApi } from '../api/apiClient';
import { useGlobalSocketSync } from '../hooks/useGlobalSocketSync';
import { appendMessageToCache, matchesConversationId, getConversationAliases, updateConversationPreview } from '../../features/messages/shared/utils/cacheUtils';

export default function SocketManager() {
  const { session, isLoggedIn } = useAuth();
  const { connect, disconnect, socket } = useGlobalSocketStore();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  useGlobalSocketSync();

  useEffect(() => {
    if (isLoggedIn && session?.access_token) {
      connect(session.access_token);
    } else {
      disconnect();
    }
  }, [isLoggedIn, session?.access_token, connect, disconnect]);

  useEffect(() => {
    if (!socket) return;

    const handleNewNotification = (notification) => {
      if (notification.type?.toUpperCase() === 'MESSAGE') {
        return; // Handled via global message:new event
      }
      // Invalidate queries so useNotifications hook fetches the latest
      queryClient.invalidateQueries({ queryKey: ['notifications'] });

      // Smart toast logic: suppress if user is on the exact screen or if muted
      const currentEntityId = notification.entityId || notification.metadata?.conversationId;
      const pubId = notification.metadata?.publicId;
      const intId = notification.metadata?.internalId;
      const targetIds = [currentEntityId, pubId, intId].filter(Boolean);

      const convs = queryClient.getQueryData(['conversations']) || [];

      // MESSAGE-type notifications return early above, so this can never be true —
      // "am I already viewing this" is handled entirely by the message:new socket event.
      const isViewingEntity = false;

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
      } else if (!isMuted && window.location.pathname !== '/onboarding') {
        toast.custom((t) => {
          const isGroupMessage = Boolean(notification.metadata?.isGroup || notification.metadata?.conversationType === 'GROUP');
          const actorName = notification.actor?.displayName || notification.actor?.username || notification.metadata?.actorDisplayName || notification.metadata?.actorName || notification.metadata?.actorUsername || 'Someone';
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
                const origin = window.location.pathname.startsWith('/messages') || window.location.pathname.startsWith('/inbox') ? '/notifications' : window.location.pathname;
                navigate(`/messages/${convId}`, { state: { from: origin } });
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
                maxWidth: 'calc(100vw - 32px)',
                margin: '0 auto',
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

      const isSameId = (id1, id2) => {
        if (!id1 || !id2) return false;
        return String(id1).toLowerCase().trim() === String(id2).toLowerCase().trim();
      };

      const matchesUser = (userObj) => {
        if (!userObj) return false;
        return (
          isSameId(userObj.id, userId) ||
          isSameId(userObj.publicId, userId) ||
          isSameId(userObj.internalId, userId) ||
          isSameId(userObj.userId, userId)
        );
      };

      queryClient.setQueryData(['conversations'], (old) => {
        if (!Array.isArray(old)) return old;
        return old.map((c) => {
          let convModified = false;

          let updatedTargetUser = c.targetUser;
          if (c.targetUser && matchesUser(c.targetUser)) {
            updatedTargetUser = { ...c.targetUser, isOnline, lastActive: lastActive || c.targetUser.lastActive };
            convModified = true;
          }

          let updatedOtherUser = c.otherUser;
          if (c.otherUser && matchesUser(c.otherUser)) {
            updatedOtherUser = { ...c.otherUser, isOnline, lastActive: lastActive || c.otherUser.lastActive };
            convModified = true;
          }

          let updatedUser = c.user;
          if (c.user && matchesUser(c.user)) {
            updatedUser = { ...c.user, isOnline, lastActive: lastActive || c.user.lastActive };
            convModified = true;
          }

          let updatedParticipants = c.participants;
          if (Array.isArray(c.participants)) {
            let pModified = false;
            const newParts = c.participants.map((p) => {
              if (isSameId(p.userId, userId) || matchesUser(p.user) || isSameId(p.id, userId)) {
                pModified = true;
                return {
                  ...p,
                  isOnline,
                  user: p.user ? { ...p.user, isOnline, lastActive: lastActive || p.user?.lastActive } : p.user
                };
              }
              return p;
            });
            if (pModified) {
              updatedParticipants = newParts;
              convModified = true;
            }
          }

          let updatedMembers = c.members;
          if (Array.isArray(c.members)) {
            let mModified = false;
            const newMems = c.members.map((m) => {
              if (isSameId(m.userId, userId) || matchesUser(m.user) || isSameId(m.id, userId)) {
                mModified = true;
                return {
                  ...m,
                  isOnline,
                  user: m.user ? { ...m.user, isOnline, lastActive: lastActive || m.user?.lastActive } : m.user
                };
              }
              return m;
            });
            if (mModified) {
              updatedMembers = newMems;
              convModified = true;
            }
          }

          if (!convModified) return c;

          const isDmTargetMatch =
            (c.targetUser && matchesUser(c.targetUser)) ||
            (c.otherUser && matchesUser(c.otherUser)) ||
            (!c.isGroup && isSameId(c.userId, userId)) ||
            (!c.isGroup && isSameId(c.targetUserId, userId));

          return {
            ...c,
            ...(isDmTargetMatch ? { online: isOnline, isOnline } : {}),
            ...(updatedTargetUser ? { targetUser: updatedTargetUser } : {}),
            ...(updatedOtherUser ? { otherUser: updatedOtherUser } : {}),
            ...(updatedUser ? { user: updatedUser } : {}),
            participants: updatedParticipants,
            members: updatedMembers,
          };
        });
      });

      queryClient.setQueryData(['users'], (old) => {
        if (!Array.isArray(old)) return old;
        return old.map((u) => {
          if (matchesUser(u)) {
            return {
              ...u,
              isOnline,
              online: isOnline,
              lastActive: lastActive || u.lastActive
            };
          }
          return u;
        });
      });

      queryClient.setQueryData(['campusUsers'], (old) => {
        if (!Array.isArray(old)) return old;
        return old.map((u) => {
          if (matchesUser(u)) {
            return {
              ...u,
              isOnline,
              online: isOnline,
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
          online: isOnline,
          lastActive: lastActive || old.lastActive
        };
      });

      queryClient.setQueriesData({ queryKey: ['profile'] }, (old) => {
        if (!old) return old;
        if (matchesUser(old) || matchesUser(old.user)) {
          return {
            ...old,
            isOnline,
            online: isOnline,
            lastActive: lastActive || old.lastActive
          };
        }
        return old;
      });

      queryClient.setQueriesData({ queryKey: ['followers'] }, (old) => {
        if (!old) return old;
        if (Array.isArray(old)) {
          return old.map(u => matchesUser(u) || matchesUser(u.user) ? { ...u, isOnline, online: isOnline, user: u.user ? { ...u.user, isOnline, online: isOnline } : u.user } : u);
        }
        return old;
      });

      queryClient.setQueriesData({ queryKey: ['following'] }, (old) => {
        if (!old) return old;
        if (Array.isArray(old)) {
          return old.map(u => matchesUser(u) || matchesUser(u.user) ? { ...u, isOnline, online: isOnline, user: u.user ? { ...u.user, isOnline, online: isOnline } : u.user } : u);
        }
        return old;
      });

      queryClient.setQueriesData({ queryKey: ['search'] }, (old) => {
        if (!old) return old;
        if (Array.isArray(old)) {
          return old.map(u => matchesUser(u) ? { ...u, isOnline, online: isOnline } : u);
        }
        if (Array.isArray(old.users)) {
          return {
            ...old,
            users: old.users.map(u => matchesUser(u) ? { ...u, isOnline, online: isOnline } : u)
          };
        }
        return old;
      });

      queryClient.setQueriesData({ queryKey: ['community-members'] }, (old) => {
        if (!old) return old;
        if (Array.isArray(old)) {
          return old.map(m => matchesUser(m) || matchesUser(m.user) ? { ...m, isOnline, online: isOnline, user: m.user ? { ...m.user, isOnline, online: isOnline } : m.user } : m);
        }
        return old;
      });

      queryClient.setQueriesData({ queryKey: ['activity-members'] }, (old) => {
        if (!old) return old;
        if (Array.isArray(old)) {
          return old.map(m => matchesUser(m) || matchesUser(m.user) ? { ...m, isOnline, online: isOnline, user: m.user ? { ...m.user, isOnline, online: isOnline } : m.user } : m);
        }
        return old;
      });

      queryClient.setQueriesData({ queryKey: ['messages'] }, (oldData) => {
        if (!oldData) return oldData;
        if (oldData.pages) {
          return {
            ...oldData,
            pages: oldData.pages.map(page => {
              if (!page) return page;
              const updatedParts = Array.isArray(page.participants)
                ? page.participants.map(p => {
                    if (isSameId(p.userId, userId) || matchesUser(p.user)) {
                      return {
                        ...p,
                        isOnline,
                        user: p.user ? { ...p.user, isOnline } : p.user
                      };
                    }
                    return p;
                  })
                : page.participants;
              return {
                ...page,
                participants: updatedParts
              };
            })
          };
        }
        return oldData;
      });
    };

    const handleGroupMemberChange = (payload) => {
      if (!payload) return;
      const convId = payload.conversationId || payload.id || payload.publicId || payload.data?.conversationId;
      const targetUserId = payload.targetUserId || payload.userId || payload.data?.targetUserId || payload.data?.userId;
      const isMe = String(targetUserId) === String(session?.user?.id);
      const isRemoved = payload.eventType === 'remove' || payload.type === 'group:member_removed' || Boolean(payload.removedBy);

      const convs = queryClient.getQueryData(['conversations']) || [];
      const matchConv = convs.find(c => c.id === convId || c.publicId === convId || c.internalId === convId);
      const isCurrentMember = matchConv ? (matchConv.isMember !== false && matchConv.myMembershipStatus !== 'KICKED') : true;

      if (isCurrentMember) {
        queryClient.invalidateQueries({ queryKey: ['groupDetails'] });
        if (convId) {
          queryClient.invalidateQueries({ queryKey: ['groupDetails', convId] });
        }
      }

      queryClient.setQueryData(['conversations'], (old) => {
        if (!Array.isArray(old)) return old;
        return old.map((c) => {
          const match = c.id === convId || c.publicId === convId || c.internalId === convId;
          if (match) {
            const count = c.memberCount || c.membersCount || 0;
            if (isMe) {
              return {
                ...c,
                isMember: !isRemoved,
                myMembershipStatus: isRemoved ? 'KICKED' : 'MEMBER',
                leftAt: isRemoved ? new Date().toISOString() : null,
                memberCount: isRemoved ? Math.max(0, count - 1) : count + 1,
                membersCount: isRemoved ? Math.max(0, count - 1) : count + 1,
              };
            } else {
              // If current user is already removed from this group, freeze their member list & count
              if (c.isMember === false || c.myMembershipStatus === 'KICKED') {
                return c;
              }
              const newCount = isRemoved ? Math.max(0, count - 1) : count + 1;
              return {
                ...c,
                memberCount: newCount,
                membersCount: newCount,
              };
            }
          }
          return c;
        });
      });

      queryClient.invalidateQueries({ queryKey: ['conversations'] });
      queryClient.invalidateQueries({ queryKey: ['group-chats'] });
    };

    const handleConversationUpdated = (payload) => {
      if (!payload) return;
      const convId = payload.conversationId || payload.id || payload.publicId;

      if (convId) {
        queryClient.setQueriesData({ queryKey: ['groupDetails'] }, (old) => {
          if (!old) return old;
          const match =
            String(old.id) === String(convId) ||
            String(old.publicId) === String(convId) ||
            String(old.internalId) === String(convId) ||
            (payload.internalId && String(old.id) === String(payload.internalId)) ||
            (payload.publicId && String(old.publicId) === String(payload.publicId));

          const incomingAvatar = payload.avatarKey !== undefined ? payload.avatarKey : payload.avatar;
          if (match) {
            return {
              ...old,
              ...(payload.name !== undefined ? { name: payload.name } : {}),
              ...(incomingAvatar !== undefined ? { avatar: incomingAvatar, avatarKey: incomingAvatar } : {}),
              ...(payload.description !== undefined ? { description: payload.description } : {}),
              ...(payload.whoCanJoin !== undefined ? { whoCanJoin: payload.whoCanJoin } : {}),
              ...(payload.visibility !== undefined ? { visibility: payload.visibility } : {}),
              ...(payload.allowSharing !== undefined ? { allowSharing: payload.allowSharing } : {}),
              ...(payload.editGroupPermission !== undefined ? { editGroupPermission: payload.editGroupPermission } : {}),
              ...(payload.ownerId ? { ownerId: payload.ownerId } : {}),
            };
          }
          return old;
        });
      }

      queryClient.setQueryData(['conversations'], (old) => {
        if (!Array.isArray(old)) return old;

        // If this is a brand-new group broadcast (isNewGroup flag from backend)
        // and the conversation isn't in the list yet, inject it directly.
        if (payload.isNewGroup) {
          const alreadyExists = old.some(
            c => c.id === convId || c.publicId === convId || c.internalId === convId
          );
          if (!alreadyExists && convId) {
            const newConv = {
              id: payload.publicId || convId,
              publicId: payload.publicId || convId,
              internalId: payload.internalId || convId,
              name: payload.name || 'Group',
              type: payload.type || 'GROUP',
              isGroup: true,
              ownerId: payload.ownerId || null,
              status: payload.status || 'ACTIVE',
              avatar: payload.avatar || null,
              avatarKey: payload.avatar || null,
              createdAt: payload.createdAt || new Date().toISOString(),
              updatedAt: payload.updatedAt || new Date().toISOString(),
              lastMessage: null,
              unread: 0,
              unreadCount: 0,
              timestamp: payload.createdAt ? new Date(payload.createdAt).getTime() : Date.now(),
              pinned: false,
              muted: false,
              isMember: true,
              memberCount: payload.memberCount || 1,
            };
            return [newConv, ...old];
          }
        }

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

        const incomingAvatar = payload.avatarKey !== undefined ? payload.avatarKey : payload.avatar;
        return old.map((c) => {
          if (c.id === convId || c.publicId === convId || c.internalId === convId) {
            const lastMsg = payload.lastMessage;
            return {
              ...c,
              ...(payload.name ? { name: payload.name } : {}),
              ...(incomingAvatar !== undefined ? { avatar: incomingAvatar, avatarKey: incomingAvatar } : {}),
              ...(payload.description !== undefined ? { description: payload.description } : {}),
              ...(payload.whoCanJoin !== undefined ? { whoCanJoin: payload.whoCanJoin } : {}),
              ...(payload.visibility !== undefined ? { visibility: payload.visibility } : {}),
              ...(payload.allowSharing !== undefined ? { allowSharing: payload.allowSharing } : {}),
              ...(payload.editGroupPermission !== undefined ? { editGroupPermission: payload.editGroupPermission } : {}),
              ...(lastMsg ? { lastMessage: lastMsg, updatedAt: lastMsg.createdAt } : {}),
              ...(payload.ownerId ? { ownerId: payload.ownerId } : {}),
              // Do NOT touch unreadCount here — it's managed by the message:new flow
            };
          }
          return c;
        });
      });
    };


    const handleMessageUpdated = (payload) => {
      if (!payload || (!payload.id && !payload.messageId)) return;
      const msgId = payload.id || payload.messageId;
      const keys = [payload.conversationId, payload.publicId, payload.internalId].filter(Boolean);
      const uniqueKeys = [...new Set(keys)];

      const targetKeys = new Set(
        [msgId, payload.tempId, payload.clientId].filter(Boolean).map(String)
      );

      uniqueKeys.forEach((convKey) => {
        queryClient.setQueryData(['messages', convKey], (old) => {
          if (!old) return old;

          const updateList = (msgList) => {
            if (!Array.isArray(msgList)) return msgList;
            return msgList.map((m) => {
              const isMatch =
                targetKeys.has(String(m.id)) ||
                (m.tempId && targetKeys.has(String(m.tempId))) ||
                (m.clientId && targetKeys.has(String(m.clientId)));

              if (isMatch) {
                const isUnsent = payload.state === 'UNSENT' || payload.isUnsent;
                return {
                  ...m,
                  ...payload,
                  state: payload.state || 'UNSENT',
                  isUnsent,
                  text: isUnsent ? 'This message was unsent' : (payload.text || ''),
                  payload: isUnsent ? { text: 'This message was unsent' } : (payload.payload || { text: payload.text }),
                  mediaUrl: isUnsent ? null : (payload.mediaUrl || null),
                  mediaType: isUnsent ? null : (payload.mediaType || null),
                  inviteData: isUnsent ? null : (payload.inviteData || null),
                  replyTo: isUnsent ? null : (payload.replyTo || null),
                };
              }
              return m;
            });
          };

          if (old.pages) {
            return {
              ...old,
              pages: old.pages.map((page) => ({
                ...page,
                messages: updateList(page.messages || []),
              })),
            };
          }

          if (old.messages) {
            return {
              ...old,
              messages: updateList(old.messages),
            };
          }

          return old;
        });
      });

      const targetConvId = payload.conversationId || payload.publicId || payload.internalId;
      if (targetConvId) {
        updateConversationPreview(queryClient, targetConvId, payload.text || 'This message was unsent');
      }
    };

    const handleGlobalConversationSeen = (payload) => {
      if (!payload) return;
      const convId = payload.conversationId || payload.realConvId || payload.publicId;
      if (!convId) return;

      const currentUserId = session?.user?.id;
      const isMySeen = payload.readerId && String(payload.readerId) === String(currentUserId);

      if (isMySeen) {
        queryClient.setQueryData(['conversations'], (oldConvs) => {
          if (!Array.isArray(oldConvs)) return oldConvs;
          return oldConvs.map((c) => {
            if (c.id === convId || c.publicId === convId || c.internalId === convId) {
              return { ...c, unreadCount: 0, unread: 0 };
            }
            return c;
          });
        });
        return;
      }

      if (!payload.lastReadAt) return;

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

    const handleGlobalMessageNew = (message) => {
      if (!message) return;
      const currentUserId = session?.user?.id;

      const isSenderSelf = String(message.senderId) === String(currentUserId) || message.from === 'me' || message.senderId === 'me';
      if (isSenderSelf) return;

      const convId = message.conversationId || message.publicId || message.internalId;
      if (!convId) return;

      const convs = queryClient.getQueryData(['conversations']) || [];
      const targetConv = convs.find(
        (c) =>
          matchesConversationId(c, convId) ||
          matchesConversationId(c, message.conversationId) ||
          matchesConversationId(c, message.publicId) ||
          matchesConversationId(c, message.internalId)
      );

      const currentPath = window.location.pathname;
      const isMessagesRoute = currentPath.startsWith('/messages') || currentPath.startsWith('/inbox');

      let isViewingCurrentChat = false;
      if (isMessagesRoute) {
        const pathParts = currentPath.split('/').filter(Boolean);
        const param1 = pathParts[1];
        const param2 = pathParts[2];
        const routeInfo = parseConversationRoute(param1, param2);
        const viewedId = routeInfo.publicId || param2 || param1;

        if (viewedId) {
          if (
            viewedId === convId ||
            viewedId === message.conversationId ||
            viewedId === message.publicId ||
            viewedId === message.internalId ||
            (targetConv && matchesConversationId(targetConv, viewedId))
          ) {
            isViewingCurrentChat = true;
          }
        }
      }

      // 1. Instant update of ['conversations'] cache so unread counts, latest snippet, and timestamps update immediately
      queryClient.setQueryData(['conversations'], (oldConvs) => {
        if (!Array.isArray(oldConvs)) return oldConvs;

        let found = false;
        const updatedConvs = oldConvs.map((c) => {
          const match =
            matchesConversationId(c, convId) ||
            (message.conversationId && matchesConversationId(c, message.conversationId)) ||
            (message.publicId && matchesConversationId(c, message.publicId));

          if (match) {
            found = true;
            const currentUnread = c.unreadCount || c.unread || 0;
            const textSnippet = message.text || (message.mediaType === 'image' ? 'Photo' : message.mediaType === 'video' ? 'Video' : message.mediaUrl ? 'Media' : '');
            return {
              ...c,
              lastMessage: message,
              lastMsg: textSnippet,
              updatedAt: message.createdAt || new Date().toISOString(),
              timestamp: new Date(message.createdAt || Date.now()).getTime(),
              unreadCount: isViewingCurrentChat ? currentUnread : currentUnread + 1,
              unread: isViewingCurrentChat ? currentUnread : currentUnread + 1,
            };
          }
          return c;
        });

        if (!found) {
          queryClient.invalidateQueries({ queryKey: ['conversations'] });
          return oldConvs;
        }

        return [...updatedConvs].sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
      });

      // 2. Instant update of ['messages', key] query cache for all aliases
      const aliases = targetConv ? getConversationAliases(targetConv) : [];
      const targetKeys = [...new Set([message.conversationId, message.publicId, message.internalId, ...aliases].filter(Boolean))];
      targetKeys.forEach((key) => {
        appendMessageToCache(queryClient, key, message);
      });

      // 3. If chat is NOT currently open, show instant screen toast notification
      if (!isViewingCurrentChat) {
        const isMuted = Boolean(targetConv?.muted || targetConv?.isMuted);

        if (!isMuted && window.location.pathname !== '/onboarding') {
          toast.custom((t) => {
            const actorName = message.senderName || message.sender?.displayName || message.sender?.username || 'Someone';
            const actorAvatar = message.senderAvatar || message.sender?.avatar || '';
            const isGroupMessage = Boolean(message.isGroup || targetConv?.isGroup);
            const groupName = targetConv?.name || 'Group';
            const groupAvatar = targetConv?.avatar || '';
            const textSnippet = message.text || (message.mediaType === 'image' ? 'Sent a photo' : message.mediaType === 'video' ? 'Sent a video' : message.mediaUrl ? 'Sent media' : 'New message');

            return (
              <div
                onClick={() => {
                  toast.dismiss(t);
                  const origin = window.location.pathname.startsWith('/messages') || window.location.pathname.startsWith('/inbox') ? '/home' : window.location.pathname;
                  navigate(`/messages/${convId}`, { state: { from: origin } });
                }}
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
                    src={isGroupMessage ? (groupAvatar || actorAvatar) : actorAvatar} 
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

                  <div style={{ fontSize: '0.83rem', color: 'var(--color-text-muted, #475569)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {isGroupMessage ? <><span style={{ fontWeight: 600, color: 'var(--color-text-main, #0f172a)' }}>{actorName}:</span> {textSnippet}</> : textSnippet}
                  </div>
                </div>
              </div>
            );
          }, { duration: 4000 });
        }
      }
    };

    const handleCommunityUpdate = (data) => {
      queryClient.invalidateQueries({ queryKey: ['communities'] });
      if (data?.communityId) {
        queryClient.invalidateQueries({ queryKey: ['community', data.communityId] });
      }
    };

    socket.on('notification:new', handleNewNotification);
    socket.on('notification:count', handleNotificationCount);
    socket.on('presence:update', handlePresenceUpdate);
    socket.on('conversation:updated', handleConversationUpdated);
    socket.on('message:new', handleGlobalMessageNew);
    socket.on('message:updated', handleMessageUpdated);
    socket.on('group:member_added', (data) => handleGroupMemberChange({ ...(data || {}), eventType: 'add' }));
    socket.on('group:member_removed', (data) => handleGroupMemberChange({ ...(data || {}), eventType: 'remove' }));
    socket.on('group:role_changed', (data) => handleGroupMemberChange({ ...(data || {}), eventType: 'role_change' }));
    socket.on('community:memberCount', handleCommunityUpdate);
    socket.on('community:updated', handleCommunityUpdate);

    return () => {
      socket.off('notification:new', handleNewNotification);
      socket.off('notification:count', handleNotificationCount);
      socket.off('presence:update', handlePresenceUpdate);
      socket.off('conversation:updated', handleConversationUpdated);
      socket.off('message:new', handleGlobalMessageNew);
      socket.off('message:updated', handleMessageUpdated);
      socket.off('group:member_added', handleGroupMemberChange);
      socket.off('group:member_removed', handleGroupMemberChange);
      socket.off('group:role_changed', handleGroupMemberChange);
      socket.off('community:memberCount', handleCommunityUpdate);
      socket.off('community:updated', handleCommunityUpdate);
    };
  }, [socket, queryClient, navigate, session?.user?.id]);

  return null;
}
