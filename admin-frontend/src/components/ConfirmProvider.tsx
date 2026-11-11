import React, { createContext, useCallback, useContext, useLayoutEffect, useRef, useState } from 'react';
import { AlertTriangle, Loader2, ShieldAlert, Trash2, X } from './icons';

/**
 * One confirmation dialog for the whole admin portal.
 *
 * Before this there were three different answers to the same question. Deleting
 * a user, deleting a college, revoking a campus rep and logging out every
 * session all used `window.confirm`, which cannot be styled, cannot say what
 * the consequence is, cannot show that the request is in flight, and on some
 * browsers is suppressible. Purging an account had a hand-rolled dialog living
 * inside AccountDeletionPage. Several other destructive actions had nothing at
 * all and fired on the first click.
 *
 * WHY A PROVIDER RATHER THAN A COMPONENT PER PAGE
 * A `<ConfirmModal>` per page means every caller owns open/target/pending state
 * and re-implements the same four `useState`s, which is exactly how the three
 * variants above appeared. Here the dialog is mounted once and requested
 * imperatively, so a call site is one function call next to the mutation it
 * guards.
 *
 * WHY THE DIALOG RUNS THE ACTION
 * `confirm()` returning a boolean would leave loading, failure and
 * double-submit to each caller again. Instead the caller hands over the work
 * and the dialog awaits it, so the button disables on click, a spinner shows
 * while it runs, and a failure is reported inside the dialog with the action
 * still available to retry, rather than closing over a toast the person may not
 * connect to what they just did.
 */

export type ConfirmSeverity = 'critical' | 'high' | 'moderate';

export interface ConfirmOptions {
  /** Short, states the action. "Delete this user?" */
  title: string;
  /** What is about to happen, in a sentence. */
  description: string;
  /**
   * What follows, as bullets. Reserved for things the person cannot see from
   * the button they clicked - data that goes with it, people who get logged
   * out, whether it can be undone.
   */
  consequences?: string[];
  severity: ConfirmSeverity;
  /** Verb for the confirm button. Defaults to the severity's own. */
  confirmLabel?: string;
  cancelLabel?: string;
  /**
   * The work. Awaited: a rejection keeps the dialog open and shows the message,
   * a resolution closes it.
   */
  onConfirm: () => Promise<unknown> | unknown;
  /**
   * Runs when the dialog is dismissed without confirming (Cancel, the X,
   * Escape, the backdrop). For a caller holding something open until it hears
   * back — a blocked navigation that has to be reset.
   */
  onCancel?: () => void;
}

type ConfirmFn = (options: ConfirmOptions) => void;

const ConfirmContext = createContext<ConfirmFn | null>(null);

/**
 * How each severity presents itself.
 *
 * Deliberately three, not a free-form colour. A shared vocabulary is the point:
 * an operator should be able to tell how bad something is from the dialog
 * without reading it closely, and that only works if "critical" looks the same
 * everywhere it appears.
 */
const SEVERITY = {
  critical: {
    Icon: Trash2,
    tone: 'var(--color-danger)',
    tint: 'var(--color-danger-tint)',
    label: 'Irreversible',
    confirmClass: 'btn-danger btn-danger-solid',
    defaultConfirmLabel: 'Delete',
  },
  high: {
    Icon: ShieldAlert,
    tone: 'var(--color-danger)',
    tint: 'var(--color-danger-tint)',
    label: 'High impact',
    confirmClass: 'btn-danger btn-danger-solid',
    defaultConfirmLabel: 'Confirm',
  },
  moderate: {
    Icon: AlertTriangle,
    tone: 'var(--color-warning)',
    tint: 'var(--color-warning-tint)',
    label: 'Please confirm',
    confirmClass: 'btn-primary',
    defaultConfirmLabel: 'Confirm',
  },
} as const;

