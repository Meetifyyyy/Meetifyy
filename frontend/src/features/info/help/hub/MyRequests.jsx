import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { supportApi } from '@shared/api/apiClient';
import { useAuth } from '@shared/context/AuthContext';
import { useOverlayBack } from '@shared/hooks/useOverlayBack';
import { useSheetDrag } from '@shared/hooks/useSheetDrag';
import { useScrollLock } from '@shared/hooks/useScrollLock';
import SafeHtml from '@shared/components/richtext/SafeHtml';
import { AlertCircle, ChevronRight, Inbox, RefreshCw, X } from '@shared/components/icons';
import { REQUEST_STATUS } from './helpHub';
import styles from './HelpHub.module.css';
import sheet from './SupportRequestModal.module.css';

const DATE = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
const DATE_TIME = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

const statusOf = (s) => REQUEST_STATUS[s] ?? { label: s, tone: 'neutral' };

/**
 * The signed-in user's support requests and where each one stands. A request
 * opens to show what was sent and every reply from the team; replies also
 * arrive by email.
 *
 * @param {object} p
 * @param {(kind: 'problem'|'idea') => void} p.onNewRequest  opens the report modal
 */
export default function MyRequests({ onNewRequest }) {
  const { currentUser } = useAuth();
  const signedIn = Boolean(currentUser);
  const [openTicket, setOpenTicket] = useState(null);

  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ['support', 'my-requests'],
    queryFn: ({ signal }) => supportApi.getMyRequests({ signal }),
    enabled: signedIn,
    staleTime: 30 * 1000,
    // A reply from the team changes a status; coming back to the app shows it.
    refetchOnWindowFocus: true,
  });

  if (!signedIn) {
    return (
      <div className={styles.state}>
        <Inbox size={22} aria-hidden="true" className={styles.stateIcon} />
        <p className={styles.stateTitle}>Sign in to see your requests</p>
        <p className={styles.stateText}>
          Requests sent while signed out are answered by email. Your Request ID is in the confirmation we sent you.
        </p>
        <Link className={styles.primary} to="/login">Sign in</Link>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className={styles.card} aria-busy="true" aria-label="Loading your requests">
        {[0, 1, 2].map((i) => (
          <div key={i} className={styles.skeletonRow} />
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <div className={styles.state}>
        <AlertCircle size={22} aria-hidden="true" className={styles.stateIcon} />
        <p className={styles.stateTitle}>We could not load your requests</p>
        <p className={styles.stateText}>Check your connection and try again.</p>
        <button type="button" className={styles.secondary} onClick={() => refetch()} disabled={isFetching}>
          <RefreshCw size={15} aria-hidden="true" />
          Try again
        </button>
      </div>
    );
  }

  const requests = data?.requests ?? [];

  if (requests.length === 0) {
    return (
      <div className={styles.state}>
        <Inbox size={22} aria-hidden="true" className={styles.stateIcon} />
        <p className={styles.stateTitle}>No requests yet</p>
        <p className={styles.stateText}>Problems you report and ideas you share from this account show up here.</p>
        <button type="button" className={styles.primary} onClick={() => onNewRequest('problem')}>
          Report a problem
        </button>
      </div>
    );
  }

  return (
    <div className={styles.stack}>
      <div className={styles.listHead}>
        <span>
          {requests.length} request{requests.length === 1 ? '' : 's'}
        </span>
        <button
          type="button"
          className={styles.refresh}
          onClick={() => refetch()}
          disabled={isFetching}
          aria-label="Refresh your requests"
        >
          <RefreshCw size={14} aria-hidden="true" className={isFetching ? styles.spinning : undefined} />
          {isFetching ? 'Refreshing' : 'Refresh'}
        </button>
      </div>
      <ul className={styles.card}>
        {requests.map((req) => {
          const status = statusOf(req.status);
          return (
            <li key={req.ticketNumber}>
              <button type="button" className={styles.requestRow} onClick={() => setOpenTicket(req.ticketNumber)}>
                <span className={styles.rowText}>
                  <span className={styles.rowTitle}>
                    {req.type === 'IDEA' && <span className={styles.kind}>Idea</span>}
                    {req.subject}
                  </span>
                  <span className={styles.rowSub}>
                    {req.ticketNumber} · {req.categoryLabel} · {DATE.format(new Date(req.createdAt))}
                  </span>
                </span>
                <span className={styles.status} data-tone={status.tone}>{status.label}</span>
                <ChevronRight size={16} aria-hidden="true" className={styles.chev} />
              </button>
            </li>
          );
        })}
      </ul>
      <p className={styles.note}>
        Replies also come to your email. &ldquo;Waiting for you&rdquo; means the team has asked you something.
      </p>
      {openTicket && <RequestDetail ticketNumber={openTicket} onClose={() => setOpenTicket(null)} />}
    </div>
  );
}

const AUTHOR = { USER: 'You', ADMIN: 'Meetifyy support', SYSTEM: 'Update' };

function RequestDetail({ ticketNumber, onClose }) {
  useOverlayBack(true, onClose);
  const sheetRef = useSheetDrag(onClose, { enabled: true });
  useScrollLock(true);
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['support', 'my-request', ticketNumber],
    queryFn: ({ signal }) => supportApi.getMyRequest(ticketNumber, { signal }),
    staleTime: 30 * 1000,
  });

  const status = data ? statusOf(data.status) : null;

  return createPortal(
    <div className={sheet.overlay} onClick={onClose} role="presentation">
      <div
        ref={sheetRef}
        className={sheet.sheet}
        role="dialog"
        aria-modal="true"
        aria-label={`Request ${ticketNumber}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sheet-handle" data-sheet-handle aria-hidden="true" />
        <header className={sheet.header}>
          <h2 className={sheet.title}>{data?.subject ?? ticketNumber}</h2>
          <button type="button" className={sheet.close} onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </header>
        <div className={sheet.form}>
          {isLoading && <div className={styles.skeletonRow} aria-busy="true" aria-label="Loading request" />}
          {isError && (
            <div className={sheet.errorBox} role="alert">
              <AlertCircle size={16} aria-hidden="true" />
              <span>
                This request could not be loaded.{' '}
                <button type="button" className={styles.inlineLink} onClick={() => refetch()}>
                  Try again
                </button>
              </span>
            </div>
          )}
          {data && (
            <>
              <div className={styles.detailMeta}>
                <span className={styles.status} data-tone={status.tone}>{status.label}</span>
                <span>
                  {data.type === 'IDEA' ? 'Idea' : 'Problem'} · {data.categoryLabel}
                </span>
                <span>{data.ticketNumber}</span>
                <span>Sent {DATE_TIME.format(new Date(data.createdAt))}</span>
              </div>
              <section>
                <h3 className={styles.blockTitle}>What you sent</h3>
                <p className={styles.detailBody}>{data.description}</p>
              </section>
              <section>
                <h3 className={styles.blockTitle}>Replies</h3>
                {data.messages.length === 0 ? (
                  <p className={styles.note}>
                    No replies yet. The team replies by email, and replies also appear here.
                  </p>
                ) : (
                  <ol className={styles.thread}>
                    {data.messages.map((m) => (
                      <li key={m.id} className={styles.message} data-from={m.from}>
                        <span className={styles.messageMeta}>
                          {AUTHOR[m.from] ?? 'Meetifyy'} · {DATE_TIME.format(new Date(m.createdAt))}
                        </span>
                        {/* Team replies are rich text, sanitized when written and
                            again by SafeHtml; anything else is shown as text. */}
                        {m.from === 'ADMIN' ? (
                          <SafeHtml html={m.body} className={styles.detailBody} />
                        ) : (
                          <p className={styles.detailBody}>{m.body}</p>
                        )}
                      </li>
                    ))}
                  </ol>
                )}
              </section>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
