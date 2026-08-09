import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import wordmark from '@assets/images/meetifyy_wordmark.webp';
import proofCards from '@assets/images/auth_proof_cards.webp';
import s from './authKit.module.css';

/**
 * The shared canvas for every auth/onboarding screen: a full-bleed brand
 * gradient with a decorative story column drifting on the left and a
 * floating form panel offset to the right, slightly overlapping it — an
 * asymmetric composition instead of a hard two-panel split. The panel is
 * always vertically centered in the viewport and smoothly animates to its
 * new size/position whenever its content changes height (step switches,
 * status screens, validation messages appearing). Auth always renders in
 * the light palette regardless of the app's theme.
 *
 * @param {string}  [headline]     Story headline. Wrap a phrase in *asterisks* to gradient-highlight it.
 * @param {string}  [subtext]      Story supporting line.
 */
export default function AuthShell({
  children,
  headline = "Your campus,\n*finally connected.*",
  subtext = 'Meetifyy is where verified students meet, plan, and belong.',
}) {
  const headlineLines = headline.split('\n');

  // Smoothly animate the panel's height whenever its content changes size
  // (step switches, status screens, a validation message appearing) instead
  // of snapping. `panelInnerRef` is never itself height-constrained, so it
  // always reports its true natural size; that measurement drives an
  // explicit pixel height + CSS transition on the outer `.panel`. Measuring
  // and constraining the same element would be self-referential — once the
  // outer box is pinned to a height, its own size stops reflecting what its
  // content actually needs.
  //
  // Re-measured after every commit (not just on mount) so it catches every
  // content swap driven by React state — steps changing, a validation
  // message appearing, a status screen replacing the form. A ResizeObserver
  // is kept too, as a supplementary safety net for size changes React isn't
  // driving directly (e.g. a window resize reflowing text).
  const panelInnerRef = useRef(null);
  const [panelHeight, setPanelHeight] = useState(null);

  useLayoutEffect(() => {
    const el = panelInnerRef.current;
    if (el) setPanelHeight(el.scrollHeight);
  });

  useEffect(() => {
    const el = panelInnerRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setPanelHeight(el.scrollHeight));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
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

        <div className={s.panelWrap}>
          <div className={s.panel} style={panelHeight != null ? { height: panelHeight } : undefined}>
            <div ref={panelInnerRef} className={s.panelInner}>
              {children}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Splits `*text*` into a gradient <em> span so callers can highlight a phrase inline. */
function renderHighlighted(line) {
  const parts = line.split('*');
  if (parts.length === 1) return line;
  return parts.map((part, i) => (i % 2 === 1 ? <em key={i}>{part}</em> : part));
}
