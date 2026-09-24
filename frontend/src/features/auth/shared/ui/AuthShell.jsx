import { createContext, Fragment, memo, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ArrowLeft, Check } from '@shared/components/icons';
import wordmark from '@assets/images/meetifyy_wordmark.svg';
import wordmarkDark from '@assets/images/meetifyy_wordmark_dark.svg';
import proofCards from '@assets/images/auth_proof_cards.webp';
import authBg from '@assets/images/auth_bg.webp';
import { SIGNUP_STEPS } from './signupSteps';
import { AUTH_STORIES } from './authStories';
import s from './authKit.module.css';

const DEFAULT_HEADLINE = "Your campus,\n*finally connected.*";
const DEFAULT_SUBTEXT = 'Meetifyy is where verified students meet, plan, and belong.';

const AuthShellContext = createContext(null);

/** Order along the natural auth path, for the direction of the page slide. */
const ROUTE_ORDER = Object.freeze({
  '/login': 0,
  '/signup': 1,
  '/forgot-password': 1,
  '/reset-password': 2,
});

/**
 * The shared canvas for every auth screen: a full-bleed brand
 * gradient with a decorative story column drifting on the left and a
 * floating form panel offset to the right, slightly overlapping it — an
 * asymmetric composition instead of a hard two-panel split. The panel is
 * always vertically centered in the viewport and smoothly animates to its
 * new size/position whenever its content changes height (step switches,
 * status screens, validation messages appearing, or route navigation between
 * auth pages). Auth always renders in the light palette regardless of the app's theme.
 *
 * @param {string}  [headline]     Story headline. Wrap a phrase in *asterisks* to gradient-highlight it.
 * @param {string}  [subtext]      Story supporting line.
 * @param {boolean} [showStory]    false hides the story column.
 * @param {Function|false} [onBack] Phones only: shows a back button top-left in
 *                                 place of the wordmark, calling this. `false`
 *                                 means a bare header: no back, no exit link.
 * Phones also slide pages horizontally on route changes, forward or back by
 * ROUTE_ORDER (see below).
 * @param {{current:number,total:number}} [progress]  Phones only: a progress
 *                                 bar in the header, right of the back button.
 * @param {boolean} [holdSize]     Signup only: keep the card at the size it had
 *                                 on step 1 (the finishing screen uses this).
 * @param {number}  [railStep]     Signup only: the current step, which replaces
 *                                 the story column with the named step rail.
 */
export default function AuthShell({
  children,
  headline = DEFAULT_HEADLINE,
  subtext = DEFAULT_SUBTEXT,
  showStory = true,
  railStep = null,
  holdSize = false,
  railLeaving = false,
  onBack = null,
  progressCurrent = null,
  progressTotal = null,
}) {
  const parentContext = useContext(AuthShellContext);

  // The back handler goes up through a ref, not through state: it is a new
  // function on most renders, and it only needs to be current when tapped.
  useLayoutEffect(() => {
    if (!parentContext) return undefined;
    parentContext.setBack(onBack);
    return () => parentContext.setBack(null);
  }, [parentContext, onBack]);

  // When nested inside a shared master (route group sharing one AuthShell
  // instance), forward this page's story copy up instead of rendering our
  // own canvas — the master owns the actual DOM/animation.
  useLayoutEffect(() => {
    if (parentContext) parentContext.setStory({
      headline, subtext, showStory, railStep, holdSize, railLeaving, progressCurrent, progressTotal,
    });
  }, [parentContext, headline, subtext, showStory, railStep, holdSize, railLeaving, progressCurrent, progressTotal]);

  if (parentContext) {
    return <>{children}</>;
  }

  return (
    <AuthShellMaster headline={headline} subtext={subtext} showStory={showStory} railStep={railStep} holdSize={holdSize} railLeaving={railLeaving}>
      {children}
    </AuthShellMaster>
  );
}

const StoryColumn = memo(function StoryColumn({ headline = DEFAULT_HEADLINE, subtext = DEFAULT_SUBTEXT }) {
  const headlineLines = headline.split('\n');
  return (
    <aside className={s.story}>
      <span className={s.storyMark} aria-hidden="true" />
      <div className={s.storyHeader}>
        <h2 className={s.storyHeadline}>
          {headlineLines.map((line, i) => (
            <Fragment key={i}>
              {renderHighlighted(line)}
              {i < headlineLines.length - 1 ? <br /> : null}
            </Fragment>
          ))}
        </h2>
        <p className={s.storySub}>{subtext}</p>
      </div>
      <img src={proofCards} alt="" width={1100} height={779} decoding="async" className={s.proofCards} aria-hidden="true" />
    </aside>
  );
});

