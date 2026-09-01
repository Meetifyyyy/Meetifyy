import { useCallback, useEffect, useState } from 'react';
import PropTypes from 'prop-types';
import { useAuth } from '../../context/AuthContext';
import { apiClient } from '@shared/api/apiClient';
import { Trash2, Undo2, LogOut, Loader2, X } from '@shared/components/icons';
import OtpDialog from '@shared/components/OtpDialog';
import { isDeletionCountdownActive } from '@shared/lib/deletionHandoff';
import styles from './AccountDeletionGate.module.css';

/**
 * Full-screen notice shown to an account inside its 30-day deletion window.
 *
 * Deliberately built the same way as `SuspensionGate`, for the same reason: the
 * account keeps a working session on purpose — the owner needs one to change
 * their mind — so this screen is what they get instead of the app. It is
 * presentation only. `JwtGuard` refuses every route not marked
 * `@AllowPendingDeletion()`, so unmounting this component, opening a second
 * tab, or editing local state gains nobody anything.
 *
 * The deadline is read from the server (`scheduledPurgeAt`), never computed
 * from the browser. A device with a skewed clock renders a wrong countdown but
 * cannot move the actual deletion, and the countdown below is explicitly
 * labelled as approximate for exactly that reason.
 */
export default function AccountDeletionGate({ children }) {
  const { currentUser, logout, updateCurrentUser } = useAuth();
  const [status, setStatus] = useState(null);
  const [checked, setChecked] = useState(false);
  const [recovering, setRecovering] = useState(false);
  const [error, setError] = useState(null);
  // Set once a recovery code has been emailed. The deletion stays scheduled
  // for as long as this is open — starting recovery is not recovering.
  const [recoveryChallenge, setRecoveryChallenge] = useState(null);
  const [recovered, setRecovered] = useState(false);

  // The cached profile is only the trigger for asking; the server's answer
  // decides. Recovering therefore clears the screen without a sign-out, and a
  // stale cached status cannot strand an active user behind it.
  // Also set by `apiClient` when a request comes back 403
  // ACCOUNT_PENDING_DELETION — that is how a tab left open elsewhere learns the
  // account entered its window without waiting for a reload.
  const [serverSaysPending, setServerSaysPending] = useState(false);

  useEffect(() => {
    const onCorrection = (e) => {
      if (e?.detail?.status === 'PENDING_DELETION') setServerSaysPending(true);
    };
    window.addEventListener('meetifyy:account-status', onCorrection);
    return () =>
      window.removeEventListener('meetifyy:account-status', onCorrection);
  }, []);

  // The tab that just scheduled the deletion is already showing a better,
  // more specific screen — the confirmation and its sign-out countdown. Without
  // this the gate would replace it within a second (any background request
  // comes back 403 and corrects the cached status), so the user would confirm
  // their deletion and watch the confirmation vanish, replaced by a screen
  // offering to undo it. The marker is per-tab and expires on its own; it gates
  // no access, and the server refuses every request either way.
  const [countdownActive, setCountdownActive] = useState(() =>
    isDeletionCountdownActive()
  );

  useEffect(() => {
    if (!countdownActive) return undefined;
    // Re-checked rather than trusted for the life of the mount, so the gate
    // takes over on its own if the countdown is abandoned.
    const id = setInterval(() => {
      if (!isDeletionCountdownActive()) setCountdownActive(false);
    }, 1000);
    return () => clearInterval(id);
  }, [countdownActive]);

  const looksPending =
    !countdownActive &&
    (currentUser?.accountStatus === 'PENDING_DELETION' || serverSaysPending);

  const refreshStatus = useCallback(async () => {
    try {
      const res = await apiClient.get('/api/account/deletion-status');
      setStatus(res);
    } catch {
      // A failed check must not trap an account that is actually fine.
      setStatus(null);
    } finally {
      setChecked(true);
    }
  }, []);

  useEffect(() => {
    if (!looksPending) {
      setChecked(true);
      setStatus(null);
      return;
    }
    refreshStatus();
  }, [looksPending, refreshStatus]);

  /**
   * Starts recovery by asking for a code. Deliberately does NOT cancel the
   * deletion — that only happens once the code comes back verified, so a
   * session left open on someone else's machine cannot quietly reverse a
   * deletion its owner chose.
   */
  const handleStartRecovery = async () => {
    if (recovering) return;
    setRecovering(true);
    setError(null);
    try {
      const challenge = await apiClient.post('/api/account/recover/request-otp');
      setRecoveryChallenge(challenge);
    } catch (err) {
      setError(
        err?.message ||
          'We could not start account recovery. Please try again in a moment.'
      );
      // The server may have just told us the window closed — re-read rather
      // than leaving a Recover button that can no longer work.
      refreshStatus();
    } finally {
      setRecovering(false);
    }
  };

  /** Runs after the code verifies and the server has cancelled the deletion. */
  const finishRecovery = async () => {
    setRecoveryChallenge(null);
    // The cached profile is what mounts this gate, so it has to be corrected
    // too — otherwise the screen keeps rendering over an account the server
    // now considers active, until the next full sync.
    setServerSaysPending(false);
    if (currentUser) {
      updateCurrentUser({ ...currentUser, accountStatus: 'ACTIVE' });
    }
    setRecovered(true);
    await refreshStatus();
  };

  const formattedDeletionDate = status?.scheduledPurgeAt
    ? new Date(status.scheduledPurgeAt).toLocaleDateString(undefined, {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      })
    : null;

  if (!looksPending || !checked) {
    return (
      <>
        {children}
        {recovered && (
          <RecoverySuccessToast onDone={() => setRecovered(false)} />
        )}
      </>
    );
  }
  // Server says the account is fine — the cached profile was stale, or the
  // recovery that just completed has taken effect.
  if (!status?.pendingDeletion) {
    return (
      <>
        {children}
        {recovered && (
          <RecoverySuccessToast onDone={() => setRecovered(false)} />
        )}
      </>
    );
  }

  return (
    <div className={styles.wrapper} role="alert" aria-live="assertive">
      <div className={styles.card}>
        <div className={styles.iconBadge} aria-hidden="true">
          <Trash2 size={26} />
        </div>

        <h1 className={styles.title}>Your account is scheduled for deletion</h1>

        <p className={styles.body}>
          {formattedDeletionDate ? (
            <>
              Your account will be permanently deleted after{' '}
              <strong className={styles.inlineDate}>{formattedDeletionDate}</strong>.
              You can recover your account at any time before then.
            </>
          ) : (
            <>
              Your account is scheduled to be permanently deleted. You can
              recover your account at any time before the scheduled date.
            </>
          )}
        </p>

        {error && (
          <div className={styles.error} role="alert">
            {error}
          </div>
        )}

        <div className={styles.actions}>
          {status.recoverable ? (
            <button
              type="button"
              className={styles.primaryBtn}
              onClick={handleStartRecovery}
              disabled={recovering}
            >
              {recovering ? (
                <>
                  <Loader2 size={17} className="spin" />
                  <span>Sending a code…</span>
                </>
              ) : (
                <>
                  <Undo2 size={17} />
                  <span>Recover my account</span>
                </>
              )}
            </button>
          ) : (
            // Once the purge worker has claimed the row there is nothing left
            // to restore, so the button goes away rather than failing when
            // pressed.
            <p className={styles.closedNotice}>
              The recovery window for this account has closed and permanent
              deletion is already under way.
            </p>
          )}

          <button
            type="button"
            className={styles.secondaryBtn}
            onClick={logout}
            disabled={recovering}
          >
            <LogOut size={17} />
            <span>Sign out</span>
          </button>
        </div>
      </div>

      {/* Step 2 of recovery. The deletion stays scheduled the whole time this
          is open — cancelling happens only when the code verifies. */}
      {recoveryChallenge && (
        <OtpDialog
          title="Recover your account"
          description="Confirm it's you and we'll cancel the scheduled deletion."
          maskedEmail={recoveryChallenge.maskedEmail}
          submitLabel="Recover my account"
          challenge={recoveryChallenge}
          onClose={() => setRecoveryChallenge(null)}
          onResend={async () => {
            const next = await apiClient.post(
              '/api/account/recover/request-otp'
            );
            setRecoveryChallenge(next);
          }}
          onSubmit={async (otp) => {
            // Throws on a bad code; the dialog surfaces the server's message
            // and the deletion remains scheduled, which is the safe default.
            await apiClient.post('/api/account/recover/confirm', { otp });
            await finishRecovery();
          }}
        />
      )}
    </div>
  );
}

AccountDeletionGate.propTypes = {
  children: PropTypes.node,
};

/**
 * Confirms a completed recovery.
 *
 * Rendered by the gate rather than by a toast call at the recovery site,
 * because the successful path unmounts the gate's own screen the instant the
 * server reports ACTIVE — a message raised from inside that screen would be
 * torn down before anyone read it. This outlives the transition and dismisses
 * itself.
 */
function RecoverySuccessToast({ onDone }) {
  useEffect(() => {
    const id = setTimeout(onDone, 6000);
    return () => clearTimeout(id);
  }, [onDone]);

  return (
    <div className={styles.successToast} role="status" aria-live="polite">
      <div className={styles.successIcon} aria-hidden="true">
        <Undo2 size={18} />
      </div>
      <div>
        <p className={styles.successTitle}>Account recovered successfully</p>
        <p className={styles.successBody}>
          The scheduled deletion has been cancelled and your account is active
          again.
        </p>
      </div>
      <button
        type="button"
        className={styles.successClose}
        onClick={onDone}
        aria-label="Dismiss"
      >
        <X size={16} />
      </button>
    </div>
  );
}

RecoverySuccessToast.propTypes = {
  onDone: PropTypes.func.isRequired,
};
