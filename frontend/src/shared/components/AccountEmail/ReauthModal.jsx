import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertCircle, Loader2, ShieldCheck } from '@shared/components/icons';
import OtpCodeInput, { useResendCountdown } from '@shared/components/OtpCodeInput';
import { reauthApi } from '@shared/api/apiClient';
import { describeReauthError } from '@shared/lib/campusAccess';
import { useOverlayBack } from '@shared/hooks/useOverlayBack';
import { useScrollLock } from '@shared/hooks/useScrollLock';
import modal from '@shared/components/modals/ConfirmModal.module.css';
import styles from './AccountEmail.module.css';

/** The error a caller of `ensure()` receives when the person closes the dialog. */
export const REAUTH_CANCELLED = 'reauth_cancelled';

/**
 * The account's methods, once per page load: they change only if the person
 * adds or removes a password identity, and the server decides regardless. If
 * the cache is wrong (another account signed in on this tab), the server's
 * `password_not_set` / `use_password` answer corrects it on the spot.
 */
let methodsCache = null;

/** Forgets the cached methods (tests). */
export function resetReauthMethodsCache() {
  methodsCache = null;
}

/** Re-asks a little before the server's expiry, so a grant never dies mid-request. */
const FRESHNESS_MARGIN_MS = 30 * 1000;

/**
 * "Confirm it's you" before an email change or removal.
 *
 * Asks for the password, or — for an account that has none (OAuth,
 * passwordless) — sends a code to the current sign-in address. Nothing is
 * compared here: the server checks it and answers with a single-use grant
 * (`{ reauthToken, expiresAt }`) for `purpose`, which `onSuccess` receives.
 * The password lives in component state only while the dialog is open.
 */
