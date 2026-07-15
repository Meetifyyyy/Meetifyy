import { useState, useMemo, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useData } from '@shared/context/DataContext';
import DefaultAvatar from '@shared/components/avatar/DefaultAvatar';
import { isImageUrl } from '@shared/utils/avatar';
import styles from '@features/crew/components/modals/ShareActivityModal.module.css';

export default function InviteModal({ isOpen, onClose, group }) {
  const [searchTerm, setSearchTerm] = useState('');
  const [copied, setCopied] = useState(false);
  const [sentTo, setSentTo] = useState(new Set());

  const { users, conversations, addGroupMember, startConversation, sendDirectMessage } = useData();
  const modalRef = useRef(null);

  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = 'unset';
    }
    return () => { document.body.style.overflow = 'unset'; };
  }, [isOpen]);

  const handleCopyLink = () => {
    const link = `${window.location.origin}/join/${group?.id || 'group'}`;
    navigator.clipboard.writeText(link).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const handleSend = async (user) => {
    if (!group?.id || sentTo.has(user.id)) return;

    // Send them a DM so they know
    const dmConvId = await startConversation(user);
    sendDirectMessage(dmConvId, `You've been invited to join the group "${group.name || 'a group'}".`, null, {
      groupId: group.id,
      groupName: group.name || 'Group'
    });

    setSentTo(prev => new Set(prev).add(user.id));
  };

  // Current group members
  const currentMemberIds = useMemo(() => {
    const conv = (conversations || []).find(c => c.id === group?.id);
    return new Set((conv?.members || conv?.participants || []).map(String));
  }, [conversations, group?.id]);

  // All users except current group members
  const filteredUsers = useMemo(() => {
    const allUsers = Object.values(users || {});
    const term = searchTerm.toLowerCase().trim();
    return allUsers
      .filter(u => !currentMemberIds.has(String(u.id)))
      .filter(u =>
        !term ||
        u.name?.toLowerCase().includes(term) ||
        u.displayName?.toLowerCase().includes(term) ||
        u.username?.toLowerCase().includes(term)
      );
  }, [users, searchTerm, currentMemberIds]);

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
            autoFocus
          />
        </div>

        <div className={styles.list}>
          {filteredUsers.length > 0 ? (
            filteredUsers.map(user => {
              const isSent = sentTo.has(user.id);
              return (
                <div key={user.id} className={styles.listItem}>
                  <div className={styles.contactInfo}>
                    {isImageUrl(user.avatar) ? (
                      <img src={user.avatar} alt={user.displayName || user.name} className={styles.avatar} />
                    ) : (
                      <DefaultAvatar size={40} name={user.displayName || user.name} className={styles.avatar} />
                    )}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '1px' }}>
                      <span className={styles.contactName}>{user.displayName || user.name}</span>
                      <span style={{ fontSize: '0.78rem', opacity: 0.55 }}>@{user.username}</span>
                    </div>
                  </div>
                  <button
                    className={styles.sendBtn}
                    onClick={() => handleSend(user)}
                    disabled={isSent}
                  >
                    {isSent ? 'Invited' : 'Invite'}
                  </button>
                </div>
              );
            })
          ) : (
            <div style={{ textAlign: 'center', padding: '20px', color: 'var(--color-text-light)' }}>
              {searchTerm ? 'No matching users.' : 'Everyone is already in the group.'}
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