/**
 * The signup counterpart of the story column: every step by name, so the
 * person can see the whole journey and how much is left. A finished step gets
 * a check, the current one a filled marker, and the connector fills in behind
 * them. Wide screens only; narrow ones get the compact StepProgress track.
 */
const SignupRail = memo(function SignupRail({ current, leaving = false }) {
  return (
    <aside className={`${s.rail} ${leaving ? s.railLeaving : ''}`} aria-label="Signup steps">
      <p className={s.railEyebrow}>Create your account</p>
      <h2 className={s.railTitle}>
        Join your <em>campus.</em>
      </h2>
      <ol className={s.railList}>
        {SIGNUP_STEPS.map((step, i) => {
          const n = i + 1;
          const state = n < current ? 'done' : n === current ? 'current' : 'todo';
          return (
            <li
              key={step.title}
              className={`${s.railItem} ${s[`railItem_${state}`]}`}
              aria-current={state === 'current' ? 'step' : undefined}
            >
              <span className={s.railDot} aria-hidden="true">
                {state === 'done' ? <Check size={13} strokeWidth={2.6} /> : n}
              </span>
              <span className={s.railText}>
                <span className={s.railStepTitle}>{step.title}</span>
                <span className={s.railStepCaption}>{step.caption}</span>
              </span>
              <span className={s.srOnly}>
                {state === 'done' ? ' (done)' : state === 'current' ? ' (current step)' : ''}
              </span>
            </li>
          );
        })}
      </ol>
      <p className={s.railFoot}>About two minutes. Verified students only; your college email is never shown to others.</p>
    </aside>
  );
});

