import React, { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft } from '@shared/components/icons';
import wordmark from '@assets/images/meetifyy_wordmark.svg';
import proofCards from '@assets/images/auth_proof_cards.webp';
import s from './authKit.module.css';

const DEFAULT_HEADLINE = "Your campus,\n*finally connected.*";
const DEFAULT_SUBTEXT = 'Meetifyy is where verified students meet, plan, and belong.';

const AuthShellContext = createContext(null);
let globalLastPanelHeight = null;

/**
 * The shared canvas for every auth/onboarding screen: a full-bleed brand
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

const StoryColumn = React.memo(function StoryColumn({ headline = DEFAULT_HEADLINE, subtext = DEFAULT_SUBTEXT }) {
  const headlineLines = headline.split('\n');
  return (
    <aside className={s.story}>
      <span className={s.storyMark} aria-hidden="true" />
      <h2 className={s.storyHeadline}>
        {headlineLines.map((line, i) => (
          <React.Fragment key={i}>
            {renderHighlighted(line)}
            {i < headlineLines.length - 1 ? <br /> : null}
          </React.Fragment>
        ))}
      </h2>
      <p className={s.storySub}>{subtext}</p>
      <img src={proofCards} alt="" className={s.proofCards} aria-hidden="true" />
    </aside>
  );
});

function AuthShellMaster({ children, headline: defaultHeadline, subtext: defaultSubtext }) {
  const panelInnerRef = useRef(null);
  const [panelHeight, setPanelHeight] = useState(globalLastPanelHeight);
  const [isInitialMount, setIsInitialMount] = useState(true);
  const [story, setStory] = useState({ headline: defaultHeadline, subtext: defaultSubtext });

  const setStoryCallback = useCallback((next) => setStory(next), []);
  const contextValue = useMemo(() => ({ setStory: setStoryCallback }), [setStoryCallback]);

  useLayoutEffect(() => {
    const el = panelInnerRef.current;
    if (el) {
      // We also use getBoundingClientRect here for consistency
      const h = el.getBoundingClientRect().height;
      globalLastPanelHeight = h;
      setPanelHeight(h);
    }
  });

  useEffect(() => {
    const el = panelInnerRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => {
      // Use getBoundingClientRect().height instead of scrollHeight to ignore temporary
      // scrollHeight expansions caused by mobile virtual keyboard carets.
      // We also enforce a >3px threshold to ignore sub-pixel rounding jitter when
      // moving focus between inputs on mobile.
      const h = el.getBoundingClientRect().height;
      if (globalLastPanelHeight === null || Math.abs(h - globalLastPanelHeight) > 3) {
        globalLastPanelHeight = h;
        setPanelHeight(h);
      }
    });
    observer.observe(el);

    const timer = setTimeout(() => {
      setIsInitialMount(false);
    }, 720);

    return () => {
      observer.disconnect();
      clearTimeout(timer);
    };
  }, []);

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
            <img src={wordmark} alt="Meetifyy" className={s.brandWordmarkImg} />
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
              <div ref={panelInnerRef} className={s.panelInner}>
                {children}
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

