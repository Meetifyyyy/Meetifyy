import { useEffect, useRef } from 'react';
import { useSwipeDeck } from '../hooks/useSwipeDeck';
import styles from './ConfessionsDeck.module.css';

/**
 * First-time introduction to Confessions, built as an editorial pitch deck:
 * three slides of big type, one sentence each, and a drawn graphic per slide.
 *
 * The graphics are inline SVG in the theme's own colours — no illustration
 * files, no icon set — so they cost nothing to load and follow light/dark.
 *
 * Motion: see `useSwipeDeck`. Every line of type and every graphic is placed
 * from `--deck-pg`, each at its own rate, which is what staggers them as a
 * slide arrives and leaves.
 */

const SLIDES = [
  {
    id: 'speak',
    eyebrow: 'Anonymous Confessions',
    lines: ['Speak', 'Freely.'],
    body: 'Share your thoughts, experiences and secrets with your campus, without your name on them.',
    Graphic: NotesGraphic,
  },
  {
    id: 'identity',
    eyebrow: 'Who you are here',
    lines: ['Your Secret', 'Identity.'],
    body: 'Pick an anonymous name. It’s how your campus knows you here, and it never points back to your profile.',
    Graphic: IdentityGraphic,
  },
  {
    id: 'listen',
    eyebrow: 'Read. Relate. Belong.',
    lines: ['A Campus', 'That Listens.'],
    body: 'Discover confessions, relate to them, and explore what your campus is really thinking.',
    Graphic: RingsGraphic,
  },
];

export default function ConfessionsDeck({ onDone }) {
  const deck = useSwipeDeck(SLIDES.length);
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
      style={{ '--deck-pg': 0 }}
      onKeyDown={deck.onKeyDown}
      role="region"
      aria-roledescription="carousel"
      aria-label="Introducing Confessions"
    >
      <div className={styles.topBar}>
        <div className={styles.progress} aria-hidden="true">
          {SLIDES.map((s, n) => (
            <span key={s.id} className={styles.segment}>
              <span className={styles.segmentFill} style={{ '--n': n }} />
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
        <div className={styles.track}>
          {SLIDES.map((slide, n) => (
            <section
              key={slide.id}
              className={`${styles.slide} ${styles[`slide_${slide.id}`]}`}
              style={{ '--n': n }}
              aria-roledescription="slide"
              aria-label={`${n + 1} of ${SLIDES.length}`}
              aria-hidden={n === index ? undefined : 'true'}
            >
              <div className={styles.art} aria-hidden="true">
                <slide.Graphic />
              </div>
              <div className={styles.copy}>
                <p className={styles.eyebrow}>{slide.eyebrow}</p>
                <h2 className={styles.headline}>
                  {slide.lines.map((line, i) => (
                    <span key={line} className={styles.line} style={{ '--i': i }}>
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
                <p className={styles.body}>{slide.body}</p>
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

/** Slide 1: three folded notes, the top one written on. */
function NotesGraphic() {
  return (
    <svg className={styles.svg} viewBox="0 0 320 300">
      <g className={styles.notesBack}>
        <rect x="70" y="58" width="190" height="150" rx="22" className={styles.fillAccent} transform="rotate(-11 165 133)" />
      </g>
      <g className={styles.notesMid}>
        <rect x="58" y="74" width="196" height="156" rx="22" className={styles.fillOutline} transform="rotate(7 156 152)" />
      </g>
      <g className={styles.notesFront}>
        <rect x="48" y="86" width="210" height="160" rx="24" className={styles.fillBrand} transform="rotate(-3 153 166)" />
        <g transform="rotate(-3 153 166)" className={styles.noteLines}>
          <rect x="76" y="122" width="132" height="10" rx="5" />
          <rect x="76" y="146" width="154" height="10" rx="5" />
          <rect x="76" y="170" width="104" height="10" rx="5" />
          <rect x="76" y="206" width="56" height="10" rx="5" className={styles.noteSign} />
        </g>
        {/* The fold in the corner. */}
        <path d="M232 230 l26 -2 l-2 -26 z" className={styles.fold} transform="rotate(-3 153 166)" />
      </g>
    </svg>
  );
}

/** Slide 2: an ID card with the identity struck through and a handle in front. */
function IdentityGraphic() {
  return (
    <svg className={styles.svg} viewBox="0 0 320 300">
      <defs>
        <pattern id="cf-stripes" width="10" height="10" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="5" height="10" className={styles.stripe} />
        </pattern>
      </defs>
      <g className={styles.idCard}>
        <rect x="40" y="46" width="240" height="166" rx="24" className={styles.fillSurface} />
        <circle cx="96" cy="112" r="34" fill="url(#cf-stripes)" />
        <circle cx="96" cy="112" r="34" className={styles.ringStroke} />
        <rect x="148" y="90" width="104" height="14" rx="7" className={styles.redact} />
        <rect x="148" y="116" width="76" height="14" rx="7" className={styles.redact} />
        <rect x="66" y="170" width="186" height="10" rx="5" className={styles.redactSoft} />
      </g>
      <g className={styles.idChip}>
        <rect x="74" y="200" width="214" height="58" rx="29" className={styles.fillBrand} />
        <circle cx="104" cy="229" r="15" className={styles.chipDot} />
        <text x="130" y="236" className={styles.chipText}>@velvet.moth</text>
      </g>
    </svg>
  );
}

/** Slide 3: rings around a centre, with voices travelling on them. */
function RingsGraphic() {
  return (
    <svg className={styles.svg} viewBox="0 0 320 300">
      <circle cx="160" cy="150" r="128" className={styles.ringFaint} />
      <circle cx="160" cy="150" r="92" className={styles.ringFaint} />
      <circle cx="160" cy="150" r="56" className={styles.ringFaint} />
      <g className={`${styles.orbit} ${styles.orbitA}`}>
        <circle cx="160" cy="22" r="11" className={styles.fillAccent} />
        <circle cx="160" cy="278" r="7" className={styles.fillInk} />
      </g>
      <g className={`${styles.orbit} ${styles.orbitB}`}>
        <circle cx="252" cy="150" r="9" className={styles.fillBrand} />
        <circle cx="68" cy="150" r="6" className={styles.fillInk} />
      </g>
      <g className={`${styles.orbit} ${styles.orbitC}`}>
        <circle cx="160" cy="94" r="7" className={styles.fillAccent} />
      </g>
      <circle cx="160" cy="150" r="26" className={styles.fillBrand} />
      <circle cx="160" cy="150" r="26" className={styles.pulse} />
    </svg>
  );
}
