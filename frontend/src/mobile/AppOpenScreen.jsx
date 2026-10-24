import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AcademicCapIcon,
  ArrowRightIcon,
  BellIcon,
  BoltIcon,
  CalendarDaysIcon,
  ChatBubbleLeftRightIcon,
  HeartIcon,
  MapPinIcon,
  SparklesIcon,
  UserGroupIcon,
  UsersIcon,
} from '@heroicons/react/24/solid';
import { takeSignupResume } from '../features/auth/signupResume';
import { seedSignupDraft } from '../features/auth/context/SignupContext';
import authBg from '../assets/images/auth_bg.webp';
import grassFriends from '../features/auth/landing/assets/grass-friends.webp';
import friendsLaugh from '../features/auth/landing/assets/friends-laugh.webp';
import holiCrowd from '../features/auth/landing/assets/holi-crowd.webp';
import festPaint from '../features/auth/landing/assets/fest-paint.webp';
import stageLights from '../features/auth/landing/assets/stage-lights.webp';
import concertCrowd from '../features/auth/landing/assets/concert-crowd.webp';
import cricket from '../features/auth/landing/assets/cricket.webp';
import chai from '../features/auth/landing/assets/chai.webp';
import laptopPair from '../features/auth/landing/assets/laptop-pair.webp';
import { preloadAuthScreens } from '../features/auth/routes/authRoutes';
import { useSystemBars } from '../shared/hooks/useSystemBars';
import { useSlidePager } from './openScreenMotion';
import styles from './AppOpenScreen.module.css';

/**
 * The installed app's front door — the screen the native splash hands over to.
 *
 * WHAT IT IS FOR
 * `/` on the website is a landing page: it argues to somebody who has not heard
 * of Meetifyy. Whoever is looking at this has heard of it and installed it, so
 * there is nothing left to argue. The job is to say whose app this is, show
 * what it is like to be in it, and offer the two doors in the right order of
 * prominence.
 *
 * THE COMPOSITION
 * Three slides you swipe between (or jump to with the dots). Each has its own
 * headline with one hand-underlined word, its own sentence, its own fan of
 * three campus photos with a badge on the front one, and its own four tiles:
 * people, events, plans. The dots and the two buttons stay put underneath.
 *
 * There is deliberately no logo here. The native splash has just shown it, and
 * the headline gets the room instead; the name is still on the page for a
 * screen reader.
 *
 * The photos are the same Unsplash set the website's landing page uses.
 *
 * LIGHT AND DARK
 * Both are designed, not inverted: the tokens at the top of the stylesheet are
 * set once per theme. The canvas is `--color-surface-screen` in both, which is
 * the same colour the rest of the app's full-screen pages use, so the hand-over
 * to Login and Signup has no seam. The soft circles behind the content are flat
 * shapes, not gradients or blurs.
 *
 * MOTION
 * CSS only — no animation library is pulled into the bundle for this. The
 * whole screen reads ONE number, `--pg`: how far along the slides you are, 0 to
 * 2, as a decimal. A finger drag writes it directly, so the slides follow the
 * thumb; letting go sets it to a whole number and the stylesheet animates it
 * there (it is a registered property, which is what lets it transition). The
 * track, the parallax on the photos and the three background shapes are all
 * functions of it, so the circles rearrange themselves in step with
 * the slide, whether it is dragged, flicked or tapped.
 *
 * Everything that moves is `transform` or `opacity`. `prefers-reduced-motion`
 * is honoured in both halves: the stylesheet drops the animations and
 * transitions, and `reduceMotion` below drops the exit delay, which CSS cannot
 * reach.
 */

/** Long enough for the exit fade to read, short enough not to feel like a wait. */
const EXIT_MS = 170;
/** How long a slide stays before the screen turns to the next by itself (it loops). */
const AUTO_ADVANCE_MS = 4000;

/** Where a card sits in a slide's fan, by the order its photo is listed. */
const FAN = ['front', 'right', 'left'];

/**
 * `headline` is a list of lines; a plain string is set as written and
 * `{ accent }` is the underlined word. `photos[0]` is the one in front, and
 * `position` is its crop focus: the cards are wider than they are tall, so the
 * faces / the action have to be kept inside it.
 */
