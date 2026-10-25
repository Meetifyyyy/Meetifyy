import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useOverlayBack } from '@shared/hooks/useOverlayBack';
import { useScrollLock } from '@shared/hooks/useScrollLock';
import { useSheetDrag } from '@shared/hooks/useSheetDrag';
import { useQueryClient } from '@tanstack/react-query';
import { CONFESSION_KEYS, useCreateConfession } from '@shared/hooks/useConfessions';
import { showToast } from '@shared/utils/toast';
import { Send, X } from '@shared/components/icons';
import HandleMark from './HandleMark';
import styles from './Confessions.module.css';

export const CONFESSION_MIN = 15;
export const CONFESSION_MAX = 1000;
/** How long the sheet takes to leave; matches `sheetDown` / `popOut` in the CSS. */
const CLOSE_MS = 220;

/** How the server counts: code points, after trimming. */
function lengthOf(text) {
  return [...text.trim()].length;
}

/** The "Write a confession…" bar at the top of the feed; opens the composer. */
export function ComposerTrigger({ handle, onOpen }) {
  return (
    <button type="button" className={styles.trigger} onClick={onOpen}>
      <HandleMark handle={handle} size={44} />
      <span className={styles.triggerText}>
        <span className={styles.triggerPrompt}>Write a confession…</span>
      </span>
      <span className={styles.triggerPen} aria-hidden="true">
        <svg viewBox="0 0 24 24">
          <path d="M4 20l4.5-1 10-10a2.1 2.1 0 0 0-3-3l-10 10L4 20z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
        </svg>
      </span>
    </button>
  );
}

/**
 * The writing sheet. Full screen on a phone, a centred panel on a larger one.
 * Back (hardware or browser) closes it like the Cancel button does; a draft is
 * kept if it is closed by accident and only cleared once it posts.
 */
