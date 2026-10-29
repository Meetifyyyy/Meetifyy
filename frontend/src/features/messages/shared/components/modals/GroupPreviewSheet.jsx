import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useOverlayBack } from '@shared/hooks/useOverlayBack';
import { useScrollLock } from '@shared/hooks/useScrollLock';
import { useSheetDrag } from '@shared/hooks/useSheetDrag';
import GroupPreview from '../GroupPreview';
import frame from '@shared/components/modals/ConfirmModal.module.css';
import styles from './GroupPreviewSheet.module.css';

/**
 * The group preview in the app's dialog frame (ConfirmModal's): a bottom
 * sheet with a handle on phones, dragged down or backed out of to close, and
 * a centred dialog on larger screens. Opened by a chat's invite card ("View
 * group") and by an invite link.
 */
export default function GroupPreviewSheet({ groupId, code, messageId, snapshot, onClose }) {
  const overlayRef = useRef(null);
  const closingRef = useRef(false);

  const close = () => {
    if (closingRef.current) return;
    closingRef.current = true;
    overlayRef.current?.classList.remove(frame.open);
    setTimeout(onClose, 250);
  };

  useOverlayBack(true, close);
  useScrollLock(true);
  const sheetRef = useSheetDrag(close, { enabled: true });

  useEffect(() => {
    requestAnimationFrame(() => {
      overlayRef.current?.classList.add(frame.open);
      // Keyboard and screen-reader users start inside the dialog.
      sheetRef.current?.focus({ preventScroll: true });
    });
  }, [sheetRef]);

  // Escape closes it, as Back and the backdrop do.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  return createPortal(
    <div
      className={frame.confirmOverlay}
      ref={overlayRef}
      onClick={(e) => { if (e.target === overlayRef.current) close(); }}
    >
      <div
        ref={sheetRef}
        className={`${frame.confirmModal} ${styles.sheet}`}
        role="dialog"
        aria-modal="true"
        aria-label="Group invite"
        tabIndex={-1}
      >
        <div className="sheet-handle" data-sheet-handle aria-hidden="true" />
        <GroupPreview
          groupId={groupId}
          code={code}
          messageId={messageId}
          snapshot={snapshot}
          onClose={close}
        />
      </div>
    </div>,
    document.body,
  );
}
