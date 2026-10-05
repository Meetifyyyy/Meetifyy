import { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Avatar from '@shared/components/avatar/Avatar';
import MentionInput from '@shared/components/mentions/MentionInput';
import styles from './ReplyDock.module.css';

/**
 * The reply bar of a post: a floating bar docked to the bottom of the screen.
 *
 * AT REST it is the reader's avatar and a line of muted text, "Post your
 * reply" — it reads as part of the post, not as a form. The line IS the input,
 * so tapping it puts the caret there and raises the keyboard in one step; there
 * is no separate "open the composer" state to get out of sync.
 *
 * WHILE TYPING the right-hand side turns into a Send button: the slot grows
 * from nothing, so the field gives up exactly that much width and nothing else
 * moves. Empty, there is nothing to send and nothing is offered.
 *
 * WHERE IT SITS
 * Fixed to the bottom of the visible viewport, in a portal so no ancestor's
 * overflow or transform can clip or re-anchor it. On a phone the native shell
 * shrinks the WebView to the space above the keyboard, so `bottom: 0` is the
 * top of the keyboard; when there is no keyboard the navigation bar's height
 * (`--navigation-bar-inset`, folded into `env(safe-area-inset-bottom)` by the
 * mobile build) keeps it clear of the phone's buttons. On a wide screen it
 * follows the post column instead of spanning the window.
 */
export default function ReplyDock({
  currentUser,
  value,
  onChange,
  onSubmit,
  isPosting = false,
  inputRef,
  columnRef,
  inline = false,
  replyingTo = null,
  onCancelReply,
}) {
  const dockRef = useRef(null);
  const [focused, setFocused] = useState(false);
  const hasText = value.text.trim().length > 0;
  const canSend = hasText && !isPosting;

  // On a wide screen the bar sits in the post's column rather than spanning the
  // window. Fixed, so this only changes when the layout does.
  useLayoutEffect(() => {
    const column = columnRef?.current;
    const dock = dockRef.current;
    // Inline, the composer is ordinary page content and needs no placing.
    if (inline || !column || !dock) return undefined;
    const place = () => {
      const rect = column.getBoundingClientRect();
      dock.style.setProperty('--dock-left', `${rect.left}px`);
      dock.style.setProperty('--dock-width', `${rect.width}px`);
    };
    place();
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(place) : null;
    observer?.observe(column);
    window.addEventListener('resize', place);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', place);
    };
  }, [columnRef, inline]);

  const dock = (
    <div
      ref={dockRef}
      className={`${styles.dock} ${inline ? styles.inline : ''}`}
      data-focused={focused ? 'true' : 'false'}
      data-replying={replyingTo ? 'true' : 'false'}
      data-send={hasText || isPosting ? 'open' : 'closed'}
      // Focus leaving the bar entirely (not moving to the Send button).
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setFocused(false);
      }}
    >
      {!inline && <div className={styles.strip} aria-hidden="true" />}
      {/* What the next send answers. Tapping × goes back to commenting on the
          post; pointerdown is swallowed so the keyboard stays up. */}
      {replyingTo && (
        <div className={styles.replyingTo}>
          <span className={styles.replyingToText}>
            Replying to <strong>@{replyingTo}</strong>
          </span>
          <button
            type="button"
            className={styles.replyingToClear}
            aria-label="Cancel reply"
            onPointerDown={(e) => e.preventDefault()}
            onClick={onCancelReply}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}
      <form
        className={styles.bar}
        onSubmit={onSubmit}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && replyingTo) onCancelReply?.();
        }}
      >
        <Avatar
          src={currentUser?.avatar}
          name={currentUser?.displayName}
          size={inline ? '36px' : '38px'}
          disableHover
          className={styles.avatar}
        />
        <div className={styles.field}>
          <MentionInput
            inputRef={inputRef}
            placeholder={replyingTo ? `Reply to @${replyingTo}…` : 'Post your reply...'}
            value={value}
            onChange={onChange}
            onFocus={() => setFocused(true)}
            className={styles.input}
            singleLine={false}
          />
        </div>
        {/* Always mounted: the slot animates open, so there is nothing to
            mount or unmount mid-tap. Not focusable while closed. */}
        <button
          type="submit"
          className={styles.send}
          disabled={!canSend}
          tabIndex={inline || hasText || isPosting ? 0 : -1}
          aria-label={isPosting ? 'Posting reply' : 'Send reply'}
          // Tapping Send must not take focus from the field, or the keyboard
          // drops between the tap and the submit.
          onPointerDown={(e) => e.preventDefault()}
        >
          {inline ? (
            <span className={styles.sendLabel}>{isPosting ? 'Posting…' : 'Reply'}</span>
          ) : (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M22 2 11 13" />
              <path d="M22 2 15 22l-4-9-9-4 20-7Z" />
            </svg>
          )}
        </button>
      </form>
    </div>
  );

  // Inline (wide screens): part of the page, under the post. Otherwise a fixed
  // bar in a portal, as before.
  return inline ? dock : createPortal(dock, document.body);
}
