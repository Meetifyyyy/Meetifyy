import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import authBg from '../assets/images/auth_bg.webp';
import { preloadAuthScreens } from '../features/auth/routes/authRoutes';
import { useSystemBars } from '../shared/hooks/useSystemBars';
import styles from './AppOpenScreen.module.css';

/**
 * The installed app's front door — the screen the native splash hands over to.
 *
 * WHAT IT IS FOR
 * `/` on the website is a landing page: it argues to somebody who has not heard
 * of Meetifyy. Whoever is looking at this has heard of it and installed it, so
 * there is nothing left to argue. The job is to say whose app this is and offer
 * the two doors in the right order of prominence.
 *
 * THE COMPOSITION
 * Editorial, type only. A flat canvas, a thin top rule with two small labels,
 * the name set as large as the width allows, one plain sentence, and two flat
 * buttons. No picture, no glow, no gradient: the size and spacing of the type
 * carry the screen.
 *
 * WHY THE CANVAS IS WHITE / BLACK AND NOT A BRAND GRADIENT
 * `installSystemBars` paints the phone's status and navigation bars with
 * `--color-nav-surface`, which is pure white or pure black. Anything else
 * behind them shows up as two mismatched bands framing the screen. So the
 * canvas is that same colour at the top and bottom edges and the brand colour
 * lives in the middle, where nothing can butt up against it. The seam is
 * impossible by construction rather than by two values being kept in step.
 *
 * MOTION
 * CSS only — no animation library is pulled into the bundle for this. This is
 * the first frame after a cold start, competing with React mounting and the
 * auth check, so everything animated here is `transform` and `opacity` and
 * nothing else; all of it runs on the compositor and the entrance is finished
 * inside 700ms. `prefers-reduced-motion` is honoured in both halves: the
 * stylesheet drops the animations, and `reduceMotion` below drops the exit
 * delay, which CSS cannot reach.
 */

/** Long enough for the exit fade to read, short enough not to feel like a wait. */
const EXIT_MS = 170;

