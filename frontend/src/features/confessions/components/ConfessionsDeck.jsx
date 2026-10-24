import { useEffect, useRef, useState } from 'react';
import { useSwipeDeck } from '../hooks/useSwipeDeck';
import styles from './ConfessionsDeck.module.css';

/**
 * First-time introduction to Confessions, built as an editorial pitch deck:
 * three slides of big type, one sentence each, and a drawn graphic per slide.
 *
 * The graphics are inline SVG in the theme's own colours — no illustration
 * files, no icon set — so they cost nothing to load and follow light/dark.
 *
 * Motion: see `useSwipeDeck`. The elements marked `data-deck` are the ones it
 * moves, each at its own rate, which is what staggers them as a slide arrives
 * and leaves.
 */

const SLIDES = [
  {
    id: 'speak',
    eyebrow: 'Anonymous confessions',
    lines: ['Say it,', 'no name.'],
    body: 'Post what’s on your mind to students on your campus. No real name, no photo, just your words.',
    Graphic: PostGraphic,
  },
  {
    id: 'identity',
    eyebrow: 'Your name here',
    lines: ['One name.', 'Only yours.'],
    body: 'You post under a name you choose. Your campus can recognise your voice here, never your profile.',
    Graphic: HandlesGraphic,
  },
  {
    id: 'listen',
    eyebrow: 'Read and relate',
    lines: ['You’re not', 'alone.'],
    body: 'See what your campus is going through, relate when it hits home and reply anonymously.',
    Graphic: RelateGraphic,
  },
];

export default function ConfessionsDeck({ onDone }) {
  const [reduceMotion] = useState(
    () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true,
  );
  const deck = useSwipeDeck(SLIDES.length, { reduceMotion });
  const { index, goTo } = deck;
  const isLast = index === SLIDES.length - 1;
  const nextRef = useRef(null);

  // Keyboard users land on the deck's main control, not the page behind it.
  useEffect(() => {
    nextRef.current?.focus({ preventScroll: true });
  }, []);

  return (
    <div
      ref={deck.rootRef}
      className={styles.deck}
      onKeyDown={deck.onKeyDown}
      role="region"
      aria-roledescription="carousel"
      aria-label="Introducing Confessions"
    >
      <div className={styles.topBar}>
        <div className={styles.progress} aria-hidden="true">
          {SLIDES.map((s, n) => (
            <span key={s.id} className={styles.segment}>
              <span className={styles.segmentFill} data-deck="fill" />
            </span>
          ))}
        </div>
        <span className={styles.counter} aria-live="polite">
          <span className={styles.counterNow}>{String(index + 1).padStart(2, '0')}</span>
          <span className={styles.counterOf}> / {String(SLIDES.length).padStart(2, '0')}</span>
        </span>
        <button type="button" className={styles.skip} onClick={onDone}>
          Skip
        </button>
      </div>

      <div ref={deck.viewportRef} className={styles.viewport} {...deck.viewportHandlers}>
        <div className={styles.track} data-deck="track">
          {SLIDES.map((slide, n) => (
            <section
              key={slide.id}
              className={`${styles.slide} ${styles[`slide_${slide.id}`]}`}
              data-deck="slide"
              aria-roledescription="slide"
              aria-label={`${n + 1} of ${SLIDES.length}`}
              aria-hidden={n === index ? undefined : 'true'}
            >
              <div className={styles.art} data-deck="art" aria-hidden="true">
                <slide.Graphic />
              </div>
              <div className={styles.copy}>
                <p className={styles.eyebrow} data-deck="eyebrow">{slide.eyebrow}</p>
                <h2 className={styles.headline}>
                  {slide.lines.map((line, i) => (
                    <span key={line} className={styles.line} data-deck="line">
                      {line.endsWith('.') ? (
                        <>
                          {line.slice(0, -1)}
                          <span className={styles.stop}>.</span>
                        </>
                      ) : line}
                      {/* The lines are blocks; this space is what a screen
                          reader (and copy-paste) hears between them. */}
                      {i < slide.lines.length - 1 ? ' ' : null}
                    </span>
                  ))}
                </h2>
                <p className={styles.body} data-deck="body">{slide.body}</p>
              </div>
            </section>
          ))}
        </div>
      </div>

      <div className={styles.controls}>
        <button
          type="button"
          className={styles.back}
          onClick={() => goTo(index - 1)}
          disabled={index === 0}
          aria-label="Previous slide"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <button
          ref={nextRef}
          type="button"
          className={styles.next}
          onClick={() => (isLast ? onDone() : goTo(index + 1))}
        >
          <span>{isLast ? 'Choose your name' : 'Next'}</span>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M5 12h13M13 6l6 6-6 6" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>
    </div>
  );
}

