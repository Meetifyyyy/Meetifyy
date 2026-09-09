import { useCallback, useEffect, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import { useAuth } from '../../context/AuthContext';
import { legalApi } from '@shared/api/apiClient';
import { hardenExternalLinks } from '@shared/utils/legalHtmlLinks';
import {
  AlertCircle,
  ArrowLeft,
  Check,
  FileText,
  Loader2,
  LogOut,
  ShieldCheck,
} from '@shared/components/icons';
import {
  LEGAL_CONSENT_EVENT,
  LEGAL_CONSENT_STORAGE_KEY,
  announceLegalConsentChange,
  readLegalPendingHint,
  writeLegalPendingHint,
} from '@shared/lib/legalConsent';
import styles from './LegalUpdateGate.module.css';

/**
 * Full-screen flow shown when Meetifyy has published a policy update whose
 * acceptance is mandatory.
 *
 * Built the same way as `SuspensionGate` and `AccountDeletionGate`, for the same
 * reason: the session stays valid on purpose — the user has to be able to read
 * the update and accept it — so this screen is what they get instead of the app.
 *
 * It is presentation only. `JwtGuard` refuses every route not marked
 * `@AllowPendingLegalAck()`, so unmounting this component, opening a second tab,
 * navigating with the back button or driving the API by hand gains nobody
 * anything. That is also why there is no dismiss, skip, or "remind me later"
 * control: there is nothing for one to do except mislead.
 *
 * ── One flow, however many documents ──────────────────────────────────────
 * The server returns every outstanding version in a single list, and the whole
 * list is accepted in a single request. Terms-only, Privacy-only and both-at-
 * once are therefore the same code path with a different number of cards — no
 * stacked modals, and no way to accept one and be asked about the next.
 */
export default function LegalUpdateGate({ children }) {
  const { isLoggedIn, logout } = useAuth();

  // `confirming` is the state a browser starts in when it already knows a
  // requirement was outstanding: it blocks straight away and fills in the
  // documents when the server answers. Without it there is a visible flash of
  // the app shell on every load while the check is in flight — the server
  // refuses every request behind it, but showing someone the product they are
  // not allowed to use and then snatching it away is not the intended
  // experience.
  const [state, setState] = useState(() =>
    readLegalPendingHint() ? 'confirming' : 'checking',
  ); // checking | confirming | clear | pending
  const [pending, setPending] = useState([]);
  const [agreed, setAgreed] = useState(false);
  const [reading, setReading] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const readerRef = useRef(null);
  const [error, setError] = useState(null);

  // Guards against a response from a check that was superseded (a sign-out, or
  // a second check triggered while the first was in flight) overwriting newer
  // state — which would put the gate back up after a successful acceptance.
  const checkSeq = useRef(0);

  const check = useCallback(async () => {
    if (!isLoggedIn) {
      setState('clear');
      return;
    }
    const seq = ++checkSeq.current;
    try {
      /**
       * Ask the cheap public question first: does ANY published document
       * require acceptance right now?
       *
       * That endpoint is public, identical for every visitor and served with a
       * 60-second `Cache-Control`, so in the normal case — nothing mandatory —
       * the browser answers it from its own cache and this gate costs no server
       * request at all. Only when something is actually mandatory do we spend
       * the authenticated, per-user call.
       *
       * It is a fast path, not an authority: it can only skip the per-user
       * check when NOTHING is required of anyone, in which case there is
       * nothing this user could be missing. The moment any document requires
       * acceptance we fall through to the real check, and the server refuses
       * protected requests regardless of what this decides.
       */
      const documents = await legalApi.listDocuments();
      if (seq !== checkSeq.current) return;
      if (
        Array.isArray(documents) &&
        !documents.some((d) => d.requiresAcknowledgement)
      ) {
        setPending([]);
        setState('clear');
        writeLegalPendingHint(false);
        return;
      }

      const res = await legalApi.getConsentState();
      if (seq !== checkSeq.current) return;
      if (res?.satisfied || !res?.pending?.length) {
        setPending([]);
        setState('clear');
        writeLegalPendingHint(false);
      } else {
        setPending(res.pending);
        setState('pending');
        writeLegalPendingHint(true);
      }
    } catch {
      if (seq !== checkSeq.current) return;
      // A failed check must not trap a user who is actually fine. The server
      // refuses the underlying requests either way, so failing open here costs
      // nothing: if a requirement really is outstanding, the next request comes
      // back gated and brings us straight back. The hint is left alone — this
      // told us nothing about whether the requirement is still outstanding.
      setState('clear');
    }
  }, [isLoggedIn]);

  useEffect(() => {
    check();
  }, [check]);

  // Two ways this tab learns the state changed elsewhere:
  //
  //   - `LEGAL_CONSENT_EVENT`, dispatched in this tab by `apiClient` when any
  //     request comes back gated. That is how a tab left open when a policy is
  //     published shows the flow, instead of a stream of 403 toasts.
  //   - the `storage` event, which is how OTHER tabs learn that this user
  //     accepted somewhere. Without it, a user with three tabs open would have
  //     to accept in each one.
  useEffect(() => {
    if (!isLoggedIn) return undefined;

    const onLocal = () => check();
    const onStorage = (e) => {
      if (e.key === LEGAL_CONSENT_STORAGE_KEY) check();
    };
    // Coming back to a backgrounded tab is the other moment the answer may
    // have changed without this tab making a request.
    const onVisible = () => {
      if (document.visibilityState === 'visible') check();
    };

    window.addEventListener(LEGAL_CONSENT_EVENT, onLocal);
    window.addEventListener('storage', onStorage);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener(LEGAL_CONSENT_EVENT, onLocal);
      window.removeEventListener('storage', onStorage);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [isLoggedIn, check]);

  // The reader renders stored HTML; off-site links in it must open in a new
  // tab with noopener, or they replace the modal the user has to complete.
  useEffect(() => {
    if (!reading) return;
    hardenExternalLinks(readerRef.current);
  }, [reading]);

  const confirming = isLoggedIn && state === 'confirming';
  const blocking =
    isLoggedIn && ((state === 'pending' && pending.length > 0) || confirming);

  // The page behind must not scroll while the gate is up, and on iOS a body
  // that keeps scrolling is how a "blocking" overlay ends up scrolled off.
  useEffect(() => {
    if (!blocking) return undefined;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [blocking]);

  const handleAccept = async () => {
    if (!agreed || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await legalApi.acknowledge(pending.map((d) => d.versionId));
      if (res?.satisfied) {
        setPending([]);
        setState('clear');
        writeLegalPendingHint(false);
        // Tells the other tabs to re-ask the server. They do not take this as
        // permission — only the server can grant that.
        announceLegalConsentChange('accepted');
      } else {
        // The server accepted some but not all — most likely because another
        // document started requiring acknowledgement between render and click.
        await check();
        setAgreed(false);
      }
    } catch (err) {
      /**
       * One neutral sentence, whatever went wrong.
       *
       * `err.message` was rendered directly, so a malformed response, a 5xx or
       * a parse failure put developer text in front of someone who cannot
       * dismiss this modal or navigate away from it — the single worst screen
       * in the product to leak a technical string onto. The detail goes to the
       * console instead.
       *
       * 429 is the one case worth naming: it is not a failure the reader should
       * retry immediately, and the server supplies a wait.
       */
      console.error('[legal-consent] acknowledgement failed', err);
      if (err?.status === 429) {
        const wait = err?.retryAfterSeconds;
        setError(
          Number.isFinite(wait) && wait > 0
            ? `Too many attempts. Please try again in ${Math.ceil(wait / 60)} minute${Math.ceil(wait / 60) === 1 ? '' : 's'}.`
            : 'Too many attempts. Please try again in a little while.',
        );
      } else {
        setError(
          'We could not record your acceptance. Check your connection and try again.',
        );
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (!blocking) return children;

  // Blocking, but the documents have not arrived yet. Deliberately says nothing
  // about what changed — it does not know yet, and inventing a headline that
  // the next render replaces reads as a glitch.
  if (confirming) {
    return (
      <div className={styles.wrapper} role="status" aria-live="polite">
        <div className={styles.card}>
          <div className={styles.loading}>
            <Loader2 size={18} className={styles.spin} />
            <span>Checking for policy updates…</span>
          </div>
        </div>
      </div>
    );
  }

  const readingDoc = reading
    ? pending.find((d) => d.versionId === reading)
    : null;

  return (
    <div
      className={styles.wrapper}
      role="dialog"
      aria-modal="true"
      aria-labelledby="legal-update-title"
    >
      <div className={styles.card}>
        {readingDoc ? (
          <div className={styles.reader}>
            <div className={styles.readerHead} style={{ paddingTop: '1.25rem' }}>
              <button
                type="button"
                className={styles.backBtn}
                onClick={() => setReading(null)}
              >
                <ArrowLeft size={14} />
                Back
              </button>
              <h2 className={styles.readerTitle}>
                {readingDoc.title} · v{readingDoc.versionNumber}
              </h2>
            </div>
            {/* Server-sanitized on write (the same sanitizer the admin save
                path uses), so there is no unsanitized copy of this anywhere.
                External links are hardened on render as well, because the
                seeded documents predate the sanitizer's link rule and their
                anchors carry no rel/target — and this modal is the one screen
                the reader cannot navigate away from, so a link that quietly
                replaced it would strand them mid-acceptance. */}
            <div
              ref={readerRef}
              className={styles.readerBody}
              dangerouslySetInnerHTML={{ __html: readingDoc.content }}
            />
          </div>
        ) : (
          <>
            <div className={styles.header}>
              <div className={styles.iconBadge}>
                <ShieldCheck size={26} />
              </div>
              <h1 id="legal-update-title" className={styles.title}>
                We&apos;ve updated our policies
              </h1>
              <p className={styles.body}>
                {pending.length === 1
                  ? 'We have made changes to the document below. Please review it and confirm to carry on using Meetifyy.'
                  : `We have made changes to ${pending.length} documents. Please review them and confirm to carry on using Meetifyy.`}
              </p>
            </div>

            <div className={styles.docList}>
              {pending.map((doc) => (
                <div key={doc.versionId} className={styles.doc}>
                  <div className={styles.docHead}>
                    <h2 className={styles.docTitle}>{doc.title}</h2>
                    <span className={styles.docVersion}>
                      Version {doc.versionNumber}
                    </span>
                  </div>

                  {doc.changeSummary && (
                    <p className={styles.docSummary}>{doc.changeSummary}</p>
                  )}

                  {doc.effectiveAt && (
                    <p className={styles.docMeta}>
                      Effective{' '}
                      {new Date(doc.effectiveAt).toLocaleDateString(undefined, {
                        day: 'numeric',
                        month: 'long',
                        year: 'numeric',
                      })}
                    </p>
                  )}

                  <button
                    type="button"
                    className={styles.readBtn}
                    onClick={() => setReading(doc.versionId)}
                  >
                    <FileText size={14} />
                    Read the full {doc.label ?? 'document'}
                  </button>
                </div>
              ))}
            </div>
          </>
        )}

        <div className={styles.footer}>
          {error && (
            <div className={styles.error} role="alert">
              <AlertCircle size={16} />
              <span>{error}</span>
            </div>
          )}

          <label className={styles.consentRow}>
            <input
              type="checkbox"
              checked={agreed}
              onChange={(e) => setAgreed(e.target.checked)}
            />
            <span>
              I have read and agree to the updated{' '}
              {pending.map((d, i) => (
                <span key={d.versionId}>
                  {i > 0 && (i === pending.length - 1 ? ' and ' : ', ')}
                  <strong>{d.label ?? d.title}</strong>
                </span>
              ))}
              .
            </span>
          </label>

          <p className={styles.requiredNote}>
            Accepting is required to continue using Meetifyy.
          </p>

          <button
            type="button"
            className={styles.primaryBtn}
            onClick={handleAccept}
            disabled={!agreed || submitting}
          >
            {submitting ? (
              <>
                <Loader2 size={16} className={styles.spin} />
                Saving…
              </>
            ) : (
              <>
                <Check size={16} />
                I Agree &amp; Continue
              </>
            )}
          </button>

          <button
            type="button"
            className={styles.signOutBtn}
            onClick={logout}
            disabled={submitting}
          >
            <LogOut size={12} style={{ verticalAlign: '-2px' }} /> Sign out
            instead
          </button>
        </div>
      </div>
    </div>
  );
}

LegalUpdateGate.propTypes = {
  children: PropTypes.node,
};
