import { createContext, Fragment, memo, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ArrowLeft } from '@shared/components/icons';
import wordmark from '@assets/images/meetifyy_wordmark.svg';
import wordmarkDark from '@assets/images/meetifyy_wordmark_dark.svg';
import proofCards from '@assets/images/auth_proof_cards.webp';
import s from './authKit.module.css';

const DEFAULT_HEADLINE = "Your campus,\n*finally connected.*";
const DEFAULT_SUBTEXT = 'Meetifyy is where verified students meet, plan, and belong.';

const AuthShellContext = createContext(null);

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
 */
export default function AuthShell({ children, headline = DEFAULT_HEADLINE, subtext = DEFAULT_SUBTEXT }) {
  const parentContext = useContext(AuthShellContext);

  // When nested inside a shared master (route group sharing one AuthShell
  // instance), forward this page's story copy up instead of rendering our
  // own canvas — the master owns the actual DOM/animation.
  useLayoutEffect(() => {
    if (parentContext) parentContext.setStory({ headline, subtext });
  }, [parentContext, headline, subtext]);

  if (parentContext) {
    return <>{children}</>;
  }

  return <AuthShellMaster headline={headline} subtext={subtext}>{children}</AuthShellMaster>;
}

const StoryColumn = memo(function StoryColumn({ headline = DEFAULT_HEADLINE, subtext = DEFAULT_SUBTEXT }) {
  const headlineLines = headline.split('\n');
  return (
    <aside className={s.story}>
      <span className={s.storyMark} aria-hidden="true" />
      <h2 className={s.storyHeadline}>
        {headlineLines.map((line, i) => (
          <Fragment key={i}>
            {renderHighlighted(line)}
            {i < headlineLines.length - 1 ? <br /> : null}
          </Fragment>
        ))}
      </h2>
      <p className={s.storySub}>{subtext}</p>
      <img src={proofCards} alt="" className={s.proofCards} aria-hidden="true" />
    </aside>
  );
});

function AuthShellMaster({ children, headline: defaultHeadline, subtext: defaultSubtext }) {
  /*
   * The path, not the full location: a query string or a hash changing (the
   * reset link carries both) must not restart the content fade, because the
   * page behind it has not changed.
   */
  const routeKey = useLocation().pathname;
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
  const [story, setStory] = useState({ headline: defaultHeadline, subtext: defaultSubtext });

  const setStoryCallback = useCallback((next) => setStory(next), []);
  const contextValue = useMemo(() => ({ setStory: setStoryCallback }), [setStoryCallback]);

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

  return (
    <AuthShellContext.Provider value={contextValue}>
      <div className={s.shell}>
        <div className={s.ambient} aria-hidden="true">
          <span className={`${s.blob} ${s.blobA}`} />
          <span className={`${s.blob} ${s.blobB}`} />
          <span className={`${s.blob} ${s.blobC}`} />
        </div>

        <div className={s.topBar}>
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
          <Link to="/" className={s.exitLink}>
            <ArrowLeft size={15} className={s.exitLinkIcon} />
            <span>Back to site</span>
          </Link>
        </div>

        <div className={s.stage}>
          <StoryColumn headline={story.headline} subtext={story.subtext} />

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
              <div ref={panelInnerRef} className={s.panelInner}>
                <div key={routeKey} className={s.panelSwap}>
                  {children}
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