export const ConfirmProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [request, setRequest] = useState<ConfirmOptions | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Guards against a second submission reaching the handler.
   *
   * `pending` drives the UI, but state is asynchronous: two clicks dispatched
   * in the same tick both read `pending === false` and both would run. A ref is
   * written synchronously, so the second click sees the first immediately. This
   * matters most for exactly the actions behind this dialog - a double-fired
   * purge or delete is not idempotent.
   */
  const inFlight = useRef(false);

  // The open request, readable synchronously by `close`.
  const requestRef = useRef<ConfirmOptions | null>(null);

  const confirm = useCallback<ConfirmFn>((options) => {
    setError(null);
    setPending(false);
    inFlight.current = false;
    requestRef.current = options;
    setRequest(options);
  }, []);

  const close = useCallback(() => {
    if (inFlight.current) return; // never abandon a request that is running
    const dismissed = requestRef.current;
    requestRef.current = null;
    setRequest(null);
    setError(null);
    dismissed?.onCancel?.();
  }, []);

  const run = useCallback(async () => {
    if (!request || inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    setError(null);
    try {
      await request.onConfirm();
      requestRef.current = null;
      setRequest(null);
    } catch (err: any) {
      // Reported here rather than as a toast: the dialog is where the decision
      // was made, and it stays open so the action can be retried.
      setError(err?.message || 'The action could not be completed.');
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }, [request]);

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {request && (
        <ConfirmDialog
          request={request}
          pending={pending}
          error={error}
          onCancel={close}
          onConfirm={run}
        />
      )}
    </ConfirmContext.Provider>
  );
};

