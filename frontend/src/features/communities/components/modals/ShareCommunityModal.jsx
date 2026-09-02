import { useState, useMemo } from 'react';
import { createPortal } from 'react-dom';

import ShareModalAvatar from '@shared/components/avatar/ShareModalAvatar';
import styles from '@features/crew/components/modals/ShareActivityModal.module.css';
// The picker's list, not the inbox's: server-filtered to threads that can
// actually be sent into. See useRecipientConversations.
import { useRecipientConversations } from '@shared/hooks/useRecipientConversations';
import { useMessageActions } from '@shared/hooks/useMessageActions';
import { useOverlayBack } from '@shared/hooks/useOverlayBack';
import { useScrollLock } from '@shared/hooks/useScrollLock';

/**
 * Member count for a community, whichever shape it arrived in: the list endpoint
 * returns `memberCount`, some payloads carry `membersCount`, and the detail
 * endpoint returns a `members` array.
 */
function toMemberCount(community) {
  const direct = community?.memberCount ?? community?.membersCount;
  if (typeof direct === 'number' && Number.isFinite(direct)) return direct;
  if (Array.isArray(community?.members)) return community.members.length;
  return 0;
}

export default function ShareCommunityModal({ isOpen, onClose, community }) {
  // Back dismisses this dialog rather than navigating the page behind it.
  useOverlayBack(Boolean(isOpen), onClose);
  // Background stays put while this dialog is open. Counted, so a
  // dialog opened on top of another cannot unlock the page when it closes.
  useScrollLock(Boolean(isOpen));

  const [searchTerm, setSearchTerm] = useState('');
  const [copied, setCopied] = useState(false);
  const [sentTo, setSentTo] = useState(new Set());
  
  const { conversations } = useRecipientConversations(isOpen);
  const { sendDirectMessage } = useMessageActions();

  const handleCopyLink = () => {
    const link = `${window.location.origin}/communities/${community.id}`;
    navigator.clipboard.writeText(link).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const handleSend = async (convId) => {
    await sendDirectMessage(convId, { 
      text: '',
      inviteData: { 
        type: 'communityShare', 
        community: {
          id: community.id,
          name: community.name,
          // Community payloads carry the image under `avatarKey`; `avatar` is only
          // set on some shapes. Reading just `avatar` meant a shared community
          // almost always rendered the placeholder instead of its picture.
          avatar: community.avatarKey || community.avatar || null,
          color: community.color,
          description: community.description || community.desc,
          // A COUNT, not the member list. `community.members` is an array of
          // member objects, and sending it here is what made the chat preview
          // render "[object Object],[object Object],[object Object] Members" —
          // the preview formats this value with toLocaleString().
          membersCount: toMemberCount(community)
        } 
      }
    });
    setSentTo(prev => new Set(prev).add(convId));
  };

  // Filter conversations
  const filteredConversations = useMemo(() => {
    if (!conversations) return [];
    
    // Sort by most recent first
    const sorted = [...conversations].sort((a, b) => {
      return (b.createdAt || 0) - (a.createdAt || 0);
    });

    if (!searchTerm.trim()) return sorted;
    
    const lowerSearch = searchTerm.toLowerCase();
    return sorted.filter(c => c.name?.toLowerCase().includes(lowerSearch));
  }, [conversations, searchTerm]);

  if (!isOpen) return null;

  return createPortal(
    <div className={styles.overlay} onClick={(e) => { e.stopPropagation(); e.preventDefault(); onClose(); }}>
      <div className={styles.modal} onClick={e => e.stopPropagation()}>
        <div className={styles.header}>
          <h2 className={styles.title}>Share Community</h2>
          <button className={styles.closeBtn} onClick={(e) => { e.stopPropagation(); e.preventDefault(); onClose(); }} aria-label="Close">
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
            placeholder="Search connections or groups..."
            className={styles.searchInput}
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>

        <div className={styles.list}>
          {filteredConversations.length > 0 ? (
            filteredConversations.map(conv => {
              const isSent = sentTo.has(conv.id);
              return (
                <div key={conv.id} className={styles.listItem}>
                  <div className={styles.contactInfo}>
                    <ShareModalAvatar conv={conv} size="48px" />
                    <span className={styles.contactName}>{conv.name}</span>
                  </div>
                  <button 
                    className={styles.sendBtn}
                    onClick={() => handleSend(conv.id)}
                    disabled={isSent}
                  >
                    {isSent ? 'Sent' : 'Send'}
                  </button>
                </div>
              );
            })
          ) : (
            <div style={{ textAlign: 'center', padding: '20px', color: 'var(--color-text-light)' }}>
              No chats found.
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
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path>
                <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path>
              </svg>
              Copy Link
            </>
          )}
        </button>
      </div>
    </div>,
    document.body
  );
}
