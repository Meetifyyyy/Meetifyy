/**
 * What the app shows when it opens and nobody is signed in.
 *
 * This is the one screen the app has that the website does not, and the reason
 * is not styling. The website's `/` is a landing page: a marketing surface
 * whose job is to explain Meetifyy to a stranger and persuade them to sign up.
 * Someone opening the app has already been persuaded and has already installed
 * it. Showing them the pitch again is asking them to read an advert for
 * something they own, and it puts the sign-in button below a scroll.
 *
 * So the app replaces that one route and nothing else. Every other screen —
 * login, signup, feed, messages, settings — is the website's own, unchanged.
 *
 * Both buttons route into the existing flows rather than reimplementing them.
 * `/login` and `/signup` are the real screens; this is a front door, not a
 * parallel authentication path.
 */
import { Link } from 'react-router-dom';

import styles from './AppOpenScreen.module.css';

export default function AppOpenScreen() {
  return (
    <div className={styles.wrap}>
      <div>
        <img
          className={styles.logo}
          src="/logo-mark.png"
          alt=""
          /*
           * The same mark the system splash and the launch shell show, so the
           * logo does not change shape as the app takes over from them. No
           * width/height attributes: the size is responsive in CSS, and fixed
           * attributes here would fight it.
           */
          /*
           * Not lazy and not async: this is the first paint of a cold start,
           * and the native splash is being dismissed underneath it. Anything
           * that defers this leaves a blank moment between the two.
           */
          decoding="sync"
        />
        <h1 className={styles.name}>Meetifyy</h1>
      </div>

      <p className={styles.line}>
        Your campus, in one place. Sign in to pick up where you left off.
      </p>

      <div className={styles.actions}>
        {/* `Link`, not a button with navigate(): it is a real anchor, so it
            works with assistive tech and long-press, and needs no handler. */}
        <Link className={styles.primary} to="/login">
          Sign in
        </Link>
        <Link className={styles.secondary} to="/signup">
          Create an account
        </Link>
      </div>

      <p className={styles.legal}>
        By continuing you agree to our <Link to="/terms-and-conditions">Terms</Link> and{' '}
        <Link to="/privacy-policy">Privacy Policy</Link>.
      </p>
    </div>
  );
}