const ConfirmDialog: React.FC<{
  request: ConfirmOptions;
  pending: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}> = ({ request, pending, error, onCancel, onConfirm }) => {
  const style = SEVERITY[request.severity];
  const { Icon } = style;

  // Escape cancels, but never while the action is running - closing then would
  // hide a request the operator still needs the result of.
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !pending) onCancel();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onCancel, pending]);

  // Focus lands on Cancel, not Confirm. A destructive action should never be
  // one stray Enter away, and this dialog is often opened from a row where the
  // key is already down.
  const cancelRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const locked = [document.documentElement, document.body, ...document.querySelectorAll<HTMLElement>('.admin-content-surface')];
    const previous = locked.map((element) => ({ element, overflow: element.style.overflow }));
    previous.forEach(({ element }) => { element.style.overflow = 'hidden'; });
    cancelRef.current?.focus({ preventScroll: true });
    const trapFocus = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      const controls = Array.from(dialog?.querySelectorAll<HTMLElement>('button:not([disabled]), [href], input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex="0"]') || []);
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (!first) { event.preventDefault(); dialog?.focus({ preventScroll: true }); return; }
      if (!dialog?.contains(document.activeElement)) { event.preventDefault(); first.focus({ preventScroll: true }); }
      else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus({ preventScroll: true }); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus({ preventScroll: true }); }
    };
    document.addEventListener('keydown', trapFocus);
    return () => {
      const restore = dialog?.contains(document.activeElement) || document.activeElement === document.body;
      document.removeEventListener('keydown', trapFocus);
      previous.forEach(({ element, overflow }) => { element.style.overflow = overflow; });
      // Keep an explicit onCancel focus target (for example the mobile menu).
      if (restore && opener?.isConnected && !opener.closest('[inert]')) opener.focus({ preventScroll: true });
    };
  }, []);

  return (
    <div
      className="modal-backdrop"
      // Above other modals, so a confirmation raised from inside one (e.g. the
      // revoke-affiliation reason form) is never covered by it.
      style={{ zIndex: 110 }}
      onClick={() => { if (!pending) onCancel(); }}
      role="presentation"
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="modal-content confirm-dialog admin-dialog-layout"
        style={{ maxWidth: 'min(460px, 100%)', width: '100%' }}
        onClick={(e) => e.stopPropagation()}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        aria-describedby="confirm-description"
      >
        <div className="confirm-dialog-header" style={{ display: 'flex', alignItems: 'flex-start', gap: '0.875rem' }}>
          <div
            aria-hidden="true"
            style={{
              flexShrink: 0, width: 40, height: 40, borderRadius: 12,
              background: style.tint, color: style.tone,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            <Icon size={20} />
          </div>

          <div style={{ minWidth: 0, flex: 1 }}>
            <div
              style={{
                fontSize: '0.75rem', fontWeight: 600, color: style.tone, marginBottom: 2,
              }}
            >
              {style.label}
            </div>
            <h3 id="confirm-title" style={{ margin: 0, fontSize: '1.125rem', fontWeight: 650, lineHeight: 1.4 }}>
              {request.title}
            </h3>
          </div>

          <button
            onClick={onCancel}
            disabled={pending}
            aria-label="Cancel"
            className="dialog-close"
          >
            <X size={18} />
          </button>
        </div>

        <div className="confirm-dialog-body admin-dialog-body">
          <p
            id="confirm-description"
            style={{ margin: 0, fontSize: '0.875rem', lineHeight: 1.55, color: 'var(--color-text-body, #475569)' }}
          >
            {request.description}
          </p>

          {request.consequences && request.consequences.length > 0 && (
            <ul
              style={{
                margin: '0.75rem 0 0', padding: '0.7rem 0.9rem 0.7rem 2rem',
                background: style.tint, borderRadius: 12,
                fontSize: '0.82rem', lineHeight: 1.6, color: 'var(--color-text-body, #475569)',
              }}
            >
              {request.consequences.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          )}

          {error && (
            <div
              role="alert"
              style={{
                marginTop: '0.75rem', padding: '0.75rem', borderRadius: 12,
                background: 'var(--color-danger-tint)', color: 'var(--color-danger)',
                fontSize: '0.82rem', display: 'flex', gap: '0.5rem', alignItems: 'flex-start',
              }}
            >
              <AlertTriangle size={15} style={{ flexShrink: 0, marginTop: 1 }} />
              <span>{error}</span>
            </div>
          )}
        </div>

        {/* Wraps on narrow screens so neither button is ever clipped. */}
        <div
          className="modal-actions confirm-dialog-footer"
          style={{
            display: 'flex', justifyContent: 'flex-end', flexWrap: 'wrap',
            gap: '0.6rem',
          }}
        >
          <button
            ref={cancelRef}
            type="button"
            className="btn-secondary"
            onClick={onCancel}
            disabled={pending}
            style={{ minWidth: 100, justifyContent: 'center' }}
          >
            {request.cancelLabel || 'Cancel'}
          </button>
          <button
            type="button"
            className={style.confirmClass}
            onClick={onConfirm}
            disabled={pending}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', minWidth: 116, justifyContent: 'center' }}
          >
            {pending ? (
              <>
                <Loader2 size={15} className="spin" />
                Working...
              </>
            ) : (
              <>{request.confirmLabel || style.defaultConfirmLabel}</>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

/**
 * Ask for confirmation before running something.
 *
 *   const confirm = useConfirm();
 *   confirm({
 *     title: 'Delete this user?',
 *     description: '@sam will be removed from Meetifyy.',
 *     consequences: ['Their posts and messages go with them.', 'This cannot be undone.'],
 *     severity: 'critical',
 *     confirmLabel: 'Delete user',
 *     onConfirm: () => deleteUser.mutateAsync(id),
 *   });
 *
 * Pass `mutateAsync`, not `mutate`: the dialog needs the promise to know when
 * the work finished and whether it failed. With `mutate` it would close
 * immediately and report success it has not observed.
 */
export function useConfirm(): ConfirmFn {
  const ctx = useContext(ConfirmContext);
  if (!ctx) {
    throw new Error('useConfirm must be used inside <ConfirmProvider>');
  }
  return ctx;
}

export default ConfirmProvider;
