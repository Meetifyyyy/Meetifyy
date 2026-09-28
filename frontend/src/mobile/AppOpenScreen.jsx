import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import mascot from '../assets/images/mascot.webp';
import authBg from '../assets/images/auth_bg.webp';
import { preloadAuthScreens } from '../features/auth/routes/authRoutes';
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
 * One centred column, and two objects in it:
 *
 *     the shape           an organic brand-gradient blob, with the mascot
 *                         centred inside it
 *     type and buttons    plain, centred, undecorated
 *
 * There is nothing else. Earlier versions of this screen put a wordmark capsule
 * on the shape, then labelled chips and hand-drawn marks around it, then a
 * layer of rings and dot fields behind it. Each addition gave the eye another
 * thing to land on before it reached the character or the buttons. What is left
 * is the character, the sentence and the choice — which is the whole job.
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
   *
   * An attribute on <html> rather than a call into the native layer, because
   * the colour already travels that way: `installSystemBars` reads
   * `--color-nav-surface` and pushes it to the plugin, and the stylesheet
   * redefines that variable while the attribute is set. So this is one DOM
   * write, no plugin import in a screen component, and nothing to keep in step
   * with the palette.
   *
   * Removed on unmount, not left behind: every other screen has an opaque
   * status bar sitting above its header, and a transparent one there would put
   * the clock on top of the header's own content. `installSystemBars` watches
   * this attribute as well as `data-theme`, so the removal repaints the bars on
   * the way out the same way the addition painted them on the way in.
   *
   * The native splash is untouched by any of this — it has already finished by
   * the time this component mounts.
   */
  useLayoutEffect(() => {
    const root = document.documentElement;
    const previousIconPreference = root.getAttribute('data-status-bar-icons');
    const previousNavigationBar = root.getAttribute('data-navigation-bar');
    const previousNavigationIcons = root.getAttribute('data-navigation-bar-icons');
    const navigationIcons = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    root.setAttribute('data-bars', 'transparent');
    root.setAttribute('data-status-bar-icons', 'dark');
    root.setAttribute('data-navigation-bar', 'transparent');
    root.setAttribute('data-navigation-bar-icons', navigationIcons);
    return () => {
      root.removeAttribute('data-bars');
      if (previousNavigationBar === null) root.removeAttribute('data-navigation-bar');
      else root.setAttribute('data-navigation-bar', previousNavigationBar);
      if (previousNavigationIcons === null) root.removeAttribute('data-navigation-bar-icons');
      else root.setAttribute('data-navigation-bar-icons', previousNavigationIcons);
      if (previousIconPreference === null) root.removeAttribute('data-status-bar-icons');
      else root.setAttribute('data-status-bar-icons', previousIconPreference);
    };
  }, []);

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
      {/* Brand light. No content — nothing here is read or tapped. */}
      <div className={styles.canvas} aria-hidden="true">
        <span className={styles.auraBrand} />
        <span className={styles.auraBlue} />
      </div>

      <div className={styles.content}>
        {/*
          The scene.

          `.stageInner` is held square by width — see the stylesheet — and every
          piece inside is placed as a percentage of that square, which is what
          makes the arrangement identical on a small phone, a tall phone and a
          tablet with no breakpoint arbitrating.
        */}
        <div className={styles.stage} aria-hidden="true">
          <div className={styles.stageInner}>
            <svg className={styles.blob} viewBox="0 0 200 200" aria-hidden="true">
              <defs>
                {/*
                  The wordmark's own gradient, extended.

                  `meetifyy_wordmark.svg` fills its two Y glyphs with
                  #00C3FF -> #0022FF. Starting from brand violet and passing
                  through both of those is what makes this shape read as
                  Meetifyy's rather than as a nice blue.
                */}
                <linearGradient id="meetifyyBlob" x1="12%" y1="4%" x2="88%" y2="96%">
                  <stop offset="0%" stopColor="#7C5CFF" />
                  <stop offset="38%" stopColor="#4B6BFF" />
                  <stop offset="72%" stopColor="#1183FF" />
                  <stop offset="100%" stopColor="#00C3FF" />
                </linearGradient>

                {/*
                  The shadow belongs to the PATH, not to the <svg> element.

                  As a CSS `filter: drop-shadow()` on the <svg>, Chrome takes
                  the element's own box as the filter input, so the alpha mask
                  is the 200x200 viewport rather than the blob — and the shape
                  cast a soft rectangle across the screen instead of a shadow.
                  `feDropShadow` inside the SVG reads the path's alpha, which is
                  the outline, so the shadow has the blob's shape.

                  The region is generous on purpose: the default is
                  -10%/120% and a stdDeviation of 9 in viewBox units would be
                  clipped square by it, which is the same bug in a new place.
                */}
                <filter
                  id="meetifyyBlobShadow"
                  x="-30%"
                  y="-30%"
                  width="160%"
                  height="170%"
                >
                  <feDropShadow
                    className={styles.blobShadow}
                    dx="0"
                    dy="9"
                    stdDeviation="9"
                  />
                </filter>
              </defs>
              <path
                d="M101 5c26-2 49 11 61 32 12 20 8 42 17 59 9 17 10 38-6 52-17 15-45 9-68 14-24 5-49 12-68-3C18 144 9 120 7 98 5 74 16 52 32 36 47 20 75 7 101 5Z"
                fill="url(#meetifyyBlob)"
                filter="url(#meetifyyBlobShadow)"
              />
            </svg>

            {/* Centred in the shape, not hanging off its edge. */}
            <img
              src={mascot}
              alt=""
              className={styles.mascot}
              loading="eager"
              decoding="sync"
            />
          </div>
        </div>

        {/* Everything below the scene is plain and centred, on purpose. */}
        <div className={styles.copy}>
          <h1 className={styles.headline}>
            Where your campus
            <br />
            <span className={styles.accent}>hangs out.</span>
          </h1>
          <p className={styles.subline}>
            Join verified students, find your circles, and never miss what is
            happening on campus.
          </p>
        </div>

        <div className={styles.actions}>
          {/*
            Stacked, primary first. Both are full width, so nothing about the
            geometry ranks them — the violet fill is the brand asking, and the
            solid inverse below it is just a control. Two outlined pills, or two
            of equal colour weight, would have turned the front door into a
            question.
          */}
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
            className={styles.ghost}
            onClick={handleLogin}
          >
            Log in
          </button>
        </div>
      </div>
    </div>
  );
}
