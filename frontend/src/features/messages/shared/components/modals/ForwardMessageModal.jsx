import { useState, useMemo, useEffect } from 'react';
import Avatar from '@shared/components/avatar/Avatar';
import { Search, Check, X } from 'lucide-react';
import styles from './ForwardMessageModal.module.css';
import { useOverlayBack } from '@shared/hooks/useOverlayBack';

export default function ForwardMessageModal({
  isOpen = true,
  onClose,
  conversations = [],
  onConfirmForward
}) {
  // Back dismisses this dialog rather than navigating the page behind it.
  useOverlayBack(Boolean(isOpen), onClose);

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedIds, setSelectedIds] = useState([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      setSearchQuery('');
      setSelectedIds([]);
      setIsSubmitting(false);
    }
  }, [isOpen]);

  const filteredConversations = useMemo(() => {
    if (!searchQuery.trim()) return conversations;
    const q = searchQuery.toLowerCase();
    return conversations.filter(c => (c.name || '').toLowerCase().includes(q));
  }, [conversations, searchQuery]);

  if (!isOpen) return null;

  const toggleSelect = (id) => {
    setSelectedIds(prev => 
      prev.includes(id) ? prev.filter(item => item !== id) : [...prev, id]
    );
  };

  const handleForward = async () => {
    if (selectedIds.length === 0 || isSubmitting) return;
    setIsSubmitting(true);
    try {
      await onConfirmForward(selectedIds);
      setSelectedIds([]);
      onClose();
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className={styles.modalOverlay} onClick={onClose}>
      <div className={styles.modalContent} onClick={(e) => e.stopPropagation()}>
        <div className={styles.dragHandleBar} />
        <div className={styles.modalHeader}>
          <h3>Forward Message</h3>
          <button className={styles.closeBtn} onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <div className={styles.searchWrap}>
          <Search size={16} className={styles.searchIcon} />
          <input
            type="text"
            className={styles.searchInput}
            placeholder="Search conversations..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>

        <div className={styles.convList}>
          {filteredConversations.length > 0 ? (
            filteredConversations.map((conv) => {
              const isSelected = selectedIds.includes(conv.id);
              return (
                <div
                  key={conv.id}
                  className={`${styles.convItem} ${isSelected ? styles.convItemSelected : ''}`}
                  onClick={() => toggleSelect(conv.id)}
                >
                  <Avatar src={conv.avatar} name={conv.name} size="40px" isGroup={conv.isGroup} />
                  <div className={styles.convInfo}>
                    <span className={styles.convName}>{conv.name}</span>
                  </div>
                  <div className={`${styles.checkbox} ${isSelected ? styles.checkboxChecked : ''}`}>
                    {isSelected && <Check size={14} strokeWidth={3} />}
                  </div>
                </div>
              );
            })
          ) : (
            <div className={styles.emptyText}>No conversations found</div>
          )}
        </div>

        <div className={styles.modalFooter}>
          <button 
            className={styles.forwardBtn}
            onClick={handleForward}
            disabled={selectedIds.length === 0 || isSubmitting}
          >
            {isSubmitting 
              ? 'Sending...' 
              : `Forward to ${selectedIds.length} ${selectedIds.length === 1 ? 'chat' : 'chats'}`
            }
          </button>
        </div>
      </div>
    </div>
  );
}