export default function AppOpenScreen() {
  const navigate = useNavigate();
  const [leaving, setLeaving] = useState(false);
  const [splashExited, setSplashExited] = useState(false);

  /**
   * Read once, not subscribed to.
   *
   * What this gates is a 170ms fade on the way out. Somebody changing the OS
   * setting while looking at the front door is not worth a listener on the
   * first screen after launch; the next mount reads it again. `matchMedia` is
   * absent in the jsdom the unit tests run in, hence the guard.
   */
  const reduceMotion = useMemo(
    () =>
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    [],
  );

  /**
   * One navigation, and the screen fades before it happens.
   *
   * The ref rather than the `leaving` state is what actually blocks a second
   * tap: state is applied on the next render, and two taps inside one frame —
   * which a double tap on a touchscreen genuinely is — would both read the old
   * value and both push a route.
   *
   * The timer is cleared on unmount because navigating is precisely what
   * unmounts this component; without it React is asked to set state on a tree
   * that is already gone, every single time somebody leaves this screen.
   */
  const isLeavingRef = useRef(false);
  const exitTimerRef = useRef(0);

  const mountedRef = useRef(true);

  useEffect(
    () => {
      // Effects are replayed in React Strict Mode during development. Restore
      // this flag on every setup so the replay cleanup does not permanently
      // prevent `leaveTo` from navigating after the first tap.
      mountedRef.current = true;
      return () => {
      mountedRef.current = false;
      if (exitTimerRef.current) clearTimeout(exitTimerRef.current);
      };
    },
    [],
  );

  /**
   * Everything Login and Signup need to paint, loaded while this screen is up.
   *
   * Leaving used to navigate first and load after: the auth shell's chunk,
   * then the page's chunk, one after the other, each committing an empty
   * fallback — blank frames between this screen and the next — and then the
   * shell's full-screen background decoding on the way in. Now the chunks are
   * fetched and the background decoded here, and `leaveTo` waits for them, so
   * the next screen's first frame is complete.
   */
  const warmRef = useRef(null);
  const warmAuth = useCallback(() => {
    if (!warmRef.current) {
      const bg = new Image();
      bg.src = authBg;
      warmRef.current = Promise.all([
        preloadAuthScreens(),
        bg.decode ? bg.decode().catch(() => {}) : Promise.resolve(),
      ]);
    }
    return warmRef.current;
  }, []);

  useEffect(() => {
    const idle = window.requestIdleCallback
      // With a timeout: during start-up the WebView is rarely idle, and without
      // one the warm-up could still be pending at the tap (measured: ~300ms of
      // empty canvas between this screen and Login).
      ? window.requestIdleCallback(() => warmAuth(), { timeout: 600 })
      : window.requestAnimationFrame(() => warmAuth());
    return () => (window.cancelIdleCallback ? window.cancelIdleCallback(idle) : window.cancelAnimationFrame(idle));
  }, [warmAuth]);

  /**
   * Runs this one screen edge to edge, with the phone's bars transparent.
   * See `useSystemBars` for how, and why it is a layout effect: the bars must
   * change in the same frame as the screen, not the frame after.
   *
   * The navigation buttons' colour follows the theme, because the screen's
   * canvas is light in one and dark in the other. The native splash is
   * untouched by any of this — it has already finished by the time this
   * component mounts.
   */
  const barIcons = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
  useSystemBars({
    status: 'transparent',
    statusIcons: barIcons,
    navigation: 'transparent',
    navigationIcons: barIcons,
  });

  // On Android, bring this screen in as the native splash starts to fade, so
  // the two crossfade. It used to wait for the fade to END, which left about
  // 300 ms of bare background between the logo and this screen. The "exited"
  // signals stay as fallbacks. In a browser there is no native splash.
  useLayoutEffect(() => {
    const nativeSplashLeaving = () => {
      if (window.__meetifyySplashExiting === true) return true;
      if (window.__meetifyySplashExited === true) return true;
      try {
        return window.sessionStorage.getItem('__meetifyySplashExited') === 'true';
      } catch {
        return false;
      }
    };
    const isNative = typeof window.Capacitor?.isNativePlatform === 'function'
      && window.Capacitor.isNativePlatform();
    if (!isNative || nativeSplashLeaving()) {
      setSplashExited(true);
      return undefined;
    }

    const showOpeningScreen = () => setSplashExited(true);
    window.addEventListener('meetifyy:splash-exiting', showOpeningScreen, { once: true });
    window.addEventListener('meetifyy:splash-exited', showOpeningScreen, { once: true });
    return () => {
      window.removeEventListener('meetifyy:splash-exiting', showOpeningScreen);
      window.removeEventListener('meetifyy:splash-exited', showOpeningScreen);
    };
  }, []);

  const leaveTo = useCallback(
    (path) => {
      if (isLeavingRef.current) return;
      isLeavingRef.current = true;

      // Navigate once the exit animation has played AND the next screen is
      // ready to paint — whichever takes longer. A failed load still leaves:
      // the route's own boundary handles it.
      const animationDone = reduceMotion
        ? Promise.resolve()
        : new Promise((resolve) => {
          setLeaving(true);
          exitTimerRef.current = setTimeout(resolve, EXIT_MS);
        });
      const go = () => {
        if (mountedRef.current) navigate(path, { state: { fromOpenScreen: true } });
      };
      Promise.all([animationDone, warmAuth()]).then(go, go);
    },
    [navigate, reduceMotion, warmAuth],
  );

  const handleSignup = useCallback(() => leaveTo('/signup'), [leaveTo]);
  const handleLogin = useCallback(() => leaveTo('/login'), [leaveTo]);

  return (
    <div
      data-launch-surface
      className={`${styles.screen} ${splashExited ? styles.visible : ''} ${leaving ? styles.leaving : ''}`}
    >
      <div className={styles.content}>
        {/*
          What people actually do here, scrolling slowly. The list is written
          twice so the strip can loop by moving exactly half its width.
        */}
        <div className={styles.ticker} aria-hidden="true">
          <div className={styles.track}>
            {[0, 1].map((copy) => (
              <span key={copy} className={styles.run}>
                {TICKER.map((item) => (
                  <span key={item} className={styles.item}>{item}</span>
                ))}
              </span>
            ))}
          </div>
        </div>

        <div className={styles.hero}>
          {/* Each line sits in its own mask so it can rise into place. */}
          <h1 className={styles.wordmark} aria-label="Meetifyy">
            <span className={styles.mask}><span className={styles.line}>meet</span></span>
            <span className={styles.mask}><span className={`${styles.line} ${styles.line2}`}>ifyy.</span></span>
          </h1>
          <p className={styles.statement}>
            Find your people, plans and circles on campus.
          </p>
        </div>

        <div className={styles.actions}>
          <button
            id="open-screen-signup"
            type="button"
            className={styles.primary}
            onClick={handleSignup}
          >
            Create account
          </button>
          <button
            id="open-screen-login"
            type="button"
            className={styles.secondary}
            onClick={handleLogin}
          >
            Log in
          </button>
        </div>
      </div>
    </div>
  );
}

const TICKER = [
  'Chai after class',
  'Late-night study group',
  'Weekend trek',
  'Hackathon teammates',
  'Football at 6',
  'Open mic night',
];