const SLIDES = [
  {
    id: 'people',
    headline: [['Find your ', { accent: 'people' }], ['on campus.']],
    sub: 'Join communities, meet classmates and make friends who get your world.',
    badge: 'Meet your people',
    BadgeIcon: UsersIcon,
    photos: [
      { src: grassFriends, position: '50% 45%' },
      { src: friendsLaugh, position: '50% 28%' },
      { src: holiCrowd, position: '50% 40%' },
    ],
    tiles: [
      { label: 'Communities', Icon: UserGroupIcon },
      { label: 'Friends', Icon: UsersIcon },
      { label: 'Chats', Icon: ChatBubbleLeftRightIcon },
      { label: 'Campus', Icon: AcademicCapIcon },
    ],
  },
  {
    id: 'events',
    headline: [['Never miss'], ['what\u2019s ', { accent: 'happening' }, '.']],
    sub: 'Fests, meetups and open mics on your campus, all in one place.',
    badge: 'Catch an event',
    BadgeIcon: CalendarDaysIcon,
    photos: [
      { src: festPaint, position: '50% 30%' },
      { src: stageLights, position: '50% 30%' },
      { src: concertCrowd, position: '50% 58%' },
    ],
    tiles: [
      { label: 'Events', Icon: CalendarDaysIcon },
      { label: 'Fests', Icon: SparklesIcon },
      { label: 'Meetups', Icon: MapPinIcon },
      { label: 'Reminders', Icon: BellIcon },
    ],
  },
  {
    id: 'plans',
    headline: [['Make a ', { accent: 'plan' }, ','], ['bring your crew.']],
    sub: 'Start an activity, invite your crew, or find someone to join in today.',
    badge: 'Join a game',
    BadgeIcon: BoltIcon,
    photos: [
      { src: cricket, position: '42% 50%' },
      { src: chai, position: '50% 55%' },
      { src: laptopPair, position: '40% 35%' },
    ],
    tiles: [
      { label: 'Activities', Icon: BoltIcon },
      { label: 'Crews', Icon: UserGroupIcon },
      { label: 'Match', Icon: HeartIcon },
      { label: 'Chat', Icon: ChatBubbleLeftRightIcon },
    ],
  },
];

export default function AppOpenScreen() {
  const navigate = useNavigate();
  const [leaving, setLeaving] = useState(false);
  const [splashExited, setSplashExited] = useState(false);
  // Slides that have been shown: their underline stays drawn once it has been.
  const [seen, setSeen] = useState(() => SLIDES.map((_, i) => i === 0));

  // Android killed the app while it was in the background mid-signup (the
  // browser for the Terms, the mail app for the code): put the person back on
  // their step with their non-sensitive answers. Once, and only when fresh.
  useEffect(() => {
    const saved = takeSignupResume();
    if (!saved) return;
    seedSignupDraft(saved);
    navigate(`/signup?step=${saved.step}`, { replace: true });
  }, [navigate]);

  /**
   * Read once, not subscribed to.
   *
   * What this gates is a 170ms fade on the way out.
   * Somebody changing the OS setting while looking at the front door is not
   * worth a listener on the first screen after launch; the next mount reads it
   * again. `matchMedia` is absent in the jsdom the unit tests run in, hence the
   * guard.
   */
  const reduceMotion = useMemo(
    () =>
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    [],
  );

  /** The slide motion: see `openScreenMotion.js` for why it is JavaScript. */
  const markSeen = useCallback((next) => {
    setSeen((prev) => (prev[next] ? prev : prev.map((v, i) => v || i === next)));
  }, []);
  const pager = useSlidePager({
    count: SLIDES.length,
    reduceMotion,
    onTarget: markSeen,
    autoAdvanceMs: AUTO_ADVANCE_MS,
  });
  const active = pager.index;

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
    // Landscape: run under the camera cutout / side navigation bar too.
    sides: 'transparent',
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
      ref={pager.rootRef}
      data-launch-surface
      className={`${styles.screen} ${splashExited ? styles.visible : ''} ${leaving ? styles.leaving : ''}`}
    >
      {/*
        Three flat circles behind everything; decorative, so out of the a11y
        tree. Placed and moved from JavaScript (openScreenMotion.js).
      */}
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          ref={(el) => pager.registerCircle(i, el)}
          className={styles.blob}
          aria-hidden="true"
        />
      ))}

      <div className={styles.content}>
        <h1 className={styles.srOnly}>Meetifyy</h1>

        <div
          ref={pager.viewportRef}
          className={`${styles.pager} ${styles.enter}`}
          style={{ '--d': '0ms' }}
          {...pager.handlers}
        >
          <div ref={pager.trackRef} className={styles.track}>
            {SLIDES.map((slide, n) => (
              <Slide
                key={slide.id}
                slide={slide}
                n={n}
                seen={seen[n]}
                hidden={n !== active}
                registerStage={pager.registerStage}
              />
            ))}
          </div>
        </div>

        <div className={styles.footer}>
          <div className={`${styles.dots} ${styles.enter}`} style={{ '--d': '120ms' }}>
            {SLIDES.map((slide, index) => (
              <button
                key={slide.id}
                type="button"
                className={`${styles.dot} ${index === active ? styles.dotOn : ''}`}
                aria-label={`Show slide ${index + 1} of ${SLIDES.length}: ${slide.badge}`}
                aria-current={index === active ? 'true' : undefined}
                onClick={() => pager.goTo(index)}
              />
            ))}
          </div>

          <div className={`${styles.actions} ${styles.enter}`} style={{ '--d': '180ms' }}>
            <button
              id="open-screen-signup"
              type="button"
              className={styles.primary}
              onClick={handleSignup}
            >
              Create your account
              <ArrowRightIcon className={styles.arrow} aria-hidden="true" />
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
    </div>
  );
}

