import React from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { HugeiconsIcon } from '@hugeicons/react';
import { LockKeyholeIcon } from '@hugeicons/core-free-icons';
import { Info } from '@shared/components/icons';
import { useAuth } from '@shared/context/AuthContext';
import { useOverlayBack } from '@shared/hooks/useOverlayBack';
import { useScrollLock } from '@shared/hooks/useScrollLock';
import { useVerificationModalStore } from '@shared/stores/verificationModalStore';
import styles from './VerificationModal.module.css';

export default function VerificationModal() {
  const { isOpen, message, closeVerificationModal } = useVerificationModalStore();
  const { currentUser } = useAuth();
  const navigate = useNavigate();

  useOverlayBack(isOpen, closeVerificationModal);
  useScrollLock(isOpen);

  if (!isOpen) return null;

  const isPending = currentUser?.verificationStatus === 'PENDING';

  const handleVerifyClick = () => {
    closeVerificationModal();
    navigate('/settings/verification');
  };

  return createPortal(
    <div className={styles.overlay} onClick={closeVerificationModal}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          onClick={closeVerificationModal}
          className={styles.closeButton}
          aria-label="Close modal"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>

        <div className={styles.iconCircle}>
          <HugeiconsIcon icon={LockKeyholeIcon} size={28} />
        </div>

        <h2 className={styles.title}>
          Account Verification Required
        </h2>

        <p className={styles.message}>
          Verify your account to unlock full access to Meetifyy. This helps us maintain a safe and trusted community.
        </p>

        {isPending && (
          <div className={styles.pendingBanner}>
            <Info size={20} className={styles.pendingIcon} />
            <div>
              <div className={styles.pendingHeading}>Verification Under Review</div>
              <div className={styles.pendingDesc}>
                Your student ID is currently being reviewed by our campus moderators.
              </div>
            </div>
          </div>
        )}

        <div className={styles.actions}>
          <button
            type="button"
            onClick={handleVerifyClick}
            className={styles.primaryBtn}
          >
            {isPending ? 'Check Verification Status' : 'Verify Account'}
          </button>
          <button
            type="button"
            onClick={closeVerificationModal}
            className={styles.secondaryBtn}
          >
            Maybe Later
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
