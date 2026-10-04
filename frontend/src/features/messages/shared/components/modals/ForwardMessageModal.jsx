import { useState, useMemo, useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import Avatar from '@shared/components/avatar/Avatar';
import { Search, Check, X } from '@shared/components/icons';
import styles from './ForwardMessageModal.module.css';
import { useOverlayBack } from '@shared/hooks/useOverlayBack';
import { useScrollLock } from '@shared/hooks/useScrollLock';
import { useDialogFocus } from '@shared/hooks/useDialogFocus';
import RowSkeleton from '@shared/components/skeletons/RowSkeleton';
import { filterForwardTargets, forwardEmptyMessage, forwardListState } from '../../utils/forwardTargets';
import { ForwardPartialError, newForwardOperationId } from '../../utils/forwardDelivery';

/**
 * Pick chats to forward something to.
 *
 * `onConfirmForward(selectedIds, { operationId })` does the sending. Two parts of
 * its contract matter:
 *
 *  - `operationId` is the same for every attempt made while this sheet stays open
 *    (it is renewed after a complete success). Deriving each recipient's client id
 *    from it lets the server recognise a retry of a send that already went through.
 *  - If only some recipients failed, throw `ForwardPartialError`. The sheet then
 *    narrows its selection to `failedIds`, so the retry targets only the people
 *    who have not received it. Any other error keeps the selection as it was.
 *
 * It is portalled to <body> and above the media viewer, as a modal dialog: it can
 * be opened over the viewer or the chat, and Escape dismisses only this sheet.
 */
export default function ForwardMessageModal({
  isOpen = true,
  msg = null,
  onClose,
  conversations = [],
  isLoading = false,
  onConfirmForward
}) {
  // Back dismisses this dialog rather than navigating the page behind it.
  useOverlayBack(Boolean(isOpen), onClose);
  // Background stays put while this dialog is open. Counted, so a
  // dialog opened on top of another cannot unlock the page when it closes.
  useScrollLock(Boolean(isOpen));

  const titleId = useId();
  const dialogRef = useRef(null);
  // Focus lands on the dialog itself, not the search field: on a phone, focusing
  // an input would raise the keyboard over a list the person has not seen yet.
  useDialogFocus(dialogRef, {
    active: Boolean(isOpen),
    onEscape: onClose,
    getInitialFocus: () => dialogRef.current,
  });

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedIds, setSelectedIds] = useState([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
  const operationIdRef = useRef(null);

  useEffect(() => {
    if (!isOpen) {
      setSearchQuery('');
      setSelectedIds([]);
      setIsSubmitting(false);
      setStatusMessage('');
      operationIdRef.current = null;
    }
  }, [isOpen]);

  const filteredConversations = useMemo(
    () => filterForwardTargets(conversations, searchQuery),
    [conversations, searchQuery],
  );

  if (!isOpen) return null;

  const listState = forwardListState({ isLoading, count: filteredConversations.length });
  const isMedia = Boolean(msg?.mediaUrl || msg?.payload?.mediaUrl);

  const toggleSelect = (id) => {
    setStatusMessage('');
    setSelectedIds(prev =>
      prev.includes(id) ? prev.filter(item => item !== id) : [...prev, id]
    );
  };

  const handleForward = async () => {
    if (selectedIds.length === 0 || isSubmitting) return;
    setIsSubmitting(true);
    setStatusMessage('');
    if (!operationIdRef.current) operationIdRef.current = newForwardOperationId();
    try {
      await onConfirmForward(selectedIds, { operationId: operationIdRef.current });
      // Complete: the next forward from this sheet is a new operation.
      operationIdRef.current = null;
      setSelectedIds([]);
      onClose();
    } catch (error) {
      // Deliberately stays open. The caller has already reported what went
      // wrong; closing here would drop the choice the person made and leave
      // them to rebuild it from memory.
      if (error instanceof ForwardPartialError) {
        // Those who already have it are deselected, so pressing Forward again
        // can only reach the ones who do not.
        const stillFailing = new Set(error.failedIds);
        setSelectedIds(prev => prev.filter(id => stillFailing.has(id)));
        setStatusMessage(
          error.sentCount > 0
            ? `Sent to ${error.sentCount}. ${error.failedIds.length} failed - select Forward to try again.`
            : `Could not send to ${error.failedIds.length === 1 ? 'that chat' : 'those chats'} - select Forward to try again.`,
        );
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return createPortal(
    <div className={styles.modalOverlay} data-scroll-lock-ignore onClick={onClose}>
      <div
        ref={dialogRef}
        className={styles.modalContent}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <div className={styles.dragHandleBar} aria-hidden="true" />
        <div className={styles.modalHeader}>
          <h3 id={titleId}>{isMedia ? 'Forward media' : 'Forward message'}</h3>
          <button type="button" className={styles.closeBtn} onClick={onClose} aria-label="Close">
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        <div className={styles.searchWrap}>
          <Search size={16} className={styles.searchIcon} aria-hidden="true" />
          <input
            type="text"
            className={styles.searchInput}
            placeholder="Search conversations..."
            aria-label="Search conversations"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>

        <div className={styles.convList} role="group" aria-label="Chats">
          {listState === 'loading' ? (
            <RowSkeleton
              count={5}
              lines={1}
              rowClassName={styles.convItem}
              label="Loading chats"
            />
          ) : listState === 'list' ? (
            filteredConversations.map((conv) => {
              const isSelected = selectedIds.includes(conv.id);
              return (
                <label
                  key={conv.id}
                  className={`${styles.convItem} ${isSelected ? styles.convItemSelected : ''}`}
                >
                  <input
                    type="checkbox"
                    className={styles.convInput}
                    checked={isSelected}
                    onChange={() => toggleSelect(conv.id)}
                  />
                  <Avatar src={conv.avatar} name={conv.name} size="40px" isGroup={conv.isGroup} />
                  <div className={styles.convInfo}>
                    <span className={styles.convName}>{conv.name}</span>
                  </div>
                  <div className={`${styles.checkbox} ${isSelected ? styles.checkboxChecked : ''}`} aria-hidden="true">
                    {isSelected && <Check size={14} strokeWidth={3} />}
                  </div>
                </label>
              );
            })
          ) : (
            /*
             * Three different states used to render as "No conversations
             * found", and for a long time the list was ALWAYS empty because
             * nothing passed the conversations prop in. Loading draws row
             * skeletons above, so this only ever renders once the list has
             * settled - which is what makes a genuinely empty list believable.
             */
            <div className={styles.emptyText}>
              {forwardEmptyMessage({ isLoading, searchQuery })}
            </div>
          )}
        </div>

        <p className={styles.status} role="status" aria-live="polite">{statusMessage}</p>

        <div className={styles.modalFooter}>
          <button
            type="button"
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
    </div>,
    document.body,
  );
}