/* ---- Graphics ------------------------------------------------------------- */

/** Slide 1: a confession being posted, its author hidden. */
function PostGraphic() {
  return (
    <svg className={styles.svg} viewBox="0 0 320 300">
      <defs>
        <pattern id="cf-stripes-1" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="4" height="8" className={styles.stripe} />
        </pattern>
      </defs>
      <rect x="52" y="34" width="216" height="150" rx="22" className={styles.fillOutline} transform="rotate(-6 160 109)" />
      <g transform="rotate(2 160 150)">
        <rect x="36" y="58" width="248" height="184" rx="24" className={styles.fillSurface} />
        <circle cx="72" cy="94" r="16" fill="url(#cf-stripes-1)" />
        <circle cx="72" cy="94" r="16" className={styles.ringStroke} />
        <rect x="98" y="84" width="88" height="10" rx="5" className={styles.redact} />
        <rect x="98" y="100" width="52" height="8" rx="4" className={styles.redactSoft} />
        <rect x="56" y="132" width="200" height="10" rx="5" className={styles.redactSoft} />
        <rect x="56" y="152" width="176" height="10" rx="5" className={styles.redactSoft} />
        <rect x="56" y="172" width="124" height="10" rx="5" className={styles.redactSoft} />
        <rect x="56" y="204" width="208" height="22" rx="11" className={styles.fillTint} />
        <rect x="196" y="200" width="72" height="30" rx="15" className={styles.fillBrand} />
        <path d="M222 215h20M235 208l7 7-7 7" className={styles.glyph} />
      </g>
    </svg>
  );
}

/** Slide 2: a few names to choose from, one of them taken as yours. */
function HandlesGraphic() {
  return (
    <svg className={styles.svg} viewBox="0 0 320 300">
      <g opacity="0.55">
        <rect x="70" y="40" width="180" height="46" rx="23" className={styles.fillSurface} />
        <text x="96" y="70" className={styles.handleText}>@quiet.fern</text>
      </g>
      <rect x="40" y="112" width="240" height="66" rx="33" className={styles.fillBrand} />
      <circle cx="78" cy="145" r="17" className={styles.chipDot} />
      <path d="M70 145l6 6 11-12" className={styles.glyphBrand} />
      <text x="106" y="153" className={styles.chipText}>@velvet.moth</text>
      <g opacity="0.55">
        <rect x="80" y="204" width="160" height="46" rx="23" className={styles.fillSurface} />
        <text x="106" y="234" className={styles.handleText}>@lunar.owl</text>
      </g>
    </svg>
  );
}

/** Slide 3: a confession others relate to and answer. */
function RelateGraphic() {
  return (
    <svg className={styles.svg} viewBox="0 0 320 300">
      <rect x="30" y="40" width="236" height="130" rx="24" className={styles.fillSurface} />
      <rect x="54" y="68" width="78" height="10" rx="5" className={styles.redact} />
      <rect x="54" y="94" width="186" height="10" rx="5" className={styles.redactSoft} />
      <rect x="54" y="114" width="150" height="10" rx="5" className={styles.redactSoft} />
      <rect x="54" y="138" width="92" height="22" rx="11" className={styles.fillAccent} />
      <path d="M68 149c0-4 6-5 7 0 1-5 7-4 7 0 0 4-7 8-7 8s-7-4-7-8z" className={styles.heart} />
      <text x="90" y="154" className={styles.countText}>128</text>
      <rect x="96" y="190" width="194" height="38" rx="19" className={styles.fillBrand} />
      <rect x="116" y="205" width="120" height="8" rx="4" className={styles.onBrand} />
      <rect x="128" y="240" width="150" height="34" rx="17" className={styles.fillTint} />
      <rect x="146" y="253" width="84" height="8" rx="4" className={styles.redactSoft} />
    </svg>
  );
}
