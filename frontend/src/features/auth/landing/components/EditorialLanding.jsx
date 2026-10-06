import { useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import concertCrowd from '../assets/concert-crowd.webp';
import chai from '../assets/chai.webp';
import laptopPair from '../assets/laptop-pair.webp';
import grassFriends from '../assets/grass-friends.webp';
import festPaint from '../assets/fest-paint.webp';
import cricket from '../assets/cricket.webp';
import holiCrowd from '../assets/holi-crowd.webp';
import friendsLaugh from '../assets/friends-laugh.webp';
import { LANDING_SCROLL_KEY } from './LandingNavbar';
import styles from './EditorialLanding.module.css';

/**
 * The website's landing page body, set as an editorial layout: a giant
 * wordmark, numbered sections between thin rules, full-bleed photography and
 * large type doing the work that cards, icons and gradients used to.
 *
 * Photographs are from Unsplash (free licence, no attribution required); the
 * credits are kept in `../assets/CREDITS.md`. Only the hero image loads
 * eagerly — everything else is `loading="lazy"` with explicit dimensions, so
 * nothing below the fold competes with first paint or shifts the layout.
 */

const STEPS = [
  {
    title: 'Verify your college email',
    text: 'Sign up with your institutional address. Everyone here is a verified student — no outsiders, no fake profiles.',
  },
  {
    title: 'Join circles',
    text: 'Find the student-run groups for what you are into, or start one and let people find you.',
  },
  {
    title: 'Meet in person',
    text: 'Start a study session, a canteen meetup or a game, and see who is in. The point is to get off the app.',
  },
];

const FEATURES = [
  ['Circles', 'Student-run groups for everything from AI builders to the dramatics society.'],
  ['Plans', 'Post what you are doing and when. Anyone on campus can ask to join.'],
  ['Instant match', 'Get paired with someone nearby who wants to do the same thing, right now.'],
  ['Chats', 'Direct messages and a group chat for every circle and plan.'],
  ['Campus feed', 'Posts, events and moments from your own campus, not the whole internet.'],
  ['Verified only', 'Every account is tied to a college email. You know who you are talking to.'],
];

const CIRCLES = [
  'AI & ML Builders',
  'Design Collective',
  'Sports & Fitness',
  'Photography Club',
  'Startup Founders',
  'Dramatics Society',
  'Cultural Exchange',
  'Cybersecurity Club',
  'Electronics Geeks',
];

const VOICES = [
  {
    quote:
      'Meetifyy is actually useful as a fresher. I didn’t know many people or even what was happening around campus, and this helped me discover events and connect with people with similar interests.',
    name: 'Soham',
  },
  {
    quote:
      'I started using Meetifyy just to see what was happening on campus, but ended up finding communities and people I genuinely vibed with.',
    name: 'Shivam',
  },
];

export default function EditorialLanding() {
  const { hash } = useLocation();

  // Arriving from another page's header link (see LandingNavbar), or at a
  // `/#section` URL: scroll there once the page has laid out. The browser's
  // own hash jump does not run in this app, and the delay lets the router's
  // scroll restoration finish first.
  useEffect(() => {
    let target = hash ? hash.slice(1) : null;
    try {
      target = window.sessionStorage.getItem(LANDING_SCROLL_KEY) || target;
    } catch { /* storage unavailable */ }
    if (!target) return undefined;
    // Twice: once as soon as possible, and again after the router's scroll
    // restoration, which runs late on a back-step and resets to the top.
    const go = () => document.getElementById(target)?.scrollIntoView({ block: 'start', behavior: 'instant' });
    // The key is cleared only once the last scroll has run, not on read: in
    // development Strict Mode replays this effect, and clearing it up front
    // left the replay with nothing to scroll to.
    const timers = [
      window.setTimeout(go, 60),
      window.setTimeout(() => {
        go();
        try { window.sessionStorage.removeItem(LANDING_SCROLL_KEY); } catch { /* best effort */ }
      }, 350),
    ];
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, [hash]);

  return (
    <>
      {/* ── 00 · Hero ─────────────────────────────────────────────── */}
      <section id="home" className={styles.hero} aria-labelledby="hero-title">
        <h1 id="hero-title" className={styles.wordmark}>
          meetifyy<span className={styles.dot}>.</span>
        </h1>

        <div className={styles.heroGrid}>
          <p className={styles.heroLead}>
            Find your <span className={styles.marker}>people</span> on campus.
          </p>

          <figure className={styles.heroFigure}>
            <span className={styles.sticker}>300+ students</span>
            <img
              src={concertCrowd}
              alt="A crowd at a concert under falling confetti"
              width="900"
              height="1200"
              fetchpriority="high"
              decoding="async"
            />
          </figure>

          <div className={styles.heroAside}>
            <p className={styles.heroText}>
              Circles, plans and chats with the students around you. Built for
              campus life that happens in person, not in a group chat with
              four hundred strangers.
            </p>
            <div className={styles.heroActions}>
              <Link to="/signup" className={styles.btnPrimary}>Create your account</Link>
              <Link to="/login" className={styles.btnSecondary}>Log in</Link>
            </div>
          </div>
        </div>
      </section>

      {/* ── 01 · How it works ─────────────────────────────────────── */}
      <section id="how-it-works" className={styles.section} aria-labelledby="how-title">
        <header className={styles.sectionHead}>
          <span className={styles.sectionNo}>01</span>
          <h2 id="how-title" className={styles.sectionTitle}>How it works</h2>
        </header>

        <ol className={styles.steps}>
          {STEPS.map((step, i) => (
            <li key={step.title} className={`${styles.step} ${styles[`tone${i}`]}`}>
              <span className={styles.stepNo}>{String(i + 1).padStart(2, '0')}</span>
              <h3 className={styles.stepTitle}>{step.title}</h3>
              <p className={styles.stepText}>{step.text}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* ── Photo band ────────────────────────────────────────────── */}
      <figure className={styles.band}>
        <img src={chai} alt="Glasses of chai and a samosa on a table" width="1600" height="900" loading="lazy" decoding="async" />
        <figcaption className={styles.bandCaption}>
          <span className={styles.bandLine}>Chai at 5?</span>
          <span className={styles.bandSmall}>Most plans on Meetifyy start this small.</span>
        </figcaption>
      </figure>

      {/* ── 02 · Features ─────────────────────────────────────────── */}
      <section id="features" className={styles.section} aria-labelledby="features-title">
        <header className={styles.sectionHead}>
          <span className={styles.sectionNo}>02</span>
          <h2 id="features-title" className={styles.sectionTitle}>What you can do</h2>
        </header>

        <div className={styles.featuresGrid}>
          <dl className={styles.features}>
            {FEATURES.map(([name, text], i) => (
              <div key={name} className={styles.feature}>
                <dt className={styles.featureName}>
                  <span className={`${styles.swatch} ${styles[`tone${i % 4}`]}`} aria-hidden="true" />
                  {name}
                </dt>
                <dd className={styles.featureText}>{text}</dd>
              </div>
            ))}
          </dl>

          <div className={styles.featurePhotos}>
            <img src={grassFriends} alt="Three friends lying on the grass, smiling" width="1200" height="800" loading="lazy" decoding="async" />
            <img src={laptopPair} alt="Two students working on a laptop at a cafe" width="800" height="1067" loading="lazy" decoding="async" />
          </div>
        </div>
      </section>

      {/* ── The number ────────────────────────────────────────────── */}
      <section className={styles.stat} aria-label="Students on Meetifyy">
        <div className={styles.statText}>
          <p className={styles.statNumber}>300+</p>
          <p className={styles.statLabel}>
            students already on Meetifyy, and every one of them verified.
          </p>
        </div>
        <img
          className={styles.statPhoto}
          src={holiCrowd}
          alt="A crowd celebrating Holi with raised hands and colour"
          width="1200"
          height="900"
          loading="lazy"
          decoding="async"
        />
      </section>

      {/* ── 03 · Circles ──────────────────────────────────────────── */}
      <section id="circles" className={styles.section} aria-labelledby="circles-title">
        <header className={styles.sectionHead}>
          <span className={styles.sectionNo}>03</span>
          <h2 id="circles-title" className={styles.sectionTitle}>Circles students are starting</h2>
        </header>

        <ul className={styles.circles}>
          {CIRCLES.map((name, i) => (
            <li key={name} className={styles[`tone${i % 4}`]}>{name}</li>
          ))}
        </ul>

        <div className={styles.photoPair}>
          <img src={cricket} alt="Students playing cricket on a dirt pitch" width="1400" height="970" loading="lazy" decoding="async" />
          <img src={festPaint} alt="Students dancing in colour at a college fest" width="1400" height="933" loading="lazy" decoding="async" />
        </div>
      </section>

      {/* ── 04 · Voices ───────────────────────────────────────────── */}
      <section id="testimonials" className={styles.section} aria-labelledby="voices-title">
        <header className={styles.sectionHead}>
          <span className={styles.sectionNo}>04</span>
          <h2 id="voices-title" className={styles.sectionTitle}>From students</h2>
        </header>

        <div className={styles.voicesGrid}>
          <img
            className={styles.voicesPhoto}
            src={friendsLaugh}
            alt="Two friends sitting outdoors and laughing"
            width="1000"
            height="1500"
            loading="lazy"
            decoding="async"
          />
          <div className={styles.voices}>
            {VOICES.map((v, i) => (
              <blockquote key={v.name} className={`${styles.voice} ${styles[`soft${i}`]}`}>
                <p>“{v.quote}”</p>
                <footer>— {v.name}</footer>
              </blockquote>
            ))}
            <a
              className={styles.shareLink}
              href="mailto:hello@meetifyy.app?subject=My%20Meetifyy%20Experience"
            >
              Tell us your story →
            </a>
          </div>
        </div>
      </section>
    </>
  );
}
