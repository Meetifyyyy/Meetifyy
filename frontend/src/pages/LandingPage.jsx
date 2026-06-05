import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import Background from '../components/common/Background';
import Toast from '../components/common/Toast';
import LoginOverlay from '../components/auth/LoginOverlay';
import SignupOverlay from '../components/auth/SignupOverlay';
import WelcomeGreeting from '../components/auth/WelcomeGreeting';
import logo from '../assets/images/logo.webp';
import heroImg from '../assets/images/hero-illustration.webp';

export default function LandingPage() {
  const { login } = useAuth();
  const navigate = useNavigate();

  const [view, setView] = useState('hero'); // 'hero' | 'login' | 'signup' | 'greeting'
  const [fading, setFading] = useState(false);
  const [toastMsg, setToastMsg] = useState('');
  const [toastVisible, setToastVisible] = useState(false);
  const [greetingUser, setGreetingUser] = useState('');

  const handleProfileClick = () => {
    if (view === 'hero') {
      setFading(true);
      setTimeout(() => {
        setView('login');
      }, 350);
    } else if (view === 'login') {
      setView('signup');
    } else if (view === 'signup') {
      setView('login');
    }
  };

  const handleLogin = useCallback((user) => {
    setGreetingUser(user);
    setView('greeting');
  }, []);

  const handleGreetingComplete = useCallback(() => {
    login(greetingUser);
    navigate('/home');
  }, [greetingUser, login, navigate]);

  const setToast = useCallback((msg) => {
    setToastMsg(msg);
    setToastVisible(true);
  }, []);

  const profileBtnLabel = view === 'login' ? 'Sign up' : view === 'signup' ? 'Log in' : 'Log in';

  const features = [
    {
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />
        </svg>
      ),
      title: 'Find Your People',
      desc: 'Connect with like-minded creators, builders, and dreamers who share your passions.',
    },
    {
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
      ),
      title: 'Real Conversations',
      desc: 'No noise. No algorithms. Just genuine discussions that matter to you.',
    },
    {
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" /><path d="M8 14s1.5 2 4 2 4-2 4-2" /><line x1="9" y1="9" x2="9.01" y2="9" /><line x1="15" y1="9" x2="15.01" y2="9" />
        </svg>
      ),
      title: 'Communities That Click',
      desc: 'Build or join micro-communities around the things that make you come alive.',
    },
  ];

  const steps = [
    { num: '01', title: 'Create Your Space', desc: 'Set up your profile and tell the world what you\'re about.' },
    { num: '02', title: 'Discover & Connect', desc: 'Browse communities, follow interesting people, and start conversations.' },
    { num: '03', title: 'Grow Together', desc: 'Collaborate on ideas, share wins, and build something meaningful.' },
  ];

  const testimonials = [
    { name: 'Maya R.', handle: '@mayabuilds', text: 'Found my entire startup team through Meetify. This place just gets it.', gradient: 'linear-gradient(135deg, #6D5DFC, #A855F7)' },
    { name: 'James K.', handle: '@jamesk_dev', text: 'The communities here feel alive. No empty feeds, no bots — just real people.', gradient: 'linear-gradient(135deg, #F59E0B, #F97316)' },
    { name: 'Priya S.', handle: '@priya_designs', text: 'I\'ve been on every social platform. Meetify is the first one that felt like home.', gradient: 'linear-gradient(135deg, #EC4899, #8B5CF6)' },
  ];

  const communityTags = [
    { name: 'Startups', color: '#6D5DFC' },
    { name: 'Design', color: '#EC4899' },
    { name: 'Music', color: '#F59E0B' },
    { name: 'Dev', color: '#10B981' },
    { name: 'Photography', color: '#8B5CF6' },
    { name: 'Gaming', color: '#06B6D4' },
    { name: 'Travel', color: '#F97316' },
    { name: 'Fitness', color: '#EF4444' },
    { name: 'Art', color: '#A855F7' },
    { name: 'Science', color: '#0EA5E9' },
    { name: 'Writing', color: '#14B8A6' },
    { name: 'Film', color: '#D946EF' },
  ];

  return (
    <>
      <Background />

      <header>
        <div className="nav-left" style={{ cursor: 'pointer' }}>
          <img className="logo" src={logo} alt="Meetify" />
          <span className="brand">Meetify</span>
        </div>
        <nav>
          <div className="profile-link" style={{ textDecoration: 'none', cursor: 'pointer' }} onClick={handleProfileClick}>
            <div className="profile-btn" title="Profile">
              <div className="profile-icon">
                <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                  <path d="M12 12c2.7 0 4.8-2.1 4.8-4.8S14.7 2.4 12 2.4 7.2 4.5 7.2 7.2 9.3 12 12 12zm0 2.4c-3.2 0-9.6 1.6-9.6 4.8v1.2c0 .66.54 1.2 1.2 1.2h16.8c.66 0 1.2-.54 1.2-1.2v-1.2c0-3.2-6.4-4.8-9.6-4.8z" />
                </svg>
              </div>
              <span className="login-text">{profileBtnLabel}</span>
            </div>
          </div>
        </nav>
      </header>

      {/* Scrollable landing content */}
      <div className={`landing-scroll ${view !== 'hero' ? 'landing-scroll--hidden' : ''} ${fading ? 'landing-scroll--fading' : ''}`}>

        <main id="mainContent" style={view !== 'hero' ? { display: 'none' } : {}}>
          <section className="hero">
            <h1>
              <span className="line1">MEET</span>
              <span className="line2">THE OTHER</span>
              <span className="accent">YOU</span>
            </h1>
            <p>your vibe. your tribe. your spotlight.</p>
          </section>

          <div className="hero-image">
            <img src={heroImg} alt="Meetify visual" loading="lazy" />
          </div>

          <span className="fragment fragment--1">Anyone building a startup?</span>
          <span className="fragment fragment--2">Looking for a hackathon team</span>
          <span className="fragment fragment--3">Need a UI designer ✨</span>
          <span className="fragment fragment--4">Let's collaborate 🚀</span>
        </main>

        {/* ---------- Features ---------- */}
        {view === 'hero' && (
          <>
            <section className="landing-section features-section">
              <div className="section-inner">
                <h2 className="landing-heading">
                  Why <span className="text-gradient">Meetify</span>?
                </h2>
                <p className="landing-subheading">A space where connections are real and communities thrive.</p>
                <div className="features-grid">
                  {features.map((f, i) => (
                    <div className="feature-card" key={i}>
                      <div className="feature-icon">{f.icon}</div>
                      <h3>{f.title}</h3>
                      <p>{f.desc}</p>
                    </div>
                  ))}
                </div>
              </div>
            </section>

            {/* ---------- How It Works ---------- */}
            <section className="landing-section steps-section">
              <div className="section-inner">
                <h2 className="landing-heading">
                  How It <span className="text-gradient">Works</span>
                </h2>
                <p className="landing-subheading">Three steps. Zero friction.</p>
                <div className="steps-row">
                  {steps.map((s, i) => (
                    <div className="step-card" key={i}>
                      <span className="step-num">{s.num}</span>
                      <h3>{s.title}</h3>
                      <p>{s.desc}</p>
                      {i < steps.length - 1 && (
                        <div className="step-connector">
                          <svg width="40" height="12" viewBox="0 0 40 12" fill="none">
                            <path d="M0 6h32m0 0l-5-5m5 5l-5 5" stroke="#6D5DFC" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.4" />
                          </svg>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </section>

            {/* ---------- Communities ---------- */}
            <section className="landing-section communities-section">
              <div className="section-inner">
                <h2 className="landing-heading">
                  Explore <span className="text-gradient">Communities</span>
                </h2>
                <p className="landing-subheading">Thousands of people are already here. Find where you belong.</p>
                <div className="community-tags">
                  {communityTags.map((tag, i) => (
                    <span className="community-tag" key={i} style={{ '--tag-color': tag.color }}>
                      <span className="tag-dot" style={{ background: tag.color }} />
                      {tag.name}
                    </span>
                  ))}
                </div>
                <div className="community-stats-row">
                  <div className="community-stat">
                    <span className="community-stat-num">12k+</span>
                    <span className="community-stat-label">Members</span>
                  </div>
                  <div className="community-stat">
                    <span className="community-stat-num">340+</span>
                    <span className="community-stat-label">Communities</span>
                  </div>
                  <div className="community-stat">
                    <span className="community-stat-num">89k+</span>
                    <span className="community-stat-label">Conversations</span>
                  </div>
                </div>
              </div>
            </section>

            {/* ---------- Testimonials ---------- */}
            <section className="landing-section testimonials-section">
              <div className="section-inner">
                <h2 className="landing-heading">
                  Voices from the <span className="text-gradient">Community</span>
                </h2>
                <div className="testimonials-grid">
                  {testimonials.map((t, i) => (
                    <div className="testimonial-card" key={i}>
                      <p className="testimonial-text">"{t.text}"</p>
                      <div className="testimonial-author">
                        <div className="testimonial-avatar" style={{ background: t.gradient }}>
                          {t.name.charAt(0)}
                        </div>
                        <div>
                          <div className="testimonial-name">{t.name}</div>
                          <div className="testimonial-handle">{t.handle}</div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </section>

            {/* ---------- CTA ---------- */}
            <section className="landing-section cta-section">
              <div className="section-inner cta-inner">
                <h2 className="cta-heading">Ready to find your people?</h2>
                <p className="cta-sub">Join thousands who already did.</p>
                <button className="cta-btn" onClick={handleProfileClick}>
                  Get Started
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="5" y1="12" x2="19" y2="12" /><polyline points="12 5 19 12 12 19" />
                  </svg>
                </button>
              </div>
            </section>

            {/* ---------- Footer ---------- */}
            <footer className="landing-footer">
              <div className="footer-inner">
                <div className="footer-top">
                  <div className="footer-brand">
                    <img className="logo" src={logo} alt="Meetify" />
                    <span className="brand">Meetify</span>
                  </div>

                  <div className="footer-links">
                    <div className="footer-col">
                      <h4>Product</h4>
                      <a href="#">Communities</a>
                      <a href="#">Messaging</a>
                      <a href="#">Events</a>
                    </div>
                    <div className="footer-col">
                      <h4>Company</h4>
                      <a href="#">About</a>
                      <a href="#">Blog</a>
                      <a href="#">Careers</a>
                    </div>
                    <div className="footer-col">
                      <h4>Support</h4>
                      <a href="#">Help Center</a>
                      <a href="#">Privacy</a>
                      <a href="#">Terms</a>
                    </div>
                  </div>
                </div>

                <div className="footer-bottom">
                  <span className="footer-copy">&copy; 2026 Meetify. All rights reserved.</span>
                  <div className="footer-socials">
                    <a href="#" aria-label="Twitter">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
                    </a>
                    <a href="#" aria-label="GitHub">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"/></svg>
                    </a>
                    <a href="#" aria-label="Instagram">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="2" width="20" height="20" rx="5" ry="5"/><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"/><line x1="17.5" y1="6.5" x2="17.51" y2="6.5"/></svg>
                    </a>
                  </div>
                </div>
              </div>
            </footer>
          </>
        )}
      </div>

      <LoginOverlay
        visible={view === 'login'}
        onLogin={handleLogin}
        onSwitchToSignup={() => setView('signup')}
        toastMsg={toastMsg}
        setToastMsg={setToast}
      />

      <SignupOverlay
        visible={view === 'signup'}
        onSwitchToLogin={() => setView('login')}
      />

      <WelcomeGreeting
        visible={view === 'greeting'}
        username={greetingUser}
        onComplete={handleGreetingComplete}
      />

      <Toast
        message={toastMsg}
        visible={toastVisible}
        onHide={() => setToastVisible(false)}
      />
    </>
  );
}
