import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, Info } from '@shared/components/icons';
import { useOverlayBack } from '@shared/hooks/useOverlayBack';
import { useScrollLock } from '@shared/hooks/useScrollLock';
import styles from './ConfirmModal.module.css';

export default function ConfirmModal({
  title,
  desc,
  description,
  visible = true,
  onCancel,
  onConfirm,
  cancelText = 'Cancel',
  cancelLabel,
  confirmText = 'Confirm',
  confirmLabel,
  isDestructive = false,
  icon = null,
}) {
  const overlayRef = useRef(null);
  const actualDesc = desc || description;
  const actualConfirmText = confirmLabel || confirmText;
  const actualCancelText = cancelLabel || cancelText;

  useOverlayBack(visible, onCancel);
  // Background stays put while this dialog is open. Counted, so a
  // dialog opened on top of another cannot unlock the page when it closes.
  useScrollLock(visible);

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
        <div className={`${styles.confirmIcon} ${isDestructive ? styles.confirmIconDestructive : styles.confirmIconPrimary}`}>
          {icon || (isDestructive ? (
            <AlertTriangle size={24} strokeWidth={2} />
          ) : (
            <Info size={24} strokeWidth={2} />
          ))}
        </div>
        <div className={styles.confirmTitle}>{title}</div>
        {actualDesc && <div className={styles.confirmDesc}>{actualDesc}</div>}
        <div className={styles.confirmActions}>
          <button className={`${styles.confirmBtn} ${styles.confirmBtnCancel}`} onClick={handleClose}>{actualCancelText}</button>
          <button className={`${styles.confirmBtn} ${isDestructive ? styles.confirmBtnLeave : styles.confirmBtnPrimary}`} onClick={handleConfirm}>{actualConfirmText}</button>
        </div>
      </div>
    </div>,
    document.body
  );
}
