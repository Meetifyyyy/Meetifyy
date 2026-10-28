import { useCallback, useEffect, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import { useAuth } from '../../context/AuthContext';
import { legalApi } from '@shared/api/apiClient';
import { hardenExternalLinks, wrapTablesForScroll } from '@shared/utils/legalHtmlLinks';
import { useScrollLock } from '@shared/hooks/useScrollLock';
import { IS_MOBILE_BUILD } from '@config';
import {
  AlertCircle,
  ChevronLeft,
  Loader2,
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
 * The display name for each document type, used when the server's `label` is
 * missing. Kept in step with the backend's LEGAL_DOCUMENT_LABELS.
 */
const TYPE_LABELS = {
  TERMS_OF_SERVICE: 'Terms of Service',
  PRIVACY_POLICY: 'Privacy Policy',
  COOKIE_POLICY: 'Cookie Policy',
  COMMUNITY_GUIDELINES: 'Community Guidelines',
};

/** Terms first, then Privacy, then anything else in the server's order. */
const TYPE_ORDER = ['TERMS_OF_SERVICE', 'PRIVACY_POLICY'];

export function legalDocName(doc) {
  return doc?.label || TYPE_LABELS[doc?.documentType] || doc?.title || 'document';
}

function sortDocs(docs) {
  const rank = (d) => {
    const i = TYPE_ORDER.indexOf(d.documentType);
    return i === -1 ? TYPE_ORDER.length : i;
  };
  return docs
    .map((d, i) => [d, i])
    .sort(([a, ai], [b, bi]) => rank(a) - rank(b) || ai - bi)
    .map(([d]) => d);
}

/** "A", "A and B", "A, B and C". */
export function joinNames(names) {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/** "Updates to our Terms of Service and Privacy Policy", etc. */
export function legalUpdateTitle(docs) {
  return `Updates to our ${joinNames(sortDocs(docs).map(legalDocName))}`;
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Blocking dialog shown when Meetifyy has published a policy update whose
 * acceptance is mandatory.
 *
 * Built the same way as `SuspensionGate` and `AccountDeletionGate`, for the same
 * reason: the session stays valid on purpose — the user has to be able to read
 * the update and accept it — so this screen is what they get instead of the app.
 * The app shell is not rendered behind it (the backdrop is painted, not the
 * product): every request the shell made would be refused anyway.
 *
 * It is presentation only. `JwtGuard` refuses every route not marked
 * `@AllowPendingLegalAck()`, so unmounting this component, opening a second tab,
 * navigating with the back button or driving the API by hand gains nobody
 * anything. That is also why there is no close button, no Escape, no backdrop
 * dismiss and no "remind me later": there is nothing for one to do except
 * mislead.
 *
 * Consent is the explicit "Got it" button, on a screen whose subtitle names
 * the updated documents and links each one.
 *
 * Layout: a centred card over a dimmed backdrop from 768px up; below that, and
 * always in the installed app, the same content as an opaque full-screen sheet
 * that pads for the status and navigation bars and pins its buttons to the
 * bottom.
 *
 * ── One flow, however many documents ──────────────────────────────────────
 * The server returns every outstanding version in a single list, and the whole
 * list is accepted in a single request. Terms-only, Privacy-only and both-at-
 * once are therefore the same code path with a different title — no stacked
 * modals, and no way to accept one and be asked about the next.
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
  const [reading, setReading] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const readerRef = useRef(null);
  const dialogRef = useRef(null);
  const titleRef = useRef(null);
  const backRef = useRef(null);
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
    // Wide tables scroll sideways inside the reader instead of crushing
    // their columns on a phone.
    wrapTablesForScroll(readerRef.current);
  }, [reading]);

  const confirming = isLoggedIn && state === 'confirming';
  const blocking =
    isLoggedIn && ((state === 'pending' && pending.length > 0) || confirming);
  const showingDocs = blocking && !confirming;

  // The page behind must not scroll while the gate is up, and on iOS a body
  // that keeps scrolling is how a "blocking" overlay ends up scrolled off.
  useScrollLock(blocking);

  // Initial focus: the title when the summary is showing (so a screen reader
  // starts at the headline, not at a button that would consent), the Back
  // button inside the reader.
  useEffect(() => {
    if (!showingDocs) return;
    if (reading) backRef.current?.focus();
    else titleRef.current?.focus();
  }, [showingDocs, reading]);

  // Focus stays inside the dialog: Tab wraps, and Escape does nothing — there
  // is nothing to dismiss to.
  const onDialogKeyDown = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    if (e.key !== 'Tab') return;
    const root = dialogRef.current;
    if (!root) return;
    const items = Array.from(root.querySelectorAll(FOCUSABLE));
    if (items.length === 0) {
      e.preventDefault();
      return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    const inside = root.contains(active);
    if (e.shiftKey && (active === first || !inside || active === titleRef.current)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && (active === last || !inside)) {
      e.preventDefault();
      first.focus();
    }
  };

  // Focus that leaves the dialog (a click on the backdrop, a programmatic
  // blur) is brought back.
  useEffect(() => {
    if (!blocking) return undefined;
    const onFocusIn = (e) => {
      const root = dialogRef.current;
      if (root && !root.contains(e.target)) {
        (titleRef.current ?? root).focus();
      }
    };
    document.addEventListener('focusin', onFocusIn);
    return () => document.removeEventListener('focusin', onFocusIn);
  }, [blocking]);

  /*
   * The reader shows the version's own text from the API — that is the exact
   * wording being accepted. Only if a version arrives with an empty body does
   * it fall back to the bundled website copy, loaded on demand so the gate
   * does not carry every document's text in the main bundle.
   */
  const [fallbackContent, setFallbackContent] = useState({});
  const readingEmpty = pending.find((d) => d.versionId === reading && !d.content);
  const readingEmptyType = readingEmpty?.documentType ?? null;
  useEffect(() => {
    if (!readingEmptyType) return undefined;
    let cancelled = false;
    import('@features/info/pages/legalDocuments')
      .then(({ LEGAL_DOCUMENTS }) => {
        if (cancelled) return;
        setFallbackContent((prev) => ({
          ...prev,
          [readingEmptyType]: LEGAL_DOCUMENTS[readingEmptyType]?.content ?? '',
        }));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [readingEmptyType]);

  const handleAccept = async () => {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await legalApi.acknowledge(pending.map((d) => d.versionId));
      if (res?.satisfied) {
        setPending([]);
        setReading(null);
        setState('clear');
        writeLegalPendingHint(false);
        // Tells the other tabs to re-ask the server. They do not take this as
        // permission — only the server can grant that.
        announceLegalConsentChange('accepted');
      } else {
        // The server accepted some but not all — most likely because another
        // document started requiring acknowledgement between render and click.
        // The re-check shows the new list; nothing is accepted on the user's
        // behalf until they press the button again against it.
        setReading(null);
        await check();
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

  const wrapperClass = `${styles.wrapper}${IS_MOBILE_BUILD ? ` ${styles.app}` : ''}`;

  // Blocking, but the documents have not arrived yet. A skeleton of the card:
  // it deliberately says nothing about what changed — it does not know yet, and
  // inventing a headline that the next render replaces reads as a glitch.
  if (confirming) {
    return (
      <div className={wrapperClass} data-legal-gate="">
        <div
          className={`${styles.card} ${styles.skeletonCard}`}
          role="status"
          aria-live="polite"
          aria-busy="true"
        >
          <div className={styles.scroll}>
            <img className={styles.logo} src="/logo-mark.png" alt="" />
            <span className={styles.srOnly}>Checking for policy updates…</span>
            <div className={styles.skeletonStack} aria-hidden="true">
              <span className={`${styles.bone} ${styles.boneTitle}`} />
              <span className={`${styles.bone} ${styles.boneTitleShort}`} />
              <span className={`${styles.bone} ${styles.boneLine}`} />
              <span className={`${styles.bone} ${styles.boneLineShort}`} />
            </div>
          </div>
          <div className={styles.footer} aria-hidden="true">
            <span className={`${styles.bone} ${styles.boneSmall}`} />
            <span className={`${styles.bone} ${styles.boneButton}`} />
            <span className={`${styles.bone} ${styles.boneButton}`} />
          </div>
        </div>
      </div>
    );
  }

  const docs = sortDocs(pending);
  const single = docs.length === 1;

  const readingDoc = reading
    ? pending.find((d) => d.versionId === reading)
    : null;

  // The document names inside running text: each opens the in-dialog reader,
  // which works the same on the website and in the app.
  const inlineDocLinks = docs.map((doc, i) => (
    <span key={doc.versionId}>
      {i > 0 && (i === docs.length - 1 ? ' and ' : ', ')}
      <button
        type="button"
        className={styles.inlineLink}
        onClick={() => setReading(doc.versionId)}
      >
        {legalDocName(doc)}
      </button>
    </span>
  ));

  return (
    <div className={wrapperClass} data-legal-gate="">
      <div
        ref={dialogRef}
        className={styles.card}
        role="dialog"
        aria-modal="true"
        aria-labelledby={readingDoc ? 'legal-reader-title' : 'legal-update-title'}
        aria-describedby={readingDoc ? undefined : 'legal-update-desc'}
        tabIndex={-1}
        onKeyDown={onDialogKeyDown}
      >
        {readingDoc ? (
          <div className={styles.reader}>
            <div className={styles.readerHead}>
              <button
                ref={backRef}
                type="button"
                className={styles.backBtn}
                onClick={() => setReading(null)}
                aria-label="Back to the summary"
              >
                <ChevronLeft size={18} aria-hidden="true" />
              </button>
              <h2 id="legal-reader-title" className={styles.readerTitle}>
                {readingDoc.title}
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
              dangerouslySetInnerHTML={{
                __html:
                  readingDoc.content ||
                  fallbackContent[readingDoc.documentType] ||
                  '',
              }}
            />
          </div>
        ) : (
          <div className={styles.scroll}>
            <img className={styles.logo} src="/logo-mark.png" alt="" />
            <h1
              id="legal-update-title"
              ref={titleRef}
              tabIndex={-1}
              className={styles.title}
            >
              {legalUpdateTitle(docs)}
            </h1>
            <p id="legal-update-desc" className={styles.subtitle}>
              We&apos;ve updated our {inlineDocLinks}. Please take a moment to
              review {single ? 'it' : 'them'} before you continue.
            </p>

          </div>
        )}

        {!readingDoc && (
          <div className={styles.footer}>
            {error && (
              <div className={styles.error} role="alert">
                <AlertCircle size={16} />
                <span>{error}</span>
              </div>
            )}
  
            <button
              type="button"
              className={styles.primaryBtn}
              onClick={handleAccept}
              disabled={submitting}
              aria-busy={submitting || undefined}
            >
              {submitting ? (
                <>
                  <Loader2 size={16} className={styles.spin} />
                  Saving…
                </>
              ) : (
                'Got it'
              )}
            </button>
  
            {/* Sign-out is not an escape from the requirement — the gate is
                waiting again on the next sign-in. It is here because a shared
                machine is a real situation and being unable to leave an account
                would be worse. */}
            <button
              type="button"
              className={styles.secondaryBtn}
              onClick={logout}
              disabled={submitting}
            >
              Sign out
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

LegalUpdateGate.propTypes = {
  children: PropTypes.node,
};
