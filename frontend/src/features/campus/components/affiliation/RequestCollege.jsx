import { useEffect, useId, useState } from 'react';
import { createPortal } from 'react-dom';
import { campusAffiliationApi } from '@shared/api/apiClient';
import { useAuth } from '@shared/context/AuthContext';
import { useOverlayBack } from '@shared/hooks/useOverlayBack';
import { useScrollLock } from '@shared/hooks/useScrollLock';
import { isValidEmail } from '@shared/utils/emailValidation';
import { AlertCircle, Check, GraduationCap, Loader2, Plus, X } from '@shared/components/icons';
import styles from './CampusAffiliation.module.css';

/** The internal placeholder some accounts carry instead of a real address. */
const PLACEHOLDER_DOMAIN = '@meetifyy.user';

const GENERIC_ERROR = "Couldn't send your request. Please try again.";

/**
 * Error copy for POST /api/auth/request-college. Only a 400 (the server's own
 * validation sentence) and a 429 (rate limit: 5 per IP, 3 per address a day)
 * carry text written for a person; everything else is generic.
 */
export function requestCollegeErrorMessage(err) {
  if (err?.status === 429) {
    return "You've already sent a few requests today. We'll be in touch, or try again tomorrow.";
  }
  if (err?.status === 400) {
    let msg = err?.message;
    if (Array.isArray(msg)) msg = msg[0];
    if (typeof msg === 'string' && msg.trim() && !/^API error\b/.test(msg)) return msg;
  }
  return GENERIC_ERROR;
}

function accountName(user) {
  const name =
    user?.displayName ||
    user?.name ||
    [user?.firstName, user?.lastName].filter(Boolean).join(' ');
  return String(name || '').trim();
}

function accountEmail(user) {
  const email = String(user?.email || '').trim();
  return email && !email.endsWith(PLACEHOLDER_DOMAIN) ? email : '';
}

/**
 * The "Can't find your college?" box on the Campus picker. Rendered under the
 * list, and inside the empty and no-results states.
 */
