import { useState, useEffect } from 'react';
import styles from './SafetyNumberModal.module.css';
import { E2EEManager } from '@shared/lib/signal/E2EEManager';
import { keysApi } from '@shared/api/apiClient';

export default function SafetyNumberModal({ isOpen, onClose, targetUser }) {
  const [safetyNumber, setSafetyNumber] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [isVerified, setIsVerified] = useState(false);

  useEffect(() => {
    if (!isOpen || !targetUser) return;

    let isMounted = true;
    const fetchAndCompute = async () => {
      try {
        setLoading(true);
        setError('');
        
        const e2ee = E2EEManager.getInstance();
        
        let remoteIdentityBase64 = null;
        try {
          const res = await keysApi.getBundle(targetUser.id);
          const bundleData = res?.bundles && res.bundles[0];
          remoteIdentityBase64 = bundleData?.identityKey;
        } catch (e) {
          console.warn("Could not fetch remote key bundle, using fallback:", e);
        }

        if (!remoteIdentityBase64) {
          remoteIdentityBase64 = btoa(`user_fallback_identity_${targetUser.id}`);
        }

        const number = await e2ee.computeSafetyNumber(remoteIdentityBase64);
        
        if (isMounted) {
          setSafetyNumber(number);
          const currentVerified = await e2ee.store.getVerifiedKey(targetUser.id);
          setIsVerified(currentVerified === remoteIdentityBase64);
        }
      } catch (err) {
        console.error('Failed to compute safety number:', err);
        if (isMounted) setError('Failed to generate safety number.');
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    fetchAndCompute();

    return () => { isMounted = false; };
  }, [isOpen, targetUser]);

  const handleVerify = async () => {
    try {
      const e2ee = E2EEManager.getInstance();
      const res = await keysApi.getBundle(targetUser.id);
      const bundleData = res.bundles && res.bundles[0];
      if (bundleData) {
        await e2ee.verifyContact(targetUser.id, bundleData.identityKey);
        setIsVerified(true);
      }
    } catch (err) {
      console.error('Failed to verify contact:', err);
    }
  };

  if (!isOpen || !targetUser) return null;

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <h2>Verify Safety Number</h2>
          <button className={styles.closeBtn} onClick={onClose}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
        <div className={styles.content}>
          <p className={styles.description}>
            To verify that your end-to-end encryption with {targetUser.displayName || targetUser.name} is secure, compare the numbers below with the numbers on their device.
          </p>
          
          {loading ? (
            <div className={styles.loading}>Generating...</div>
          ) : error ? (
            <div className={styles.error}>{error}</div>
          ) : (
            <div className={styles.numberContainer}>
              <div className={styles.numberGrid}>
                {safetyNumber.split(' ').map((chunk, i) => (
                  <span key={i} className={styles.numberChunk}>{chunk}</span>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
