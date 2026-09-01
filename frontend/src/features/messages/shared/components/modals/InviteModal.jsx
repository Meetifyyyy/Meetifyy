import { useState, useMemo, useEffect, useRef } from 'react';
import { selectableUsers } from '@shared/lib/conversationTargets';
import { createPortal } from 'react-dom';
import { useQuery } from '@tanstack/react-query';
import { usersApi, groupApi, getMediaUrl } from '@shared/api/apiClient';
import { useAuth } from '@shared/context/AuthContext';
import DefaultAvatar from '@shared/components/avatar/DefaultAvatar';
import { isImageUrl } from '@shared/utils/avatar';
import styles from './InviteModal.module.css';
import { useUsersMap } from '@shared/hooks/useUsersMap';
import { useConversations } from '@shared/hooks/useMessages';
import { useMessageActions } from '@shared/hooks/useMessageActions';
import { showToast } from '@shared/utils/toast';
import { generateConversationUrl } from '@shared/utils/conversationUrl';
import { useOverlayBack } from '@shared/hooks/useOverlayBack';

export default function InviteModal({ isOpen, onClose, group }) {
  // Back dismisses this dialog rather than navigating the page behind it.
  useOverlayBack(Boolean(isOpen), onClose);

  const [searchTerm, setSearchTerm] = useState('');
  const [copied, setCopied] = useState(false);
  const [sentTo, setSentTo] = useState(new Set());
  const [sendingIds, setSendingIds] = useState(new Set());

  const { currentUser } = useAuth();
  const users = useUsersMap();
  const { conversations } = useConversations();
  const { startConversation, sendDirectMessage } = useMessageActions();
  const modalRef = useRef(null);
  const copyLockRef = useRef(false);

  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = 'unset';
    }
    return () => { document.body.style.overflow = 'unset'; };
  }, [isOpen]);

  const handleCopyLink = () => {
    if (copyLockRef.current) return;
    copyLockRef.current = true;

    const relativeUrl = generateConversationUrl(group, currentUser?.id, '/inbox');
    const link = `${window.location.origin}${relativeUrl}`;
    navigator.clipboard.writeText(link).then(() => {
      setCopied(true);
      showToast('Invite link copied', 'success');
      setTimeout(() => {
        setCopied(false);
        copyLockRef.current = false;
      }, 2000);
    }).catch(() => {
      copyLockRef.current = false;
    });
  };

  const handleSend = async (user) => {
    if (!group?.id || sentTo.has(user.id) || sendingIds.has(user.id)) return;

    setSendingIds(prev => new Set(prev).add(user.id));
    try {
      const dmConvId = await startConversation(user.id);
      
      const inviteData = {
        groupId: group.id,
        conversationId: group.id,
        groupName: group.name || 'Group',
        groupAvatar: group.avatar || group.avatarKey || group.icon || group.coverImage || group.avatarUrl || null,
        description: group.description || '',
        whoCanJoin: group.whoCanJoin || 'ANYONE',
        memberCount: group.memberCount || group.members?.length || 1,
        type: 'group_invite'
      };

      await sendDirectMessage(
        dmConvId,
        '',
        null,
        null,
        null,
        null,
        null,
        inviteData
      );

      setSentTo(prev => new Set(prev).add(user.id));
    } catch {
      showToast("Couldn't send invite", 'error');
    } finally {
      setSendingIds(prev => {
        const next = new Set(prev);
        next.delete(user.id);
        return next;
      });
    }
  };

  // Fetch fresh group details when modal is open to get exact current member list
  const groupConvId = group?.id || group?.publicId || group?.internalId;
  const { data: modalGroupDetails } = useQuery({
    queryKey: ['groupDetails', groupConvId],
    queryFn: () => groupApi.getDetails(groupConvId),
    enabled: Boolean(isOpen && groupConvId),
    staleTime: 1000 * 10,
  });

  // Current group members & current user
  const currentMemberIds = useMemo(() => {
    const ids = new Set();
    if (currentUser?.id) ids.add(String(currentUser.id));

    const addId = (val) => {
      if (!val) return;
      const id = typeof val === 'string' ? val : (val.id || val.userId || val.user?.id);
      if (id) ids.add(String(id));
    };

    if (group?.ownerId) ids.add(String(group.ownerId));
    if (group?.hostId) ids.add(String(group.hostId));
    if (modalGroupDetails?.ownerId) ids.add(String(modalGroupDetails.ownerId));

    if (Array.isArray(group?.admins)) group.admins.forEach(addId);
    if (Array.isArray(group?.members)) group.members.forEach(addId);
    if (Array.isArray(group?.participants)) group.participants.forEach(addId);
    if (Array.isArray(group?.memberDetails)) group.memberDetails.forEach(addId);

    if (Array.isArray(modalGroupDetails?.admins)) modalGroupDetails.admins.forEach(addId);
    if (Array.isArray(modalGroupDetails?.members)) modalGroupDetails.members.forEach(addId);
    if (Array.isArray(modalGroupDetails?.memberDetails)) modalGroupDetails.memberDetails.forEach(addId);

    const conv = (conversations || []).find(
      c => String(c.id) === String(groupConvId) || String(c.publicId) === String(groupConvId) || String(c.internalId) === String(groupConvId)
    );
    if (conv) {
      if (conv.ownerId) ids.add(String(conv.ownerId));
      if (Array.isArray(conv.admins)) conv.admins.forEach(addId);
      if (Array.isArray(conv.members)) conv.members.forEach(addId);
      if (Array.isArray(conv.participants)) conv.participants.forEach(addId);
    }

    return ids;
  }, [conversations, group, modalGroupDetails, currentUser?.id, groupConvId]);

  // Fetch registered candidate users for invitation
  const { data: fetchedUsers = [] } = useQuery({
    queryKey: ['all-users-for-invite', searchTerm],
    queryFn: async () => {
      const list = await usersApi.getConnections(searchTerm, 50).catch(() => []);
      // `selectableUsers` drops deleted accounts. The server already excludes
      // them; this covers the window where a cached response (20s server-side,
      // 30s here) still carries somebody who has since deleted.
      return selectableUsers(list).filter(
        (u) => String(u.id) !== String(currentUser?.id)
      );
    },
    enabled: Boolean(isOpen),
    staleTime: 30_000,
  });

  const filteredUsers = fetchedUsers;

  if (!isOpen) return null;

  return createPortal(
    <div
      className={styles.overlay}
      onClick={(e) => {
        e.stopPropagation();
        e.preventDefault();
        onClose();
      }}
    >
      <div
        className={styles.modal}
        onClick={e => e.stopPropagation()}
        ref={modalRef}
      >
        <div className={styles.header}>
          <h2 className={styles.title}>Invite People</h2>
          <button className={styles.closeBtn} onClick={onClose} aria-label="Close">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>

        <div className={styles.searchContainer}>
          <svg className={styles.searchIcon} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8"></circle>
            <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
          </svg>
          <input
            type="text"
            placeholder="Search people..."
            className={styles.searchInput}
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>

        <div className={styles.list}>
          {filteredUsers.length > 0 ? (
            filteredUsers.map(user => {
              const isSent = sentTo.has(user.id);
              const isSending = sendingIds.has(user.id);
              return (
                <div key={user.id} className={styles.listItem}>
                  <div className={styles.contactInfo}>
                    {isImageUrl(user.avatar) ? (
                      <img src={getMediaUrl(user.avatar)} alt={user.displayName || user.name} className={styles.avatar} onError={(e) => { e.target.onerror = null; e.target.src = '/default_avatar.webp'; }} />
                    ) : (
                      <DefaultAvatar size={40} name={user.displayName || user.name} className={styles.avatar} />
                    )}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '1px' }}>
                      <span className={styles.contactName}>{user.displayName || user.name}</span>
                      <span className={styles.contactHandle}>@{user.username}</span>
                    </div>
                  </div>
                  <button
                    className={styles.sendBtn}
                    onClick={() => handleSend(user)}
                    disabled={isSent || isSending}
                  >
                    {isSent ? 'Invited' : (isSending ? 'Sending...' : 'Invite')}
                  </button>
                </div>
              );
            })
          ) : (
            <div style={{ textAlign: 'center', padding: '20px', color: 'var(--color-text-light)' }}>
              {searchTerm ? 'No matching users.' : 'No users found.'}
            </div>
          )}
        </div>

        <button className={styles.copyLinkBtn} onClick={handleCopyLink}>
          {copied ? (
            <>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12"></polyline>
              </svg>
              Copied!
            </>
          ) : (
            <>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path>
                <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path>
              </svg>
              Copy Invite Link
            </>
          )}
        </button>
      </div>
    </div>,
    document.body
  );
}
