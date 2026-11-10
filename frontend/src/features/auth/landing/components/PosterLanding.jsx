import { useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { config } from '@config';
import skyFriends from '../assets/sky-friends.webp';
import grassFriends from '../assets/grass-friends.webp';
import laptopPair from '../assets/laptop-pair.webp';
import selfie from '../assets/selfie.webp';
import tableFriends from '../assets/table-friends.webp';
import cricket from '../assets/cricket.webp';
import chai from '../assets/chai.webp';
import guitar from '../assets/guitar.webp';
import festPaint from '../assets/fest-paint.webp';
import holiCrowd from '../assets/holi-crowd.webp';
import friendsLaugh from '../assets/friends-laugh.webp';
import { LANDING_SCROLL_KEY } from './LandingNavbar';
import styles from './PosterLanding.module.css';

/**
 * The landing page body, set as a run of full-width colour panels. Each panel
 * is one flat colour with one idea on it: a headline in heavy lowercase type,
 * an italic serif word for emphasis, and photographs cropped into plain
 * shapes (arch, circle, pill, leaf) by CSS alone.
 *
 * Photographs are from Unsplash; credits are in `../assets/CREDITS.md`. Only
 * the hero images load eagerly. Everything below the fold is `loading="lazy"`
 * with explicit dimensions, so it neither competes with first paint nor
 * shifts the layout when it arrives.
 */

const PLANS = [
  'chai at 5?',
  'cricket after class',
  'library till late',
  'fest practice',
  'maggi run',
  'open mic friday',
  'sunrise walk',
  'movie night',
];

const STEPS = [
  {
    title: 'sign up with any email',
    text: 'Personal or college, any address works. Verify your college email later to open your Campus.',
    photo: selfie,
    alt: 'Six friends crowding into a selfie',
    shape: 'circle',
    size: [1200, 900],
  },
  {
    title: 'join circles',
    text: 'Find the student-run groups for what you are into, or start one and let people find you.',
    photo: tableFriends,
    alt: 'Friends laughing together around a table',
    shape: 'arch',
    size: [1400, 933],
  },
  {
    title: 'meet in person',
    text: 'Start a study session, a canteen meetup or a game, and see who is in. The point is to get off the app.',
    photo: cricket,
    alt: 'Students playing cricket on a dirt pitch',
    shape: 'leaf',
    size: [1400, 970],
  },
];

const FEATURES = [
  ['circles', 'Student-run groups for everything from AI builders to the dramatics society.'],
  ['plans', 'Post what you are doing and when. Anyone on campus can ask to join.'],
  ['instant match', 'Get paired with someone nearby who wants to do the same thing, right now.'],
  ['chats', 'Direct messages and a group chat for every circle and plan.'],
  ['campus feed', 'Posts, events and moments from your own campus, not the whole internet.'],
  ['real people', 'A live selfie check before anyone can message or post. Campus is college-verified.'],
];

/** Circle names, with two photographs set among them as pills of the same height. */
const CIRCLES = [
  { name: 'AI & ML Builders' },
  { name: 'Design Collective' },
  { photo: guitar, alt: 'A student playing an acoustic guitar outdoors', size: [1400, 933] },
  { name: 'Sports & Fitness' },
  { name: 'Photography Club' },
  { name: 'Startup Founders' },
  { name: 'Dramatics Society' },
  { photo: festPaint, alt: 'Students dancing in colour at a college fest', size: [1400, 933] },
  { name: 'Cultural Exchange' },
  { name: 'Cybersecurity Club' },
  { name: 'Electronics Geeks' },
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

/** A six-petal flower, drawn rather than imported. Sits between marquee items. */
function Flower() {
  return (
    <svg className={styles.flower} viewBox="0 0 40 40" aria-hidden="true">
      {[0, 60, 120, 180, 240, 300].map((deg) => (
        <circle key={deg} cx="20" cy="8.5" r="7.5" transform={`rotate(${deg} 20 20)`} />
      ))}
    </svg>
  );
}

function PlanRun({ hidden }) {
  return (
    <ul className={styles.tickerRun} aria-hidden={hidden || undefined}>
      {PLANS.map((plan, i) => (
        <li key={plan} className={i % 2 ? styles.tickerSerif : undefined}>
          {plan}
          <Flower />
        </li>
      ))}
    </ul>
  );
}

export default function PosterLanding() {
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
      {/* ── Hero · lilac ──────────────────────────────────────────── */}
      <section id="home" className={`${styles.panel} ${styles.hero}`} aria-labelledby="hero-title">
        <div className={`${styles.inner} ${styles.heroInner}`}>
          <div className={styles.heroCopy}>
            <h1 id="hero-title" className={styles.headline}>
              <span className={styles.line}>find your</span>
              <span className={styles.line}>
                <span className={styles.chip} aria-hidden="true">
                  <img src={grassFriends} alt="" width="1200" height="800" decoding="async" />
                </span>
                <span className={styles.people}>
                  people
                  <svg className={styles.squiggle} viewBox="0 0 300 24" preserveAspectRatio="none" aria-hidden="true">
                    <path d="M4 14 C 30 2, 48 22, 76 12 S 124 2, 150 12 S 198 22, 224 12 S 272 2, 296 12" />
                  </svg>
                </span>
              </span>
              <span className={styles.line}>
                on campus
                <span className={`${styles.chip} ${styles.chipRound}`} aria-hidden="true">
                  <img src={laptopPair} alt="" width="800" height="1066" decoding="async" />
                </span>
              </span>
            </h1>

            <p className={styles.lead}>
              Circles, plans and chats with the students around you. Built for
              campus life that happens in person, not in a group chat with
              four hundred strangers.
            </p>

            <div className={styles.actions}>
              <Link to="/signup" className="lp-btn lp-btn--solid">Create your account</Link>
              <Link to="/login" className="lp-btn">Log in</Link>
            </div>

            <p className={styles.proof}>
              <strong>300+ students</strong> already in, and every one of them verified.
            </p>
          </div>

          <figure className={styles.heroArch}>
            <img
              src={skyFriends}
              alt="Three friends laughing together under a clear blue sky"
              width="900"
              height="1200"
              fetchpriority="high"
              decoding="async"
            />
          </figure>
        </div>
      </section>

      {/* ── Plans ticker · ink ────────────────────────────────────── */}
      <div className={styles.ticker}>
        <p className={styles.srOnly}>Plans students post: {PLANS.join(', ')}.</p>
        <div className={styles.tickerTrack} aria-hidden="true">
          <PlanRun />
          <PlanRun hidden />
        </div>
      </div>

      {/* ── How it works · cream ──────────────────────────────────── */}
      <section id="how-it-works" className={`${styles.panel} ${styles.cream}`} aria-labelledby="how-title">
        <div className={styles.inner}>
          <header className={styles.head}>
            <p className={styles.kicker}>How it works</p>
            <h2 id="how-title" className={styles.title}>
              three steps, <span className={styles.serif}>then go outside.</span>
            </h2>
          </header>

          <ol className={styles.steps}>
            {STEPS.map((step, i) => (
              <li key={step.title} className={styles.step}>
                <div className={`${styles.shape} ${styles[step.shape]}`}>
                  <img src={step.photo} alt={step.alt} width={step.size[0]} height={step.size[1]} loading="lazy" decoding="async" />
                </div>
                <div className={styles.stepBody}>
                  <span className={styles.stepNo} aria-hidden="true">{i + 1}</span>
                  <h3 className={styles.stepTitle}>{step.title}</h3>
                  <p className={styles.stepText}>{step.text}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* ── Features · butter ─────────────────────────────────────── */}
      <section id="features" className={`${styles.panel} ${styles.butter}`} aria-labelledby="features-title">
        <div className={styles.inner}>
          <header className={styles.head}>
            <p className={styles.kicker}>What you can do</p>
            <h2 id="features-title" className={styles.title}>
              everything you need, <span className={styles.serif}>nothing you don’t.</span>
            </h2>
          </header>

          <dl className={styles.menu}>
            {FEATURES.map(([name, text]) => (
              <div key={name} className={styles.menuRow}>
                <dt className={styles.menuName}>{name}</dt>
                <dd className={styles.menuText}>{text}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      {/* ── Chai · sage ───────────────────────────────────────────── */}
      <section className={`${styles.panel} ${styles.sage}`} aria-labelledby="chai-title">
        <div className={`${styles.inner} ${styles.chai}`}>
          <div className={styles.chaiPhoto}>
            <img src={chai} alt="Glasses of chai and a samosa on a table" width="1600" height="900" loading="lazy" decoding="async" />
          </div>
          <div className={styles.chaiCopy}>
            <h2 id="chai-title" className={styles.chaiLine}>chai at 5?</h2>
            <p className={styles.chaiText}>
              Most plans on Meetifyy start this small. Someone posts it, a few
              people say they are in, and that is the whole thing.
            </p>
          </div>
        </div>
      </section>

      {/* ── Circles · peach ───────────────────────────────────────── */}
      <section id="circles" className={`${styles.panel} ${styles.peach}`} aria-labelledby="circles-title">
        <div className={styles.inner}>
          <header className={styles.head}>
            <p className={styles.kicker}>Circles</p>
            <h2 id="circles-title" className={styles.title}>
              circles students <span className={styles.serif}>are starting.</span>
            </h2>
          </header>

          <ul className={styles.cloud}>
            {CIRCLES.map((item) =>
              item.photo ? (
                <li key={item.alt} className={styles.cloudPhoto}>
                  <img src={item.photo} alt={item.alt} width={item.size[0]} height={item.size[1]} loading="lazy" decoding="async" />
                </li>
              ) : (
                <li key={item.name} className={styles.cloudName}>{item.name}</li>
              ),
            )}
          </ul>
        </div>
      </section>

      {/* ── The number · night ────────────────────────────────────── */}
      <section className={`${styles.panel} ${styles.night}`} aria-label="Students on Meetifyy">
        <div className={`${styles.inner} ${styles.stat}`}>
          <p className={styles.statNumber} style={{ backgroundImage: `url(${holiCrowd})` }}>300+</p>
          <p className={styles.statLabel}>
            students already on Meetifyy, <span className={styles.serif}>and every one of them verified.</span>
          </p>
        </div>
      </section>

      {/* ── Voices · cream ────────────────────────────────────────── */}
      <section id="testimonials" className={`${styles.panel} ${styles.cream}`} aria-labelledby="voices-title">
        <div className={styles.inner}>
          <header className={styles.head}>
            <p className={styles.kicker}>From students</p>
            <h2 id="voices-title" className={styles.title}>
              in their <span className={styles.serif}>own words.</span>
            </h2>
          </header>

          <div className={styles.voices}>
            <div className={styles.voicesPhoto}>
              <img src={friendsLaugh} alt="Two friends sitting outdoors and laughing" width="1000" height="1500" loading="lazy" decoding="async" />
            </div>
            <div className={styles.quotes}>
              {VOICES.map((v) => (
                <blockquote key={v.name} className={styles.quote}>
                  <p>“{v.quote}”</p>
                  <footer>{v.name}</footer>
                </blockquote>
              ))}
              <a
                className={styles.storyLink}
                href={`mailto:${config.app.contactEmail}?subject=My%20Meetifyy%20Experience`}
              >
                Tell us your story <span aria-hidden="true">→</span>
              </a>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