function AuthShellMaster({
  children,
  headline: defaultHeadline,
  subtext: defaultSubtext,
  showStory: defaultShowStory = true,
  railStep: defaultRailStep = null,
  holdSize: defaultHoldSize = false,
  railLeaving: defaultRailLeaving = false,
}) {
  /*
   * The path, not the full location: a query string or a hash changing (the
   * reset link carries both) must not restart the content fade, because the
   * page behind it has not changed.
   */
  const location = useLocation();
  const routeKey = location.pathname;
  const isSignup = routeKey.startsWith('/signup');
  const isLogin = routeKey === '/login';
  const panelInnerRef = useRef(null);
  /*
   * Starts as null, not as the last mount's height.
   *
   * This used to be seeded from a module-level `globalLastPanelHeight` so a
   * remount would not open from zero. What it actually did was open every
   * screen at the PREVIOUS screen's height and then correct it a frame later —
   * a jump, on the first frame, every time. The layout effect below measures
   * before the first paint, so there is nothing to seed: null simply means
   * "not measured yet", and the panel is sized correctly by the time anyone
   * sees it.
   */
  const [panelHeight, setPanelHeight] = useState(null);
  const [isInitialMount, setIsInitialMount] = useState(true);
  const [story, setStory] = useState({
    headline: defaultHeadline,
    subtext: defaultSubtext,
    showStory: defaultShowStory,
    railStep: defaultRailStep,
    holdSize: defaultHoldSize,
    railLeaving: defaultRailLeaving,
  });

  /*
   * A page's reported story is tagged with the path it was reported on. Until
   * the page for the CURRENT path has reported (its lazy chunk may still be
   * loading), the copy for this path comes from AUTH_STORIES instead of from
   * whatever was last set, so the first frame already carries the right words.
   */
  const routeRef = useRef(routeKey);
  routeRef.current = routeKey;
  const setStoryCallback = useCallback(
    (next) => setStory((prev) => ({ ...prev, ...next, reportedFor: routeRef.current })),
    [],
  );
  const backRef = useRef(null);
  // true: back button; 'bare': no back and no exit link; false: default header.
  const [hasBack, setHasBack] = useState(false);
  const setBack = useCallback((fn) => {
    backRef.current = typeof fn === 'function' ? fn : null;
    setHasBack(fn === false ? 'bare' : !!backRef.current);
  }, []);

  /*
   * Direction of the page slide on phones. Pages further along the natural
   * path slide in from the right; going back towards login slides in from
   * the left. Decided once per route change, during render, from the path we
   * are leaving; the panelSwap below is keyed by route, so each page mounts
   * once with its direction.
   */
  const prevRouteRef = useRef(routeKey);
  const slideDirRef = useRef('fwd');
  if (prevRouteRef.current !== routeKey) {
    const from = ROUTE_ORDER[prevRouteRef.current] ?? 0;
    const to = ROUTE_ORDER[routeKey] ?? 0;
    slideDirRef.current = to >= from ? 'fwd' : 'back';
    prevRouteRef.current = routeKey;
  }
  const contextValue = useMemo(
    () => ({ setStory: setStoryCallback, setBack }),
    [setStoryCallback, setBack],
  );

  useLayoutEffect(() => {
    const html = document.documentElement;
    const body = document.body;
    const prevHtmlBg = html.style.background;
    const prevBodyBg = body.style.background;

    html.style.setProperty('--auth-bg', `url(${authBg})`);
    html.classList.add('auth-canvas-active');
    body.classList.add('auth-canvas-active');

    return () => {
      html.classList.remove('auth-canvas-active');
      body.classList.remove('auth-canvas-active');
      html.style.removeProperty('--auth-bg');
      html.style.background = prevHtmlBg;
      body.style.background = prevBodyBg;
    };
  }, []);

  /*
   * Warm the sibling auth pages. Each is a lazy route under a Suspense with no
   * fallback, so the first visit to one used to empty the panel for the length
   * of a chunk download: the card collapsed to its padding and then grew back.
   * Fetching them while the user is still reading this page makes every
   * switch between login, signup and forgot-password synchronous.
   */
  useEffect(() => {
    const warm = () => {
      import('../../pages/LoginPage');
      import('../../pages/SignupPage');
      import('../../pages/ForgotPasswordPage');
    };
    if (typeof window.requestIdleCallback === 'function') {
      const id = window.requestIdleCallback(warm, { timeout: 2000 });
      return () => window.cancelIdleCallback?.(id);
    }
    const id = setTimeout(warm, 600);
    return () => clearTimeout(id);
  }, []);

  /**
   * ── Measured ONCE, then only when the height really changes ───────────────
   *
   * WHAT THIS REPLACED, AND WHY IT WAS SLOW
   * There used to be a `useLayoutEffect` with NO dependency array here that
   * called `getBoundingClientRect()` and then `setPanelHeight()`
   * unconditionally, so it ran after every single commit. Three things followed
   * from that, and together they are the whole of the lag:
   *
   *   1. A render loop. Setting state from inside a dependency-less layout
   *      effect schedules another render, whose layout effect measures and sets
   *      state again. React only bails out when the value is `Object.is`-equal,
   *      and `getBoundingClientRect().height` is a float that moves by
   *      fractions of a pixel — so it often did not bail out, and each pass
   *      cost a synchronous layout of the whole panel.
   *   2. A forced layout on every keystroke. Typing in a field is a state
   *      change, so the effect read geometry once per character, before the
   *      browser could batch anything. That is the most expensive thing a form
   *      can do on a low-end phone.
   *   3. It defeated the ResizeObserver's own threshold below, because the
   *      unconditional path had no threshold at all.
   *
   * WHAT IT DOES NOW
   * One synchronous measurement before the first paint, so the panel opens at
   * the right size instead of starting from zero; after that the
   * ResizeObserver is the only thing that can change the height, which is the
   * correct tool — it already fires for every content change that matters: a
   * signup step switching, a validation message appearing, a route swapping the
   * panel's children.
   *
   * The observer reads `borderBoxSize` off the entry rather than calling
   * `getBoundingClientRect()` on the element again. The size is already in the
   * entry, and re-measuring from inside an observation callback forces another
   * layout in the middle of the same frame — which is what produces
   * "ResizeObserver loop completed with undelivered notifications".
   *
   * `lastHeightRef`, not the state value, is what the threshold compares
   * against: state is a snapshot from the last render, so comparing against it
   * lets a run of sub-threshold changes accumulate into one visible jump.
   */
  const lastHeightRef = useRef(null);
  // Tallest measured height of the card on signup step 1 (see holdSize).
  const step1HeightRef = useRef(null);
  const onStep1Ref = useRef(false);

  const commitHeight = useCallback((h) => {
    if (!Number.isFinite(h) || h <= 0) return;
    /*
     * 1px, not the 3px this used to use. Three was wide enough that a change
     * just under it was held back and then released along with the next one,
     * which read as a jolt; a pixel is below what anyone can see and still
     * excludes sub-pixel jitter from focus moving between inputs.
     */
    if (lastHeightRef.current !== null && Math.abs(h - lastHeightRef.current) < 1) return;
    lastHeightRef.current = h;
    if (onStep1Ref.current) step1HeightRef.current = Math.max(step1HeightRef.current || 0, h);
    setPanelHeight(h);
  }, []);

  useLayoutEffect(() => {
    const el = panelInnerRef.current;
    if (el) commitHeight(el.getBoundingClientRect().height);
  }, [commitHeight]);

  useEffect(() => {
    const el = panelInnerRef.current;

    let observer;
    if (el && typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver((entries) => {
        const entry = entries[0];
        if (!entry) return;
        /*
         * The BORDER box, because `.panelInner` carries the panel's padding and
         * the height has to include it. `contentRect` is short by exactly that
         * padding, and the panel would clip its own content by ~67px.
         */
        const box = entry.borderBoxSize && entry.borderBoxSize[0];
        commitHeight(box ? box.blockSize : el.getBoundingClientRect().height);
      });
      observer.observe(el);
    }

    const timer = setTimeout(() => {
      setIsInitialMount(false);
    }, 720);

    return () => {
      if (observer) observer.disconnect();
      clearTimeout(timer);
    };
  }, [commitHeight]);

  /*
   * Until the page for THIS path has reported (its chunk may still be loading,
   * or its layout effect has not run yet on the navigating render), the
   * previous page's settings must not decide the layout. They used to: the
   * first frame on /signup had no step yet and the first on /login still had
   * signup's showStory=false, so the aside unmounted for a frame and a new
   * one mounted, which is what made the card snap instead of morph. The route
   * decides instead: signup shows the rail (at the step in the URL), every
   * other page shows its story.
   */
  const reported = story.reportedFor === routeKey;
  const urlStep = parseInt(new URLSearchParams(location.search).get('step'), 10);
  const effectiveRailStep = reported
    ? story.railStep
    : (isSignup ? (Number.isInteger(urlStep) ? urlStep : 1) : null);
  const effectiveShowStory = reported ? story.showStory !== false : true;

  const shouldShowRail = isSignup && Number.isInteger(effectiveRailStep);
  const holding = isSignup && reported && !!story.holdSize;
  onStep1Ref.current = shouldShowRail && effectiveRailStep === 1;

  /*
   * The card's height on signup step 1, remembered so the finishing screen can
   * open at exactly that size instead of shrinking to its own content. If the
   * finishing screen is reached without step 1 having been measured (a reload
   * mid-flow), the height at the moment it opens is used instead.
   * Recorded in commitHeight, from real measurements only.
   */
  const holdHeightRef = useRef(null);
  if (holding && holdHeightRef.current == null) {
    holdHeightRef.current = step1HeightRef.current || lastHeightRef.current;
  } else if (!holding) {
    holdHeightRef.current = null;
  }
  const shouldShowStory = !isSignup && effectiveShowStory;
  const hasAside = shouldShowRail || shouldShowStory;

  return (
    <AuthShellContext.Provider value={contextValue}>
      <div className={`${s.shell} ${shouldShowRail || holding ? s.shellSignup : ''}`}>
        <div
          className={s.ambient}
          aria-hidden="true"
          style={{
            backgroundImage: `url(${authBg})`,
          }}
        />

        <div className={`${s.topBar} ${hasBack === true ? s.topBarWithBack : ''} ${hasBack === 'bare' ? s.topBarBare : ''}`}>
          {hasBack === true ? (
            <button
              type="button"
              className={s.topBack}
              onClick={() => backRef.current?.()}
              aria-label="Go back"
            >
              <ArrowLeft size={18} />
            </button>
          ) : null}
          {hasBack && isSignup && Number.isInteger(story.progressCurrent) && story.progressTotal > 0 ? (
            <div className={s.topProgress}>
              <div
                className={s.topProgressTrack}
                role="progressbar"
                aria-label={`Signup progress, step ${story.progressCurrent} of ${story.progressTotal}`}
                aria-valuemin={1}
                aria-valuemax={story.progressTotal}
                aria-valuenow={story.progressCurrent}
              >
                <span
                  className={s.topProgressFill}
                  style={{ transform: `scaleX(${Math.min(story.progressCurrent / story.progressTotal, 1)})` }}
                />
              </div>
              <span className={s.topProgressCount} aria-hidden="true">
                {story.progressCurrent}/{story.progressTotal}
              </span>
            </div>
          ) : null}
          <Link to="/" className={s.brandRow}>
            {/*
              Two images rather than one filtered image, and rather than
              reading the theme in JS.

              The wordmark is not monochrome: "MEETIF" is near-black and the
              "YY" is a brand gradient. Any filter strong enough to lighten the
              first destroys the second, and swapping `src` from a `useTheme()`
              read would re-render the shell on every theme change to alter one
              attribute. CSS picks, the browser caches both, and the markup
              stays declarative.

              Only one is ever visible, and the hidden one is `aria-hidden`, so
              a screen reader hears the name once.
            */}
            <img
              src={wordmark}
              alt="Meetifyy"
              className={`${s.brandWordmarkImg} ${s.brandWordmarkLight}`}
            />
            <img
              src={wordmarkDark}
              alt=""
              aria-hidden="true"
              className={`${s.brandWordmarkImg} ${s.brandWordmarkDark}`}
            />
          </Link>
          <Link to="/" className={s.exitLink} aria-label="Back to site">
            <ArrowLeft size={15} className={s.exitLinkIcon} />
            <span>Back</span>
          </Link>
        </div>

        <div className={s.stage}>
          <div className={s.panelWrap}>
            <div className={`${s.panel} ${isInitialMount ? s.panelInitial : ''}`} style={panelHeight != null ? { height: panelHeight } : undefined}>
              {/*
                The measured element and the swapped element are deliberately
                NOT the same node. `panelInnerRef` has to stay put for the
                ResizeObserver to keep observing it across navigations; keying
                it by route would tear it down and re-observe on every move,
                and the first measurement after that arrives too late to
                animate from. So the key lives on a plain wrapper inside it,
                which gives React a new node per route and lets the incoming
                page fade in while the panel around it resizes.
              */}
              {/*
                Phones, login only: the desktop artwork as a header image
                across the top of the page, fading into the surface. Purely
                decorative and out of flow, so nothing on the page moves.
              */}
              {isLogin ? (
                <div
                  className={s.mobileHero}
                  aria-hidden="true"
                  style={{ backgroundImage: `url(${authBg})` }}
                />
              ) : null}
              <div
                ref={panelInnerRef}
                className={`${s.panelInner} ${holding ? s.panelInnerHold : ''}`}
                style={
                  holding && holdHeightRef.current
                    // Capped to the screen: a height recorded at another
                    // window size must never push the card past the fold.
                    ? { minHeight: `min(${Math.round(holdHeightRef.current)}px, calc(100dvh - 9rem))` }
                    : undefined
                }
              >
                <div className={`${s.panelGrid} ${!hasAside ? s.panelGridNoStory : ''}`}>
                  {/*
                    One wrapper for whichever aside is showing. It is the same
                    element on login and signup, so its width can animate
                    between the two layouts; the story and the rail inside it
                    are different components and simply cross-fade.
                  */}
                  {hasAside ? (
                    <div className={s.asideSlot}>
                    {shouldShowRail && <SignupRail current={effectiveRailStep} leaving={reported && !!story.railLeaving} />}
                    {shouldShowStory && (
                      <StoryColumn
                        headline={story.reportedFor === routeKey ? story.headline : (AUTH_STORIES[routeKey]?.headline ?? story.headline)}
                        subtext={story.reportedFor === routeKey ? story.subtext : (AUTH_STORIES[routeKey]?.subtext ?? story.subtext)}
                      />
                    )}
                    </div>
                  ) : null}
                  <div key={routeKey} className={s.panelSwap} data-slide={slideDirRef.current}>
                    {children}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </AuthShellContext.Provider>
  );
}

/** Splits `*text*` into a gradient <em> span so callers can highlight a phrase inline. */
function renderHighlighted(line) {
  const parts = line.split('*');
  if (parts.length === 1) return line;
  return parts.map((part, i) => (i % 2 === 1 ? <em key={i}>{part}</em> : part));
}

