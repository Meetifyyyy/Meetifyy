import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import {
  CheckCircle2,
  MessageSquare,
  Calendar,
  Users,
  Search,
} from '@shared/components/icons';
import { resolveVerificationCelebration } from '@shared/lib/verificationCelebration';
import styles from './VerifiedWelcome.module.css';

/** Per-account record of the last verification status this browser observed. */
const STORAGE_PREFIX = 'meetifyy:verification-seen:';

const BENEFITS = [
  {
    Icon: MessageSquare,
    title: 'Message anyone on campus',
    body: 'Start conversations and reply to people who message you.',
  },
  {
    Icon: Calendar,
    title: 'Discover campus events',
    body: 'See what your campus is running, and turn up to the ones you like.',
  },
  {
    Icon: Users,
    title: 'Explore communities',
    body: 'Join the groups built around what you actually care about.',
  },
  {
    Icon: Search,
    title: 'Browse the student directory',
    body: 'Find people from your course, branch and year.',
  },
];

/**
 * Shown once, immediately after an account becomes verified.
 *
 * The decision of WHEN to show it lives in
 * `@shared/lib/verificationCelebration` — it is the only part with real logic
 * and it is worth testing on its own. In short: it fires on the transition into
 * VERIFIED, never on merely being verified, so existing verified accounts are
 * not congratulated retroactively.
 *
 * The status itself comes from the server via the auth sync; nothing here
 * decides whether an account is verified.
 */
export default function VerifiedWelcome() {
  const { currentUser } = useAuth();
  const [open, setOpen] = useState(false);

  const userId = currentUser?.id;
  const status = currentUser?.verificationStatus;

  useEffect(() => {
    if (!userId || !status) return;

    const key = `${STORAGE_PREFIX}${userId}`;
    let previous = null;
    try {
      previous = localStorage.getItem(key);
    } catch {
      // Private mode or blocked storage. Without a previous value there is no
      // transition to detect, so the modal stays closed — silence is the right
      // failure mode for a congratulation.
      return;
    }

    const { celebrate, nextStored } = resolveVerificationCelebration(
      previous,
      status,
    );
    if (celebrate) setOpen(true);

    // Recorded on every change, including the very first observation. That
    // first write is what stops an already-verified account being
    // congratulated retroactively.
    if (nextStored) {
      try {
        localStorage.setItem(key, nextStored);
      } catch {
        /* nothing to do; the modal simply will not fire next time */
      }
    }
  }, [userId, status]);

  const dismiss = useCallback(() => setOpen(false), []);

  // Escape closes, matching every other dialog in the app.
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') dismiss();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, dismiss]);

  if (!open) return null;

  return (
    <div
      className={styles.backdrop}
      onClick={dismiss}
      role="dialog"
      aria-modal="true"
      aria-labelledby="verified-welcome-title"
    >
      <div className={styles.card} onClick={(e) => e.stopPropagation()}>
        <div className={styles.badge} aria-hidden="true">
          <CheckCircle2 size={30} />
        </div>

        <h2 id="verified-welcome-title" className={styles.title}>
          Your account has been verified
        </h2>
        <p className={styles.subtitle}>
          You now have full access to Meetifyy. Here&apos;s what just opened up.
        </p>

        <ul className={styles.benefits}>
          {BENEFITS.map(({ Icon, title, body }) => (
            <li key={title} className={styles.benefit}>
              <span className={styles.benefitIcon} aria-hidden="true">
                <Icon size={17} />
              </span>
              <span>
                <span className={styles.benefitTitle}>{title}</span>
                <span className={styles.benefitBody}>{body}</span>
              </span>
            </li>
          ))}
        </ul>

        <button
          type="button"
          className={styles.primaryBtn}
          onClick={dismiss}
          autoFocus
        >
          Continue
        </button>
      </div>
    </div>
  );
}

