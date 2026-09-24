import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check } from '@shared/components/icons';
import Avatar from '@shared/components/avatar/Avatar';
import { useAuth } from '@shared/context/AuthContext';
import { useSignup } from '../../context/SignupContext';
import { styles as s } from '../../shared/ui';

const MESSAGES = ['Creating your profile', 'Wait a moment', 'Almost done'];
const MESSAGE_MS = 1100;
// Every message is shown at least once, even when the server was quicker.
const MIN_VISIBLE_MS = MESSAGE_MS * MESSAGES.length;
const DONE_HOLD_MS = 700;
const SLOW_AFTER_MS = 15000;

/**
 * The last screen of signup: finishes the account, then moves into the app.
 *
 * Always runs its three messages, and then keeps spinning on the last one for
 * as long as `completeSignup` is still out — it does not navigate on a timer.
 * The request used to be fire-and-forget beside an immediate redirect; now the
 * person sees it finish. A failure is logged and the flow still continues,
 * exactly as before: the account already exists and is usable once the code
 * was verified, and these are its finishing touches (avatar, welcome email).
 *
 * @param {{ avatar: string }} props
 */
export default function SignupFinishing({ avatar }) {
  const { completeSignup } = useAuth();
  const { clearSignupData } = useSignup();
  const navigate = useNavigate();

  const [index, setIndex] = useState(0);
  const [done, setDone] = useState(false);
  const [slow, setSlow] = useState(false);
  const startedRef = useRef(false);

  // Cycle the messages, stopping on the last one.
  useEffect(() => {
    if (done || index >= MESSAGES.length - 1) return undefined;
    const t = setTimeout(() => setIndex((i) => i + 1), MESSAGE_MS);
    return () => clearTimeout(t);
  }, [index, done]);

  /*
   * Latest callbacks through a ref, and the work started from an effect with
   * no dependencies. `clearSignupData` is a new function on every render; as a
   * dependency it re-ran the effect, whose cleanup marked the first run dead,
   * and the guard below then refused a second run — so nothing ever navigated.
   */
  const latest = useRef({ completeSignup, clearSignupData, navigate, avatar });
  latest.current = { completeSignup, clearSignupData, navigate, avatar };
  const mountedRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    // Once, including under StrictMode's double effect: a second call would
    // send the welcome email twice.
    if (startedRef.current) return;
    startedRef.current = true;

    const minDelay = new Promise((r) => setTimeout(r, MIN_VISIBLE_MS));
    const work = Promise.resolve()
      .then(() => latest.current.completeSignup({ avatar: latest.current.avatar }))
      .catch((err) => console.error('Failed to finish signup:', err));
    const slowTimer = setTimeout(() => mountedRef.current && setSlow(true), SLOW_AFTER_MS);

    Promise.all([work, minDelay]).then(() => {
      clearTimeout(slowTimer);
      if (!mountedRef.current) return;
      setDone(true);
      setTimeout(() => {
        if (!mountedRef.current) return;
        latest.current.clearSignupData();
        latest.current.navigate('/home', { replace: true });
      }, DONE_HOLD_MS);
    });
  }, []);

  const label = done ? "You're in" : MESSAGES[index];

  return (
    <div className={s.finish} role="status" aria-live="polite" aria-busy={!done}>
      <div className={`${s.finishOrb} ${done ? s.finishOrbDone : ''}`}>
        <span className={s.finishRing} aria-hidden="true" />
        <span className={s.finishAvatar}>
          {done ? (
            <Check size={34} strokeWidth={2.4} aria-hidden="true" />
          ) : (
            <Avatar src={avatar || null} size="100%" />
          )}
        </span>
      </div>

      {/* Keyed so each message fades in; the box keeps one fixed line height. */}
      <p className={s.finishTitle}>
        <span key={label} className={s.finishTitleText}>
          {label}
          {!done ? <span className={s.finishDots} aria-hidden="true" /> : null}
        </span>
      </p>
      <p className={s.finishSub}>
        {done
          ? 'Taking you to Meetifyy.'
          : slow
            ? 'This is taking longer than usual. Keep this page open.'
            : 'Setting up your campus, circles and feed.'}
      </p>

      <div className={s.finishSteps} aria-hidden="true">
        {MESSAGES.map((m, i) => (
          <span
            key={m}
            className={`${s.finishPip} ${done || i < index ? s.finishPipDone : ''} ${!done && i === index ? s.finishPipActive : ''}`}
          />
        ))}
      </div>
    </div>
  );
}