/**
 * One slide. Memoised: changing slide re-renders only the two whose
 * `hidden` or `seen` changed, not all three panels and their photos, in the
 * frame the motion starts.
 */
const Slide = memo(function Slide({ slide, n, seen, hidden, registerStage }) {
  const stageRef = useCallback((el) => registerStage(n, el), [registerStage, n]);
  return (
    <section
      className={`${styles.panel} ${seen ? styles.seen : ''}`}
      aria-roledescription="slide"
      aria-label={`${n + 1} of ${SLIDES.length}`}
      aria-hidden={hidden ? 'true' : undefined}
    >
      <div className={styles.copy}>
        <h2 className={styles.headline}>
          {slide.headline.map((line) => (
            <span key={line.map((part) => part.accent ?? part).join('')} className={styles.headlineLine}>
              {line.map((part) => (typeof part === 'string' ? part : (
                <span key={part.accent} className={styles.accent}>
                  {part.accent}
                  <svg
                    className={styles.underline}
                    viewBox="0 0 200 14"
                    preserveAspectRatio="none"
                    aria-hidden="true"
                    focusable="false"
                  >
                    <path
                      d="M3 9.5C38 3 82 12.5 122 6.5C150 2.5 178 5.5 197 8.5"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="4"
                      strokeLinecap="round"
                      vectorEffect="non-scaling-stroke"
                    />
                  </svg>
                </span>
              )))}
            </span>
          ))}
        </h2>
        <p className={styles.sub}>{slide.sub}</p>
      </div>

      <div ref={stageRef} className={styles.stage}>
        {slide.photos.map((photo, i) => (
          <div key={photo.src} className={`${styles.card} ${styles[FAN[i]]}`}>
            <div className={styles.photo}>
              <img
                src={photo.src}
                alt=""
                decoding="async"
                draggable="false"
                style={{ objectPosition: photo.position }}
              />
            </div>
            {i === 0 && (
              <span className={styles.badge}>
                <slide.BadgeIcon className={styles.badgeIcon} aria-hidden="true" />
                {slide.badge}
              </span>
            )}
          </div>
        ))}
      </div>

      <ul className={styles.tiles}>
        {slide.tiles.map(({ label, Icon }) => (
          <li key={label} className={styles.tile}>
            <Icon className={styles.tileIcon} aria-hidden="true" />
            <span className={styles.tileLabel}>{label}</span>
          </li>
        ))}
      </ul>
    </section>
  );
});
