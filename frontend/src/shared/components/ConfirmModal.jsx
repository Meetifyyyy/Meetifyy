import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import styles from './ConfirmModal.module.css';

export default function ConfirmModal({ title, desc, visible, onCancel, onConfirm, confirmText = 'Confirm' }) {
  const overlayRef = useRef(null);

  useEffect(() => {
    if (visible && overlayRef.current) {
      requestAnimationFrame(() => overlayRef.current?.classList.add(styles.open));
    }
  }, [visible]);

  if (!visible) return null;

  const handleClose = () => {
    overlayRef.current?.classList.remove(styles.open);
    setTimeout(onCancel, 250);
  };

  const handleConfirm = () => {
    overlayRef.current?.classList.remove(styles.open);
    setTimeout(onConfirm, 250);
  };

  return createPortal(
    <div className={styles.confirmOverlay} ref={overlayRef} onClick={(e) => { if (e.target === overlayRef.current) handleClose(); }}>
      <div className={styles.confirmModal}>
        <div className={styles.confirmIcon}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
            <line x1="12" y1="9" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
        </div>
        <div className={styles.confirmTitle}>{title}</div>
        <div className={styles.confirmDesc}>{desc}</div>
        <div className={styles.confirmActions}>
          <button className={`${styles.confirmBtn} ${styles.confirmBtnCancel}`} onClick={handleClose}>Cancel</button>
          <button className={`${styles.confirmBtn} ${styles.confirmBtnLeave}`} onClick={handleConfirm}>{confirmText}</button>
        </div>
      </div>
    </div>,
    document.body
  );
}
