import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertCircle, Loader2, Trash2 } from '@shared/components/icons';
import { useOverlayBack } from '@shared/hooks/useOverlayBack';
import { useScrollLock } from '@shared/hooks/useScrollLock';
import modal from '@shared/components/modals/ConfirmModal.module.css';
import styles from './ClearChatModal.module.css';

/**
 * "Clear chat", asked first.
 *
 * It used to clear the moment the menu item was tapped, with nothing to say
 * what would go or for whom. Clearing is per person: the server records a
 * cut-off for this viewer only, and every other participant keeps the whole
 * conversation, so the dialog says exactly that.
 *
 * The chat changes only once the server has cleared it (useMessageActions).
 * While the request is out both buttons are disabled and nothing dismisses
 * the dialog, so it cannot be sent twice; a failure keeps the dialog open
 * with the reason and the same button to try again.
 */
export default function ClearChatModal({ conversation, onConfirm, onClose }) {
  const overlayRef = useRef(null);
  const cancelRef = useRef(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);
  const pendingRef = useRef(false);
  const live = useRef(true);

  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);

  const close = useCallback(() => {
    if (pendingRef.current) return;
    onClose?.();
  }, [onClose]);

  useOverlayBack(true, close, { onBack: () => pendingRef.current });
  useScrollLock(true);

  useEffect(() => {
    requestAnimationFrame(() => {
      overlayRef.current?.classList.add(modal.open);
      cancelRef.current?.focus();
    });
  }, []);

  const isGroup = Boolean(conversation?.isGroup || conversation?.type === 'GROUP');
  const otherName = conversation?.targetUser?.displayName || conversation?.name || 'The other person';

  const confirm = async () => {
    if (pendingRef.current) return;
    pendingRef.current = true;
    setPending(true);
    setError(null);
    try {
      await onConfirm?.();
      if (live.current) onClose?.();
    } catch (err) {
      if (!live.current) return;
      const offline = err instanceof Error && typeof err.status !== 'number';
      setError(
        offline
          ? "Couldn't clear the chat. Check your connection and try again."
          : "Couldn't clear the chat. Try again.",
      );
    } finally {
      pendingRef.current = false;
      if (live.current) setPending(false);
    }
  };

  return createPortal(
    <div
      className={`${modal.confirmOverlay} ${modal.centered}`}
      ref={overlayRef}
      onClick={(e) => {
        if (e.target === overlayRef.current) close();
      }}
    >
      <div
        className={modal.confirmModal}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="clear-chat-title"
        aria-describedby="clear-chat-desc"
        aria-busy={pending}
        onKeyDown={(e) => {
          if (e.key === 'Escape') close();
        }}
      >
        <div className={`${modal.confirmIcon} ${modal.confirmIconDestructive}`}>
          <Trash2 size={24} strokeWidth={2} aria-hidden="true" />
        </div>
        <div id="clear-chat-title" className={modal.confirmTitle}>
          Clear this chat?
        </div>
        <div id="clear-chat-desc" className={modal.confirmDesc}>
          The messages, photos and videos in this chat will be removed for you only.{' '}
          {isGroup ? 'Other members will still see them.' : `${otherName} will still see them.`}{' '}
          New messages will still appear here.
        </div>
        {error && (
          <div className={styles.error} role="alert">
            <AlertCircle size={14} aria-hidden="true" />
            <span>{error}</span>
          </div>
        )}
        <div className={modal.confirmActions}>
          <button
            ref={cancelRef}
            type="button"
            className={`${modal.confirmBtn} ${modal.confirmBtnCancel}`}
            onClick={close}
            disabled={pending}
          >
            Cancel
          </button>
          <button
            type="button"
            className={`${modal.confirmBtn} ${modal.confirmBtnLeave}`}
            onClick={confirm}
            disabled={pending}
          >
            {pending ? (
              <>
                <Loader2 size={16} className="spin" aria-hidden="true" />
                <span>Clearing…</span>
              </>
            ) : (
              'Clear chat'
            )}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/**
 * The confirmation, owned by a chat area: `request` is what its menus call
 * (in place of clearing at once), `dialog` is rendered alongside the chat.
 */
export function useClearChatConfirm(conversation, onClearChat) {
  const [open, setOpen] = useState(false);
  const request = useCallback(() => setOpen(true), []);
  const convId = conversation?.id;
  const dialog = open && onClearChat ? (
    <ClearChatModal
      conversation={conversation}
      onConfirm={() => onClearChat(convId)}
      onClose={() => setOpen(false)}
    />
  ) : null;
  return { request: onClearChat ? request : undefined, dialog };
}
