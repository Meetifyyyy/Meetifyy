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
  const [slideOut, setSlideOut] = useState(false);
  const [toastMsg, setToastMsg] = useState('');
  const [toastVisible, setToastVisible] = useState(false);
  const [greetingUser, setGreetingUser] = useState('');

  const handleProfileClick = () => {
    if (view === 'hero') {
      setSlideOut(true);
      setTimeout(() => {
        setView('login');
      }, 550);
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

  return (
    <>
      <Background />

      <header>
        <div className="nav-left" style={{ cursor: 'pointer' }}>
          <img className="logo" src={logo} alt="Meetify" />
          <span className="brand">Meetify</span>
        </div>
        {view === 'hero' && (
          <div className="header-search">
            <input type="text" className="search-bar" placeholder="Search for people, meetings, or topics..." />
          </div>
        )}
        <nav className={view !== 'hero' ? 'nav-hidden' : ''}>
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

      <main id="mainContent" className={slideOut ? 'slide-out' : ''} style={view !== 'hero' ? { display: 'none' } : {}}>
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
