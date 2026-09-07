import { useState, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { messagesApi } from '@shared/api/apiClient';
import { useRecipientConversations } from '@shared/hooks/useRecipientConversations';
import ShareModalAvatar from '@shared/components/avatar/ShareModalAvatar';
import styles from './ShareActivityModal.module.css';
import ShareTargets from '@shared/components/share/ShareTargets';
import { buildActivityShare } from '@shared/lib/share/sharePayload';
import { useOverlayBack } from '@shared/hooks/useOverlayBack';
import { useScrollLock } from '@shared/hooks/useScrollLock';

export default function ShareActivityModal({ isOpen, onClose, activity }) {
  // Back dismisses this dialog rather than navigating the page behind it.
  useOverlayBack(Boolean(isOpen), onClose);
  // Background stays put while this dialog is open. Counted, so a
  // dialog opened on top of another cannot unlock the page when it closes.
  useScrollLock(Boolean(isOpen));

  const [searchTerm, setSearchTerm] = useState('');
  const [sentTo, setSentTo] = useState(new Set());
  
  // Was an inline query on the inbox's own ['conversations'] key, which showed
  // every thread including ones whose counterpart cannot be sent to. A
  // recipient list is a different question from the inbox and now has its own
  // server-filtered query.
  const { conversations } = useRecipientConversations(isOpen);


  const handleSend = async (convId) => {
    if (sentTo.has(convId)) return;
    // Optimistic: mark as sent immediately, revert only if the request fails.
    setSentTo(prev => new Set(prev).add(convId));
    try {
      await messagesApi.sendDirectMessage(convId, {
        text: '',
        inviteData: {
          type: 'activityShare',
          activity: {
            id: activity.id,
            title: activity.title,
            time: activity.time,
            date: activity.date,
            dateLabel: activity.dateLabel,
            hostName: activity.hostName,
            category: activity.category,
            location: activity.location,
            description: activity.description,
            slotsNeeded: activity.slotsNeeded,
            slotsFilled: activity.slotsFilled,
            hostAvatar: activity.hostAvatar
          }
        }
      });
    } catch {
      setSentTo(prev => { const n = new Set(prev); n.delete(convId); return n; });
    }
  };

  // Filter conversations based on search term
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
          <h2 className={styles.title}>Share Activity</h2>
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

        {/*
          Every external destination, from one component. See
          @shared/components/share/ShareTargets — this dialog supplies
          only what is being shared.
        */}
        <ShareTargets payload={buildActivityShare(activity)} />
      </div>
    </div>,
    document.body
  );
}
