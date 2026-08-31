import { useCallback, useEffect, useState } from 'react';
import PropTypes from 'prop-types';
import { useAuth } from '../../context/AuthContext';
import { apiClient } from '@shared/api/apiClient';
import { ShieldOff, X, Loader2, LogOut, MessageSquare } from '@shared/components/icons';
import styles from './SuspensionGate.module.css';

const MIN_APPEAL_LENGTH = 20;
const MAX_APPEAL_LENGTH = 4000;

/**
 * Full-screen notice shown to a suspended account.
 *
 * A suspension deliberately does not end the session: the person needs to sign
 * in, be told what happened, and be able to ask for a review. This screen is
 * what they get instead of the app.
 *
 * It is presentation only. The actual restriction is enforced by `JwtGuard` on
 * the server, which refuses every route not marked `@AllowSuspended()` — so
 * removing this component from the tree, or editing local state, gains a
 * suspended user nothing. The status is likewise read from the server rather
 * than inferred from the cached profile, so lifting a suspension clears the
 * screen on the next poll without a sign-out.
 */
export default function SuspensionGate({ children }) {
  const { currentUser, logout } = useAuth();
  const [status, setStatus] = useState(null);
  const [checked, setChecked] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);

  // The cached profile is the trigger for asking; the server's answer decides.
  const looksSuspended = currentUser?.accountStatus === 'SUSPENDED';

  const refreshStatus = useCallback(async () => {
    try {
      const res = await apiClient.get('/api/suspension/status');
      setStatus(res);
    } catch {
      // A failed check must not strand an active user behind this screen.
      setStatus(null);
    } finally {
      setChecked(true);
    }
  }, []);

  useEffect(() => {
    if (!looksSuspended) {
      setChecked(true);
      setStatus(null);
      return;
    }
    refreshStatus();
  }, [looksSuspended, refreshStatus]);

  if (!looksSuspended || !checked) return children;
  // Server says the account is fine — the cached profile was stale.
  if (!status?.suspended) return children;

  return (
    <>
      <div className={styles.wrapper} role="alert" aria-live="assertive">
        <div className={styles.card}>
          <div className={styles.iconBadge}>
            <ShieldOff size={26} />
          </div>

          <h1 className={styles.title}>Your account is suspended</h1>

          <p className={styles.body}>
            You can&apos;t use Meetifyy while this is in place. If you think this
            was a mistake, ask our team to review it — we&apos;ll reply to{' '}
            <span className={styles.email}>{status.email}</span>.
          </p>

          {status.latestAppeal && (
            <div className={styles.appealStatus}>
              <div className={styles.appealStatusRow}>
                <span>
                  Appeal <span className={styles.appealRef}>{status.latestAppeal.ticketNumber}</span>
                </span>
                <span>
                  {status.latestAppeal.status === 'RESOLVED' ||
                  status.latestAppeal.status === 'CLOSED'
                    ? 'Reviewed'
                    : 'With the review team'}
                </span>
              </div>
            </div>
          )}

          <div className={styles.actions}>
            <button
              type="button"
              className={styles.primaryBtn}
              onClick={() => setModalOpen(true)}
              disabled={Boolean(status.canAppealAt)}
              title={
                status.canAppealAt
                  ? 'You have already submitted an appeal recently.'
                  : undefined
              }
            >
              <MessageSquare size={17} />
              <span>Request support</span>
            </button>

            <button type="button" className={styles.secondaryBtn} onClick={logout}>
              <LogOut size={17} />
              <span>Sign out</span>
            </button>
          </div>
        </div>
      </div>

      {modalOpen && (
        <AppealModal
          onClose={() => setModalOpen(false)}
          onSubmitted={() => {
            setModalOpen(false);
            refreshStatus();
          }}
        />
      )}
    </>
  );
}

SuspensionGate.propTypes = {
  children: PropTypes.node,
};

/**
 * Appeal composer.
 *
 * The server owns every rule that matters — length, the one-open-appeal limit,
 * the cooldown — and its message is shown verbatim on rejection, so the two
 * never disagree about why a submission failed.
 */
function AppealModal({ onClose, onSubmitted }) {
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  // Escape closes, matching every other modal in the app.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape' && !submitting) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, submitting]);

  const trimmed = message.trim();
  const tooShort = trimmed.length < MIN_APPEAL_LENGTH;

  const handleSubmit = async () => {
    if (tooShort || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await apiClient.post('/api/suspension/appeal', { message: trimmed });
      onSubmitted();
    } catch (err) {
      setError(
        err?.message ||
          'We could not submit your appeal. Please try again in a moment.'
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className={styles.modalBackdrop}
      onClick={() => !submitting && onClose()}
      role="dialog"
      aria-modal="true"
      aria-label="Request a suspension review"
    >
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.modalHeader}>
          <h2 className={styles.modalTitle}>Request a review</h2>
          <button
            type="button"
            className={styles.closeBtn}
            onClick={onClose}
            disabled={submitting}
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        <p className={styles.modalHint}>
          Tell us what happened and why you think the suspension should be
          lifted. This opens a support ticket and we&apos;ll email you the
          outcome.
        </p>

        {error && <div className={styles.error}>{error}</div>}

        <textarea
          className={styles.textarea}
          value={message}
          onChange={(e) => setMessage(e.target.value.slice(0, MAX_APPEAL_LENGTH))}
          placeholder="Explain your side of it…"
          disabled={submitting}
          autoFocus
        />
        <p
          className={`${styles.counter} ${tooShort ? styles.counterShort : ''}`}
        >
          {tooShort
            ? `${MIN_APPEAL_LENGTH - trimmed.length} more characters needed`
            : `${trimmed.length} / ${MAX_APPEAL_LENGTH}`}
        </p>

        <div className={styles.modalActions}>
          <button
            type="button"
            className={styles.secondaryBtn}
            onClick={onClose}
            disabled={submitting}
          >
            Cancel
          </button>
          <button
            type="button"
            className={styles.primaryBtn}
            onClick={handleSubmit}
            disabled={tooShort || submitting}
          >
            {submitting ? (
              <>
                <Loader2 size={16} className="spin" />
                <span>Sending…</span>
              </>
            ) : (
              <span>Submit appeal</span>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

AppealModal.propTypes = {
  onClose: PropTypes.func.isRequired,
  onSubmitted: PropTypes.func.isRequired,
};
