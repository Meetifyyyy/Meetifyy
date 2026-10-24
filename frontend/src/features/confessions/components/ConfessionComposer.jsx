import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useOverlayBack } from '@shared/hooks/useOverlayBack';
import { useScrollLock } from '@shared/hooks/useScrollLock';
import { useQueryClient } from '@tanstack/react-query';
import { CONFESSION_KEYS, useCreateConfession } from '@shared/hooks/useConfessions';
import { showToast } from '@shared/utils/toast';
import HandleMark from './HandleMark';
import styles from './Confessions.module.css';

export const CONFESSION_MIN = 10;
export const CONFESSION_MAX = 1000;

/** How the server counts: code points, after trimming. */
function lengthOf(text) {
  return [...text.trim()].length;
}

/** The "Write a confession…" bar at the top of the feed; opens the composer. */
export function ComposerTrigger({ handle, onOpen }) {
  return (
    <button type="button" className={styles.trigger} onClick={onOpen}>
      <HandleMark handle={handle} size={40} />
      <span className={styles.triggerText}>
        <span className={styles.triggerPrompt}>Write a confession…</span>
        <span className={styles.triggerMeta}>Posting as @{handle ?? '…'}</span>
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
export default function ConfessionComposer({ open, handle, onClose }) {
  const [text, setText] = useState('');
  const [error, setError] = useState(null);
  const create = useCreateConfession();
  const queryClient = useQueryClient();
  const areaRef = useRef(null);
  const sheetRef = useRef(null);
  const titleId = useId();
  const countId = useId();

  useOverlayBack(open, onClose);
  useScrollLock(open);

  useEffect(() => {
    if (!open) return undefined;
    const t = setTimeout(() => areaRef.current?.focus({ preventScroll: true }), 180);
    const onKey = (e) => {
      if (e.key === 'Escape') {
        onClose();
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
    return () => { clearTimeout(t); window.removeEventListener('keydown', onKey); };
  }, [open, onClose]);

  const length = lengthOf(text);
  const over = length > CONFESSION_MAX;
  const tooShort = length < CONFESSION_MIN;
  const canPost = !over && !tooShort && !create.isPending;

  const submit = useCallback(async () => {
    if (!canPost) return;
    setError(null);
    try {
      await create.mutateAsync(text.trim());
      setText('');
      showToast('Posted anonymously', 'success');
      onClose();
    } catch (err) {
      const code = err?.code;
      if (code === 'duplicate_confession') setError('You’ve already posted this. Try saying something new.');
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
  }, [canPost, create, text, onClose, queryClient]);

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
    <div className={styles.sheetRoot}>
      <button type="button" className={styles.scrim} aria-label="Close" onClick={onClose} tabIndex={-1} />
      <div ref={sheetRef} className={styles.sheet} role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className={styles.sheetHead}>
          <button type="button" className={styles.sheetCancel} onClick={onClose}>Cancel</button>
          <h2 id={titleId} className={styles.sheetTitle}>New confession</h2>
          <button type="button" className={styles.sheetPost} onClick={submit} disabled={!canPost}>
            {create.isPending ? 'Posting…' : 'Post'}
          </button>
        </div>

        <div className={styles.sheetBody}>
          <div className={styles.as}>
            <HandleMark handle={handle} size={28} />
            <span>Posting as <strong>@{handle ?? '…'}</strong></span>
          </div>
          <textarea
            ref={areaRef}
            className={styles.area}
            value={text}
            onChange={(e) => { setText(e.target.value); setError(null); }}
            onKeyDown={onKeyDown}
            placeholder="What have you never told anyone on campus?"
            aria-label="Your confession"
            aria-describedby={countId}
            maxLength={CONFESSION_MAX + 200}
          />
          {error && <p className={styles.sheetError} role="alert">{error}</p>}
        </div>

        <div className={styles.sheetFoot}>
          <p className={styles.rules}>
            No names, numbers or anything that identifies someone. Be kind — reports are reviewed.
          </p>
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
