import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import styles from './ActivityJoinedModal.module.css';

export default function ActivityJoinedModal({ activity, isOpen, onClose }) {
  const overlayRef = useRef(null);
  const navigate = useNavigate();

  useEffect(() => {
    if (isOpen && overlayRef.current) {
      requestAnimationFrame(() => overlayRef.current?.classList.add(styles.open));
    }
  }, [isOpen]);

  if (!isOpen || !activity) return null;

  const handleClose = () => {
    overlayRef.current?.classList.remove(styles.open);
    setTimeout(onClose, 200);
  };

  const handleOpenGroup = () => {
    overlayRef.current?.classList.remove(styles.open);
    setTimeout(() => {
      onClose();
      const chatId = String(activity.id).startsWith('act_') ? activity.id : `act_${activity.id}`;
      navigate(`/messages/${chatId}`);
    }, 150);
  };

  return createPortal(
    <div 
      className={styles.overlay} 
      ref={overlayRef} 
      onClick={(e) => { if (e.target === overlayRef.current) handleClose(); }}
    >
      <div className={styles.modal}>
        <div className={styles.iconWrapper}>
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>
          </svg>
        </div>

        <h3 className={styles.title}>Activity Joined!</h3>
        <p className={styles.subtitle}>
          You're all set! You have successfully joined the activity.
        </p>

        <div className={styles.actions}>
          {activity.createEventGroup ? (
            <>
              <button className={styles.btnOkay} onClick={handleClose}>
                Okay
              </button>
              <button className={styles.btnOpen} onClick={handleOpenGroup}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>
                </svg>
                Open Group
              </button>
            </>
          ) : (
            <button className={`${styles.btnOkay} ${styles.primaryBtn}`} onClick={handleClose}>
              Okay
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