export function RequestCollegeCard({ initialName = '', compact = false }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <div className={`${styles.requestCard} ${compact ? styles.requestCardCompact : ''}`}>
        <div className={styles.requestText}>
          <p className={styles.requestTitle}>Can&apos;t find your college?</p>
          <p className={styles.requestBody}>
            Request it and we&apos;ll add it. Everything else on Meetifyy works in the meantime.
          </p>
        </div>
        <button type="button" className={styles.secondaryBtn} onClick={() => setOpen(true)}>
          <Plus size={16} aria-hidden="true" />
          <span>Request it</span>
        </button>
      </div>
      {open ? <RequestCollegeDialog initialName={initialName} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

/**
 * The request form. Name and sign-in email come from the account and are not
 * editable (the server mails its answer there); they become fields only when
 * the account has none to offer. College email is required by the endpoint's
 * DTO, which also rejects unknown fields, so there is no city field.
 */
export function RequestCollegeDialog({ initialName = '', onClose }) {
  const { currentUser } = useAuth();
  const knownName = accountName(currentUser);
  const knownEmail = accountEmail(currentUser);

  const [name, setName] = useState(knownName);
  const [personalEmail, setPersonalEmail] = useState(knownEmail);
  const [collegeName, setCollegeName] = useState(initialName.trim());
  const [collegeEmail, setCollegeEmail] = useState('');
  const [fieldErrors, setFieldErrors] = useState({});
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const titleId = useId();

  const close = () => {
    if (!submitting) onClose();
  };

  useOverlayBack(true, close);
  useScrollLock(true);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const validate = () => {
    const next = {};
    const n = name.trim();
    if (n.length < 2 || n.length > 80) next.name = 'Enter your full name (2 to 80 characters).';
    const c = collegeName.trim();
    if (c.length < 3 || c.length > 120) next.collegeName = 'Enter the college name (3 to 120 characters).';
    if (!isValidEmail(collegeEmail) || collegeEmail.trim().length > 100) {
      next.collegeEmail = 'Enter the email address your college gave you.';
    }
    if (!isValidEmail(personalEmail) || personalEmail.trim().length > 100) {
      next.personalEmail = 'Enter an email we can reach you at.';
    }
    return next;
  };

  const submit = async (e) => {
    e.preventDefault();
    if (submitting) return;
    setError('');
    const next = validate();
    setFieldErrors(next);
    if (Object.keys(next).length) return;

    setSubmitting(true);
    try {
      await campusAffiliationApi.requestCollege({
        name: name.trim(),
        collegeName: collegeName.trim(),
        collegeEmail: collegeEmail.trim().toLowerCase(),
        personalEmail: personalEmail.trim().toLowerCase(),
      });
      setDone(true);
    } catch (err) {
      setError(requestCollegeErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  const fieldError = (key) =>
    fieldErrors[key] ? (
      <span className={styles.fieldError} id={`${titleId}-${key}-err`}>
        {fieldErrors[key]}
      </span>
    ) : null;

  return createPortal(
    <div className={styles.sheetBackdrop} onClick={close}>
      <div
        className={styles.sheet}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
      >
        <div className={styles.sheetGrip} aria-hidden="true" />
        <div className={styles.sheetHeader}>
          <span className={styles.sheetIcon} aria-hidden="true">
            <GraduationCap size={20} />
          </span>
          <div className={styles.sheetHeading}>
            <h2 id={titleId} className={styles.sheetTitle}>
              {done ? 'Request sent' : 'Request your college'}
            </h2>
            {done ? null : (
              <p className={styles.sheetSub}>
                Tell us where you study. We check the college&apos;s email domain, add it, and email you.
              </p>
            )}
          </div>
          <button
            type="button"
            className={styles.sheetClose}
            onClick={close}
            aria-label="Close"
            disabled={submitting}
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>

        {done ? (
          <div className={styles.sheetDone} role="status">
            <span className={styles.doneIcon} aria-hidden="true">
              <Check size={26} />
            </span>
            <p className={styles.doneText}>
              We&apos;ll let you know at <strong>{personalEmail.trim()}</strong> when{' '}
              {collegeName.trim() || 'your college'} is added.
            </p>
            <div className={styles.sheetFoot}>
              <button type="button" className={`${styles.primaryBtn} ${styles.sheetFull}`} onClick={onClose}>
                Done
              </button>
            </div>
          </div>
        ) : (
          <form className={styles.sheetForm} onSubmit={submit} noValidate>
            <div className={styles.sheetBody}>
              {knownName || knownEmail ? (
                <dl className={styles.account}>
                  {knownName ? (
                    <div className={styles.accountRow}>
                      <dt className={styles.accountLabel}>Name</dt>
                      <dd className={styles.accountValue}>{knownName}</dd>
                    </div>
                  ) : null}
                  {knownEmail ? (
                    <div className={styles.accountRow}>
                      <dt className={styles.accountLabel}>We&apos;ll reply to</dt>
                      <dd className={styles.accountValue}>{knownEmail}</dd>
                    </div>
                  ) : null}
                </dl>
              ) : null}

              {knownName ? null : (
                <label className={styles.field}>
                  <span className={styles.label}>Your name</span>
                  <input
                    className={styles.input}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    autoComplete="name"
                    maxLength={80}
                    aria-invalid={Boolean(fieldErrors.name)}
                    aria-describedby={fieldErrors.name ? `${titleId}-name-err` : undefined}
                  />
                  {fieldError('name')}
                </label>
              )}

              {knownEmail ? null : (
                <label className={styles.field}>
                  <span className={styles.label}>Your email</span>
                  <input
                    className={styles.input}
                    type="email"
                    inputMode="email"
                    value={personalEmail}
                    onChange={(e) => setPersonalEmail(e.target.value)}
                    autoComplete="email"
                    maxLength={100}
                    aria-invalid={Boolean(fieldErrors.personalEmail)}
                    aria-describedby={fieldErrors.personalEmail ? `${titleId}-personalEmail-err` : undefined}
                  />
                  {fieldError('personalEmail')}
                </label>
              )}

              <label className={styles.field}>
                <span className={styles.label}>College name</span>
                <input
                  className={styles.input}
                  value={collegeName}
                  onChange={(e) => setCollegeName(e.target.value)}
                  placeholder="e.g. Delhi University"
                  autoComplete="organization"
                  maxLength={120}
                  aria-invalid={Boolean(fieldErrors.collegeName)}
                  aria-describedby={fieldErrors.collegeName ? `${titleId}-collegeName-err` : undefined}
                />
                {fieldError('collegeName')}
              </label>

              <label className={styles.field}>
                <span className={styles.label}>Your college email</span>
                <input
                  className={styles.input}
                  type="email"
                  inputMode="email"
                  value={collegeEmail}
                  onChange={(e) => setCollegeEmail(e.target.value)}
                  placeholder="you@college.ac.in"
                  autoComplete="off"
                  autoCapitalize="none"
                  spellCheck={false}
                  maxLength={100}
                  aria-invalid={Boolean(fieldErrors.collegeEmail)}
                  aria-describedby={`${titleId}-collegeEmail-hint${fieldErrors.collegeEmail ? ` ${titleId}-collegeEmail-err` : ''}`}
                />
                <span className={styles.hint} id={`${titleId}-collegeEmail-hint`}>
                  Used to find your college&apos;s email domain. It does not verify you or change your account.
                </span>
                {fieldError('collegeEmail')}
              </label>

              {error ? (
                <p className={styles.sheetError} role="alert">
                  <AlertCircle size={16} aria-hidden="true" />
                  <span>{error}</span>
                </p>
              ) : null}
            </div>

            <div className={styles.sheetFoot}>
              <button type="button" className={styles.secondaryBtn} onClick={close} disabled={submitting}>
                Cancel
              </button>
              <button type="submit" className={styles.primaryBtn} disabled={submitting} aria-busy={submitting || undefined}>
                {submitting ? (
                  <>
                    <Loader2 size={16} className="animate-spin" aria-hidden="true" />
                    <span>Sending…</span>
                  </>
                ) : (
                  <span>Send request</span>
                )}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>,
    document.body,
  );
}

export default RequestCollegeCard;
