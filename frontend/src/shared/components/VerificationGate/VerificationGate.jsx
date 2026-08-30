import React from 'react';
import { useAuth } from '../../context/AuthContext';
import { HugeiconsIcon } from '@hugeicons/react';
import { LockKeyholeIcon } from '@hugeicons/core-free-icons';
import { Info } from '@shared/components/icons';
import { Link, useLocation } from 'react-router-dom';
import { useSmartBack } from '@shared/hooks/useSmartBack';
import styles from './VerificationGate.module.css';

export default function VerificationGate({
  children,
  message = "Verify your account to unlock full access to Meetifyy. This helps us maintain a safe and trusted community.",
  fallback,
  fullPage = false,
  backTo,
  backLabel,
  onBack,
}) {
  const { currentUser } = useAuth();
  const location = useLocation();
  const goBack = useSmartBack();
  
  if (currentUser?.verificationStatus === 'VERIFIED') {
    return <>{children}</>;
  }

  if (fallback && !fullPage) {
    return <>{fallback}</>;
  }

  const isPending = currentUser?.verificationStatus === 'PENDING';

  // Context-aware defaults for back navigation
  const pathname = location.pathname || '';
  const resolvedBackTo = backTo || (
    pathname.startsWith('/crew') ? '/crew' :
    '/home'
  );

  const resolvedBackLabel = backLabel || (
    pathname.startsWith('/crew') ? 'Back to Crew' :
    'Back to Home'
  );

  const handleBackClick = () => {
    if (typeof onBack === 'function') {
      onBack();
    } else {
      goBack(resolvedBackTo);
    }
  };

  if (fullPage) {
    return (
      <div className={styles.lockedPageWrapper}>
        <div className={styles.lockedCard}>
          <div className={styles.iconCircle}>
            <HugeiconsIcon icon={LockKeyholeIcon} size={28} />
          </div>
          <h2 className={styles.lockedTitle}>
            Account Verification Required
          </h2>
          <p className={styles.lockedMessage}>
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

          <div className={styles.lockedActions}>
            <Link
              to="/settings/verification"
              className={styles.primaryActionBtn}
            >
              {isPending ? 'Check Verification Status' : 'Verify Account'}
            </Link>
            <button
              type="button"
              onClick={handleBackClick}
              className={styles.secondaryActionBtn}
            >
              {resolvedBackLabel}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Compact banner version for inline composer replacement
  return (
    <div className={styles.compactBanner}>
      <div className={styles.compactIconCircle}>
        <HugeiconsIcon icon={LockKeyholeIcon} size={20} />
      </div>
      <div className={styles.compactContent}>
        <h3 className={styles.compactTitle}>
          Verification Required
        </h3>
        <p className={styles.compactMessage}>
          {message}
        </p>
      </div>

      {isPending ? (
        <div className={styles.compactPendingBadge}>
          <Info size={16} />
          <span>Under review</span>
        </div>
      ) : (
        <Link
          to="/settings/verification"
          className={styles.compactVerifyBtn}
        >
          Verify Now
        </Link>
      )}
    </div>
  );
}