export default function ReauthModal({ visible, purpose, title = "Confirm it's you", description, onSuccess, onCancel }) {
  const overlayRef = useRef(null);
  const live = useRef(true);
  const [methods, setMethods] = useState(null);
  const [password, setPassword] = useState('');
  const [challenge, setChallenge] = useState(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const cooldown = useResendCountdown(challenge?.resendAvailableAt);

  // A centred dialog on every screen size, not a bottom sheet: it holds a
  // password field, and a sheet that could be dragged away (or slid under the
  // keyboard) mid-check is the wrong shape for that. While a check is running
  // nothing dismisses it — not Back (which stays on this dialog), not the
  // backdrop — so a response cannot land on a screen that has moved on.
  const busyRef = useRef(false);
  busyRef.current = busy;
  useOverlayBack(visible, onCancel, { onBack: () => busyRef.current });
  useScrollLock(visible);

  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);

  // Fresh state every time it opens; the method list is one small request.
  useEffect(() => {
    if (!visible) return;
    setPassword('');
    setCode('');
    setChallenge(null);
    setError(null);
    setBusy(false);
    setMethods(methodsCache);
    requestAnimationFrame(() => overlayRef.current?.classList.add(modal.open));
    if (methodsCache) return;
    reauthApi
      .methods()
      .then((res) => {
        methodsCache = Array.isArray(res?.methods) ? res.methods : ['password'];
        if (live.current) setMethods(methodsCache);
      })
      // The password form is the safe default (not cached): the server still decides.
      .catch(() => live.current && setMethods(['password']));
  }, [visible, purpose]);

  const finish = useCallback(
    (grant) => {
      setPassword('');
      onSuccess?.(grant);
    },
    [onSuccess],
  );

  const submitPassword = async () => {
    if (busy || !password) return;
    setBusy(true);
    setError(null);
    try {
      const grant = await reauthApi.withPassword({ purpose, password });
      if (live.current) finish(grant);
    } catch (err) {
      if (!live.current) return;
      setError(describeReauthError(err));
      if (err?.code === 'password_not_set') {
        methodsCache = ['email_code'];
        setMethods(methodsCache);
      }
    } finally {
      if (live.current) setBusy(false);
    }
  };

  const sendCode = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await reauthApi.sendCode({ purpose });
      if (!live.current) return;
      setChallenge({ emailMasked: res?.emailMasked || '', resendAvailableAt: res?.resendAvailableAt || null });
      setCode('');
    } catch (err) {
      if (!live.current) return;
      if (err?.code === 'use_password') {
        methodsCache = ['password'];
        setMethods(methodsCache);
        return;
      }
      setError(describeReauthError(err));
    } finally {
      if (live.current) setBusy(false);
    }
  };

  const submitCode = async (value) => {
    if (busy || !/^\d{6}$/.test(value)) return;
    setBusy(true);
    setError(null);
    try {
      const grant = await reauthApi.withCode({ purpose, code: value });
      if (live.current) finish(grant);
    } catch (err) {
      if (!live.current) return;
      setError(describeReauthError(err));
      setCode('');
    } finally {
      if (live.current) setBusy(false);
    }
  };

  if (!visible) return null;

  const method = methods?.[0] ?? null;
  const errorRow = (
    <div className={styles.error} role="alert" aria-live="polite">
      {error ? (
        <>
          <AlertCircle size={14} aria-hidden="true" />
          <span>{error}</span>
        </>
      ) : null}
    </div>
  );

  let body;
  if (!methods) {
    body = (
      <div className={styles.reauthLoading} aria-busy="true">
        <Loader2 size={20} className="spin" aria-label="Loading" />
      </div>
    );
  } else if (method === 'password') {
    body = (
      <form
        className={styles.form}
        onSubmit={(e) => {
          e.preventDefault();
          submitPassword();
        }}
        noValidate
      >
        <div className={styles.field}>
          <label className={styles.label} htmlFor="reauth-password">
            Password
          </label>
          <input
            id="reauth-password"
            className={styles.input}
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              if (error) setError(null);
            }}
            disabled={busy}
            autoFocus
          />
        </div>
        {errorRow}
        <div className={`${styles.actions} ${styles.actionsEnd}`}>
          <button type="button" className={styles.secondaryBtn} onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className={styles.primaryBtn} disabled={busy || !password}>
            {busy ? (
              <>
                <Loader2 size={16} className="spin" aria-hidden="true" />
                <span>Checking…</span>
              </>
            ) : (
              <span>Continue</span>
            )}
          </button>
        </div>
      </form>
    );
  } else if (method === 'email_code') {
    body = challenge ? (
      <form
        className={styles.form}
        onSubmit={(e) => {
          e.preventDefault();
          submitCode(code);
        }}
        noValidate
      >
        <p className={styles.text}>
          We sent a 6-digit code to <strong>{challenge.emailMasked || 'your email'}</strong>.
        </p>
        <OtpCodeInput
          value={code}
          onChange={(v) => {
            setCode(v);
            if (error) setError(null);
          }}
          onComplete={submitCode}
          disabled={busy}
          invalid={Boolean(error)}
          autoFocus
          idPrefix="reauth-otp"
        />
        {errorRow}
        <div className={styles.meta}>
          {cooldown > 0 ? (
            <span>Resend in {cooldown}s</span>
          ) : (
            <button type="button" className={styles.linkBtn} onClick={sendCode} disabled={busy}>
              Send a new code
            </button>
          )}
        </div>
        <div className={`${styles.actions} ${styles.actionsEnd}`}>
          <button type="button" className={styles.secondaryBtn} onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className={styles.primaryBtn} disabled={busy || code.length !== 6}>
            {busy ? <Loader2 size={16} className="spin" aria-hidden="true" /> : null}
            <span>Confirm</span>
          </button>
        </div>
      </form>
    ) : (
      <div className={styles.form}>
        <p className={styles.text}>We&apos;ll email a code to the address you sign in with.</p>
        {errorRow}
        <div className={`${styles.actions} ${styles.actionsEnd}`}>
          <button type="button" className={styles.secondaryBtn} onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button type="button" className={styles.primaryBtn} onClick={sendCode} disabled={busy}>
            {busy ? <Loader2 size={16} className="spin" aria-hidden="true" /> : null}
            <span>Send code</span>
          </button>
        </div>
      </div>
    );
  } else {
    body = (
      <div className={styles.form}>
        <p className={styles.text}>
          We can&apos;t confirm it&apos;s you from here. Contact support to make this change.
        </p>
        <div className={`${styles.actions} ${styles.actionsEnd}`}>
          <button type="button" className={styles.secondaryBtn} onClick={onCancel}>
            Close
          </button>
        </div>
      </div>
    );
  }

  return createPortal(
    <div
      className={`${modal.confirmOverlay} ${modal.centered}`}
      ref={overlayRef}
      onClick={(e) => {
        if (e.target === overlayRef.current && !busy) onCancel?.();
      }}
    >
      <div
        className={`${modal.confirmModal} ${styles.reauthModal}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="reauth-title"
        aria-describedby="reauth-desc"
      >
        <div className={`${modal.confirmIcon} ${modal.confirmIconPrimary}`}>
          <ShieldCheck size={24} strokeWidth={2} />
        </div>
        <div id="reauth-title" className={modal.confirmTitle}>
          {title}
        </div>
        <div id="reauth-desc" className={modal.confirmDesc}>
          {description ||
            (method === 'email_code'
              ? 'For your security, confirm with a code sent to your sign-in email.'
              : 'For your security, enter your password to continue.')}
        </div>
        {body}
      </div>
    </div>,
    document.body,
  );
}

/**
 * A grant on demand. `ensure()` resolves with a live token, opening the dialog
 * only when there is none; it rejects with `code: 'reauth_cancelled'` if the
 * person closes it. `invalidate()` after the server answers
 * `reauth_required` or once the grant has been spent; `current()` is the live
 * token if one is held. Render `modal`.
 *
 * The token stays in a ref: in memory, for this mounted flow only.
 */
export function useReauth(purpose, copy = {}) {
  const grantRef = useRef(null);
  const pendingRef = useRef(null);
  const [open, setOpen] = useState(false);

  const ensure = useCallback(() => {
    const grant = grantRef.current;
    if (grant && new Date(grant.expiresAt).getTime() - Date.now() > FRESHNESS_MARGIN_MS) {
      return Promise.resolve(grant.reauthToken);
    }
    if (pendingRef.current) return pendingRef.current.promise;
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => {
      resolve = res;
      reject = rej;
    });
    pendingRef.current = { promise, resolve, reject };
    setOpen(true);
    return promise;
  }, []);

  const invalidate = useCallback(() => {
    grantRef.current = null;
  }, []);

  /** The live token already held, or null. Never opens the dialog. */
  const current = useCallback(() => {
    const grant = grantRef.current;
    return grant && new Date(grant.expiresAt).getTime() - Date.now() > FRESHNESS_MARGIN_MS
      ? grant.reauthToken
      : null;
  }, []);

  const onSuccess = useCallback((grant) => {
    grantRef.current = grant;
    setOpen(false);
    pendingRef.current?.resolve(grant?.reauthToken);
    pendingRef.current = null;
  }, []);

  const onCancel = useCallback(() => {
    setOpen(false);
    const err = new Error('Cancelled');
    err.code = REAUTH_CANCELLED;
    pendingRef.current?.reject(err);
    pendingRef.current = null;
  }, []);

  const modalElement = (
    <ReauthModal
      visible={open}
      purpose={purpose}
      title={copy.title}
      description={copy.description}
      onSuccess={onSuccess}
      onCancel={onCancel}
    />
  );

  return { ensure, invalidate, current, modal: modalElement };
}