export default function ConfessionComposer({ open, onClose }) {
  const [text, setText] = useState('');
  const [error, setError] = useState(null);
  const create = useCreateConfession();
  const queryClient = useQueryClient();
  const areaRef = useRef(null);
  const titleId = useId();
  const countId = useId();

  // Closing plays the sheet out before it unmounts. The keyboard is dismissed
  // first, so it leaves together with the sheet rather than after it.
  //
  // `openRef`, not `open`: a post that lands after the sheet was already
  // closed (✕, Back or a drag while it was sending) calls `close` from the
  // render it started in, where `open` was still true. Acting on that left the
  // sheet marked as closing with a timer pending, and the next opening played
  // the exit at once and shut itself.
  const [closing, setClosing] = useState(false);
  const closeTimer = useRef(0);
  const openRef = useRef(open);
  useLayoutEffect(() => {
    openRef.current = open;
    if (open) return;
    // However it closed, nothing from that opening may reach the next one.
    window.clearTimeout(closeTimer.current);
    closeTimer.current = 0;
    setClosing(false);
  }, [open]);
  const close = useCallback(() => {
    if (!openRef.current || closeTimer.current) return;
    areaRef.current?.blur();
    setClosing(true);
    closeTimer.current = window.setTimeout(() => {
      closeTimer.current = 0;
      onClose();
    }, CLOSE_MS);
  }, [onClose]);
  useEffect(() => () => window.clearTimeout(closeTimer.current), []);

  useOverlayBack(open, close);
  useScrollLock(open);

  // Drag down to dismiss, like the app's other sheets (phones only). The drag
  // already slides the sheet away, so it ends straight in `onClose` rather
  // than `close`, which would play a second exit.
  // The keyboard goes as soon as the sheet starts to move, not after it has
  // slid away; it stays down if the sheet springs back.
  const hideKeyboard = useCallback(() => areaRef.current?.blur(), []);
  const sheetRef = useSheetDrag(onClose, { enabled: open && !closing, onDragStart: hideKeyboard });

  // Focused in the same task as the tap that opened it (the opener mounts the
  // sheet with flushSync). Android raises the keyboard only for a focus that
  // happens inside the user's gesture; one from a timer afterwards put the
  // caret in the field and left the keyboard down.
  useLayoutEffect(() => {
    if (open) areaRef.current?.focus({ preventScroll: true });
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') {
        close();
        return;
      }
      // Keep Tab inside the sheet: it is modal, and the page behind it is
      // scroll-locked and covered.
      if (e.key !== 'Tab' || !sheetRef.current) return;
      const focusable = [...sheetRef.current.querySelectorAll('button:not([disabled]), textarea')];
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, close, sheetRef]);

  const length = lengthOf(text);
  const over = length > CONFESSION_MAX;
  const tooShort = length < CONFESSION_MIN;
  const canPost = !over && !tooShort && !create.isPending;

  // Tapping send on too short a confession explains why, in a tip hanging
  // from the button, instead of the button silently doing nothing.
  const [shortTip, setShortTip] = useState(false);
  useEffect(() => {
    if (!shortTip) return undefined;
    const t = window.setTimeout(() => setShortTip(false), 2600);
    return () => window.clearTimeout(t);
  }, [shortTip]);

  const submit = useCallback(async () => {
    if (tooShort && !create.isPending) {
      setShortTip(true);
      return;
    }
    if (!canPost) return;
    setError(null);
    try {
      await create.mutateAsync(text.trim());
      setText('');
      close();
    } catch (err) {
      const code = err?.code;
      if (code === 'duplicate_confession') {
        // The server holds this exact confession from this name already. Most
        // often that is this very post: its first attempt went through but
        // the answer was lost, and this is the retry. Either way it is on the
        // feed, so the sheet's job is done; refetch to show it.
        setText('');
        queryClient.invalidateQueries({ queryKey: CONFESSION_KEYS.feed });
        showToast('Already posted', 'success');
        close();
      }
      else if (code === 'content_invalid') setError(`Confessions need ${CONFESSION_MIN}–${CONFESSION_MAX} characters.`);
      else if (code === 'confession_profile_required') {
        // The cached profile is stale (the account's was removed elsewhere):
        // re-read it, which puts the page back on the name screen.
        setError('Choose your anonymous name first.');
        queryClient.invalidateQueries({ queryKey: CONFESSION_KEYS.me });
      }
      else if (code === 'rate_limited') setError(err.message || 'You’re posting a lot. Take a breath and try again soon.');
      else if (err?.name !== 'OfflineError') setError(err?.message || 'Couldn’t post. Try again.');
    }
  }, [tooShort, canPost, create, text, close, queryClient]);

  const onKeyDown = useCallback((e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      submit();
    }
  }, [submit]);

  if (!open) return null;

  const ratio = Math.min(1, length / CONFESSION_MAX);
  const remaining = CONFESSION_MAX - length;

  return createPortal(
    <div className={styles.sheetRoot} data-closing={closing ? '' : undefined}>
      <button type="button" className={styles.scrim} aria-label="Close" onClick={close} tabIndex={-1} />
      {/* `data-keyboard-dock`: the sheet keeps its size and lifts only its
          footer over the keyboard (CSS), so the app-wide keyboard handling
          must not also slide or scroll it. */}
      <div
        ref={sheetRef}
        className={styles.sheet}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-keyboard-dock=""
      >
        {/* The header is the grab area (no visible handle): a drag that
            starts in the writing area is left to the text. */}
        <div className={styles.sheetHead} data-sheet-handle="">
          <button type="button" className={styles.sheetClose} onClick={close} aria-label="Close">
            <X size={20} strokeWidth={2} />
          </button>
          <h2 id={titleId} className={styles.sheetTitle}>New confession</h2>
          <span className={styles.sheetPostWrap}>
            <button
              type="button"
              className={styles.sheetPost}
              onClick={submit}
              // Too short stays tappable (it shows the tip); over the limit or
              // already posting does not.
              disabled={over || create.isPending}
              data-short={tooShort ? '' : undefined}
              aria-label={create.isPending ? 'Posting' : 'Post'}
              aria-busy={create.isPending ? 'true' : undefined}
              aria-describedby={shortTip ? `${titleId}-tip` : undefined}
            >
              {create.isPending
                ? <span className={styles.postSpinner} aria-hidden="true" />
                : <Send size={19} strokeWidth={2} />}
            </button>
            {shortTip && (
              <span id={`${titleId}-tip`} className={styles.postTip} role="status">
                Write at least {CONFESSION_MIN} characters
              </span>
            )}
          </span>
        </div>

        <div className={styles.sheetBody}>
          <textarea
            ref={areaRef}
            className={styles.area}
            value={text}
            onChange={(e) => { setText(e.target.value); setError(null); setShortTip(false); }}
            onKeyDown={onKeyDown}
            placeholder="What have you never told anyone on campus?"
            aria-label="Your confession"
            aria-describedby={countId}
            maxLength={CONFESSION_MAX + 200}
          />
          {error && <p className={styles.sheetError} role="alert">{error}</p>}
        </div>

        <div className={styles.sheetFoot}>
          <span id={countId} className={styles.counter} data-over={over ? 'true' : undefined} aria-live="polite">
            <svg viewBox="0 0 36 36" aria-hidden="true">
              <circle cx="18" cy="18" r="15" className={styles.counterTrack} />
              <circle
                cx="18"
                cy="18"
                r="15"
                className={styles.counterFill}
                style={{ strokeDashoffset: 94.25 * (1 - ratio) }}
              />
            </svg>
            <span className={styles.counterText}>
              {remaining <= 100 ? remaining : `${length}/${CONFESSION_MAX}`}
            </span>
          </span>
        </div>
      </div>
    </div>,
    document.body,
  );
}
