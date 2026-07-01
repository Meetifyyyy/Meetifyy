import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import logo from '../assets/images/logo.webp';
import heroIllustration from '../assets/images/hero-illustration.webp';
import heroBg from '../assets/images/download.png';
import '../styles/landing.css';

/* ─── tiny hook: reveal on scroll ─── */
function useReveal() {
  useEffect(() => {
    const io = new IntersectionObserver(
      entries => entries.forEach(e => { if (e.isIntersecting) e.target.classList.add('is-visible'); }),
      { threshold: 0.12, rootMargin: '0px 0px -48px 0px' }
    );
    document.querySelectorAll('[data-reveal]').forEach(el => io.observe(el));
    return () => io.disconnect();
  }, []);
}

export default function LandingPage() {
  const navigate = useNavigate();
  useReveal();

  /* ─── data ─── */
  const steps = [
    { num: '01', title: 'Set up your profile', desc: 'Who are you, what are you into, what are you working on. That\'s it.' },
    { num: '02', title: 'Find your communities', desc: 'Browse by topic, search by interest, or see what your university is already talking about.' },
    { num: '03', title: 'Actually show up', desc: 'Post, reply, follow people, start threads. The connections happen when you participate.' },
  ];

  const tags = [
    { name: 'Startups', color: '#094887' },
    { name: 'Design', color: '#EC4899' },
    { name: 'Engineering', color: '#3B82F6' },
    { name: 'Music', color: '#F59E0B' },
    { name: 'Photography', color: '#8B5CF6' },
    { name: 'Gaming', color: '#06B6D4' },
    { name: 'AI & ML', color: '#10B981' },
    { name: 'Art', color: '#A855F7' },
    { name: 'Fitness', color: '#EF4444' },
    { name: 'Science', color: '#0EA5E9' },
    { name: 'Writing', color: '#14B8A6' },
    { name: 'Film', color: '#D946EF' },
  ];

  return (
    <div className="lp-root">

      {/* ═══════════════ NAV — absolute, floats over the hero ═══════════════ */}
      <header className="lp-nav">
        <div className="lp-nav-inner">
          <div className="lp-nav-brand" onClick={() => navigate('/')} role="button" tabIndex={0} onKeyDown={e => e.key === 'Enter' && navigate('/')}>
            <img src={logo} alt="Meetifyy logo" className="lp-nav-logo" />
            <span className="lp-nav-wordmark">Meetifyy</span>
          </div>
          <nav className="lp-nav-links" aria-label="Main navigation">
            <a href="#how" className="lp-nav-link">How it works</a>
            <a href="#explore" className="lp-nav-link">Explore</a>
          </nav>
          <div className="lp-nav-actions">
            <button className="lp-nav-btn-ghost" onClick={() => navigate('/login')}>Log in</button>
            <button className="lp-nav-btn-primary" onClick={() => navigate('/signup')}>
              Get started free
            </button>
          </div>
        </div>
      </header>

      {/* ═══════════════ SCROLL CONTAINER — single continuous bg image ═══════════════ */}
      <div className="lp-scroll lp-scroll--bg" style={{ backgroundImage: `url(${heroBg})` }}>

        <section className="lp-hero">
          {/* Overlay only — bg image is on the scroll container */}
          <div className="lp-hero-bg" aria-hidden="true">
            <div className="lp-hero-overlay" />
            <div className="lp-hero-orb lp-hero-orb--1" />
            <div className="lp-hero-orb lp-hero-orb--2" />
          </div>

          <div className="lp-hero-split">

            {/* ── LEFT: Text ── */}
            <div className="lp-hero-left">
              <h1 className="lp-hero-title" data-reveal>
                Find people who<br />
                <span className="lp-hero-title-accent">think like you.</span>
              </h1>

              <p className="lp-hero-sub" data-reveal>
                Communities, conversations, and collaborators —
                built around what you actually care about.
              </p>

              <div className="lp-hero-ctas" data-reveal>
                <button className="lp-cta-primary" onClick={() => navigate('/signup')}>
                  Join Meetifyy
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>
                  </svg>
                </button>
                <button className="lp-cta-ghost" onClick={() => navigate('/login')}>
                  Already have an account
                </button>
              </div>
            </div>

            {/* ── RIGHT: Illustration + floating cards ── */}
            <div className="lp-hero-right" aria-hidden="true">

              <div className="lp-hero-illus-wrap">
                <img
                  src={heroIllustration}
                  alt="People connecting on Meetifyy"
                  className="lp-hero-illus"
                  loading="eager"
                  draggable="false"
                />
              </div>

              <div className="lp-acard lp-acard--1">
                <span className="lp-acard-dot" style={{ background: '#10B981' }} />
                <div className="lp-acard-text"><strong>Sarah</strong> just joined Design Thinkers</div>
              </div>

              <div className="lp-acard lp-acard--2">
                <span className="lp-acard-dot" style={{ background: '#3B82F6' }} />
                <div className="lp-acard-text"><strong>Alex</strong> posted in Startup Builders</div>
              </div>

              <div className="lp-acard lp-acard--3">
                <span className="lp-acard-dot" style={{ background: '#F59E0B' }} />
                <div className="lp-acard-text">New discussion in <strong>Engineering</strong></div>
              </div>

              <div className="lp-acard lp-acard--4">
                <div className="lp-acard-avatars">
                  {['#094887','#3B82F6','#EC4899'].map((c, i) => (
                    <div key={i} className="lp-acard-avatar" style={{ background: c, marginLeft: i ? '-8px' : 0 }}>{String.fromCharCode(65 + i)}</div>
                  ))}
                </div>
                <div className="lp-acard-text"><strong>Maya</strong> followed James</div>
              </div>

            </div>
          </div>
        </section>

        {/* ─── HOW IT WORKS ─── */}
        <section className="lp-section lp-section--transparent" id="how">
          <div className="lp-section-inner">

            <div className="lp-section-heading" data-reveal>
              <span className="lp-section-label">How it works</span>
              <h2 className="lp-section-h2">
                Three steps.<br />
                <span className="lp-accent">Zero confusion.</span>
              </h2>
            </div>

            <div className="lp-steps">
              {steps.map((s, i) => (
                <div key={i} className="lp-step" data-reveal style={{ '--delay': `${i * 100}ms` }}>
                  <div className="lp-step-num">{s.num}</div>
                  <div className="lp-step-body">
                    <h3 className="lp-step-title">{s.title}</h3>
                    <p className="lp-step-desc">{s.desc}</p>
                  </div>
                  {i < steps.length - 1 && (
                    <div className="lp-step-connector" aria-hidden="true">
                      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="9 18 15 12 9 6"/>
                      </svg>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ─── EXPLORE / COMMUNITIES ─── */}
        <section className="lp-section lp-section--transparent" id="explore">
          <div className="lp-section-inner">

            <div className="lp-section-heading" data-reveal>
              <span className="lp-section-label">Explore</span>
              <h2 className="lp-section-h2">
                Find your people<br />
                <span className="lp-accent">by interest.</span>
              </h2>
              <p className="lp-section-tagline">Every community below has real conversations happening right now.</p>
            </div>

            <div className="lp-tags" data-reveal>
              {tags.map((t, i) => (
                <button
                  key={i}
                  className="lp-tag"
                  style={{ '--tag-c': t.color }}
                  onClick={() => navigate('/login')}
                  aria-label={`Explore ${t.name} community`}
                >
                  <span className="lp-tag-dot" />
                  {t.name}
                </button>
              ))}
            </div>
          </div>
        </section>

        {/* ─── FOOTER ─── */}
        <footer className="lp-footer">
          <div className="lp-footer-inner">
            <div className="lp-footer-top">
              <div className="lp-footer-brand">
                <img src={logo} alt="Meetifyy" className="lp-nav-logo" />
                <span className="lp-footer-wordmark">Meetifyy</span>
                <p className="lp-footer-tagline">Where like-minded people meet.</p>
              </div>

              <div className="lp-footer-socials">
                {/* Instagram */}
                <a
                  href="https://www.instagram.com/meetifyy._/?hl=en"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="lp-footer-social-link lp-footer-social-link--ig"
                  aria-label="Meetifyy on Instagram"
                  title="Instagram"
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <rect x="2" y="2" width="20" height="20" rx="5" ry="5"/>
                    <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"/>
                    <line x1="17.5" y1="6.5" x2="17.51" y2="6.5"/>
                  </svg>
                </a>

                {/* Threads */}
                <a
                  href="https://www.threads.com/@meetifyy._?igshid=NTc4MTIwNjQ2YQ=="
                  target="_blank"
                  rel="noopener noreferrer"
                  className="lp-footer-social-link lp-footer-social-link--threads"
                  aria-label="Meetifyy on Threads"
                  title="Threads"
                >
                  {/* Official Threads @ icon */}
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                    <path d="M12.186 24h-.007c-3.581-.024-6.334-1.205-8.184-3.509C2.35 18.44 1.5 15.586 1.472 12.01v-.017c.03-3.579.879-6.43 2.525-8.482C5.845 1.205 8.6.024 12.18 0h.014c2.746.02 5.043.725 6.826 2.098 1.677 1.29 2.858 3.13 3.509 5.467l-2.04.569c-1.104-3.96-3.898-5.984-8.304-6.015-2.91.022-5.11.936-6.54 2.717C4.307 6.504 3.616 8.914 3.589 12c.027 3.086.718 5.496 2.057 7.164 1.43 1.783 3.631 2.698 6.54 2.717 2.623-.02 4.358-.631 5.8-2.045 1.647-1.613 1.618-3.593 1.09-4.798-.31-.71-.873-1.3-1.634-1.75-.192 1.352-.622 2.446-1.284 3.272-.886 1.102-2.14 1.704-3.73 1.79-1.202.065-2.361-.218-3.259-.801-1.063-.689-1.685-1.74-1.752-2.964-.065-1.19.408-2.285 1.33-3.082.88-.76 2.119-1.207 3.583-1.291a13.853 13.853 0 0 1 3.02.142c-.126-.742-.375-1.332-.75-1.757-.513-.586-1.308-.883-2.397-.904h-.056c-.96 0-2.228.265-3.054 1.604l-1.737-1.089C8.985 4.192 10.82 3.443 12.8 3.443h.113c3.367.064 5.375 2.012 5.517 5.39a9.47 9.47 0 0 1 .11.88 6.14 6.14 0 0 1 1.636 1.229c1.045 1.148 1.573 2.714 1.436 4.296-.135 1.549-.81 2.992-1.9 4.065-1.811 1.768-4.099 2.65-6.986 2.697h-.54Zm.217-7.688c1.428-.077 2.368-.933 2.619-2.395a11.985 11.985 0 0 0-2.928-.22c-1.575.09-2.443.794-2.395 1.88.043.814.732 1.371 1.902 1.371a3.9 3.9 0 0 0 .802-.086v-.55Z"/>
                  </svg>
                </a>

                {/* LinkedIn */}
                <a
                  href="https://www.linkedin.com/company/meetifyy/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="lp-footer-social-link lp-footer-social-link--li"
                  aria-label="Meetifyy on LinkedIn"
                  title="LinkedIn"
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                    <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.064 2.064 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/>
                  </svg>
                </a>
              </div>
            </div>

            <div className="lp-footer-bottom">
              <span className="lp-footer-copy">© 2026 Meetifyy. All rights reserved.</span>
            </div>
          </div>
        </footer>
      </div>
    </div>
  );
}
