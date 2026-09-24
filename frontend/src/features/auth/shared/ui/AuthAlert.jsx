import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertCircle, AlertTriangle, CheckCircle2, Info, X } from '@shared/components/icons';
import s from './authKit.module.css';

const ICONS = { error: AlertCircle, warning: AlertTriangle, success: CheckCircle2, info: Info };
const TONES = { error: s.alertError, warning: s.alertWarning, success: s.alertSuccess, info: s.alertInfo };

/**
 * The one form-level message on every auth screen (server errors, notices).
 *
 * Rendered OUTSIDE the auth card: a fixed notice portalled to <body>, so it
 * can never change the card's size. Bottom-right on large screens, bottom on
 * phones. Field-level errors still live in each field's message slot.
 *
 * The last message is kept while the notice animates out, so it does not go
 * blank mid-fade. Dismissing hides it until the message (or `nonce`) changes.
 *
 * @param {'error'|'warning'|'success'|'info'} [tone]
 * @param {string} [title]          short bold line above the message
 * @param {number} [autoHideMs]     close by itself after this long; a thin bar
 *                                  counts it down, and hovering pauses it
 * @param {number|string} [nonce]   change it to re-show the same message (a
 *                                  retry that fails the same way again)
 * @param {React.ReactNode} [children]  nothing → hidden
 */
export default function AuthAlert({ tone = 'error', title, autoHideMs = 0, nonce, children }) {
  const hasMessage = children != null && children !== false && children !== '';
  const [dismissed, setDismissed] = useState(false);
  const lastRef = useRef({ tone, title, children });

  // A new message, or the same one raised again, is shown again.
  useEffect(() => {
    setDismissed(false);
  }, [children, nonce]);

  const open = hasMessage && !dismissed;
  if (hasMessage) lastRef.current = { tone, title, children };
  const shown = lastRef.current;
  const Icon = ICONS[shown.tone] || AlertCircle;

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div className={`${s.alertDock} ${open ? s.alertDockOpen : ''}`}>
      <div
        className={`${s.alert} ${s.alertCard} ${TONES[shown.tone] || ''}`}
        role={shown.tone === 'error' || shown.tone === 'warning' ? 'alert' : 'status'}
        aria-hidden={open ? undefined : true}
      >
        {shown.children ? (
          <>
            <span className={s.alertBadge} aria-hidden="true">
              <Icon size={17} />
            </span>
            <div className={s.alertBody}>
              {shown.title ? <p className={s.alertTitle}>{shown.title}</p> : null}
              <div className={s.alertText}>{shown.children}</div>
            </div>
            <button
              type="button"
              className={s.alertClose}
              onClick={() => setDismissed(true)}
              aria-label="Dismiss"
              tabIndex={open ? 0 : -1}
            >
              <X size={15} aria-hidden="true" />
            </button>
            {/*
              The countdown IS the timer: when the bar's shrink animation ends,
              the notice closes. Hover pauses the animation, and so the timer.
              Keyed so every new message restarts it from full.
            */}
            {autoHideMs > 0 && open ? (
              <span
                key={`${String(nonce)}:${String(children)}`}
                className={s.alertCountdown}
                style={{ animationDuration: `${autoHideMs}ms` }}
                onAnimationEnd={() => setDismissed(true)}
                aria-hidden="true"
              />
            ) : null}
          </>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}
