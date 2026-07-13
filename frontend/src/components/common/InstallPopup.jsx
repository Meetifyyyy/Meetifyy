import { useState, useEffect, useRef } from 'react';
import { useAuth } from '../../context/AuthContext';
import { X, Download, CheckCircle, ExternalLink, Share2, Smartphone } from 'lucide-react';
import styles from './InstallPopup.module.css';

function getPlatform() {
  const ua = navigator.userAgent;
  if (/iphone|ipad|ipod/i.test(ua)) return 'ios';
  if (/android/i.test(ua)) return 'android';
  return 'desktop';
}

export default function InstallPopup() {
  const { isLoggedIn } = useAuth();
  const [show, setShow] = useState(false);
  const [mode, setMode] = useState('install'); // 'install' | 'instructions' | 'open-app' | 'installed'
  const deferredPrompt = useRef(null);

  useEffect(() => {
    if (!isLoggedIn) return;

    const isStandalone = window.matchMedia('(display-mode: standalone)').matches ||
      window.navigator.standalone === true;

    // Already inside the installed app — no popup needed
    if (isStandalone) return;

    // Track app opens (once per session) to show popup at interval of 5
    const hasIncremented = sessionStorage.getItem('meetify_session_incremented');
    let opens = parseInt(localStorage.getItem('meetify_app_opens') || '0', 10);
    if (!hasIncremented) {
      opens += 1;
      localStorage.setItem('meetify_app_opens', opens.toString());
      sessionStorage.setItem('meetify_session_incremented', 'true');
    }

    // Only show at an interval of 5
    if (opens % 5 !== 0) return;

    // Listen for the appinstalled event to reliably track installation
    const onInstalled = () => {
      localStorage.setItem('meetify_installed', 'true');
    };
    window.addEventListener('appinstalled', onInstalled);

    const appInstalled = localStorage.getItem('meetify_installed') === 'true';

    if (appInstalled) {
      setMode('open-app');
      setShow(true);
      return () => window.removeEventListener('appinstalled', onInstalled);
    }

    const platform = getPlatform();

    // iOS Safari doesn't support beforeinstallprompt — show instructions directly
    if (platform === 'ios') {
      setMode('instructions');
      setShow(true);
      return () => window.removeEventListener('appinstalled', onInstalled);
    }

    const handler = (e) => {
      e.preventDefault();
      deferredPrompt.current = e;
      setMode('install');
      setShow(true);
    };

    window.addEventListener('beforeinstallprompt', handler);

    // Fallback: if beforeinstallprompt never fires (e.g. desktop without PWA support)
    const fallbackTimer = setTimeout(() => {
      if (!deferredPrompt.current) {
        setMode('instructions');
        setShow(true);
      }
    }, 3000);

    return () => {
      window.removeEventListener('beforeinstallprompt', handler);
      window.removeEventListener('appinstalled', onInstalled);
      clearTimeout(fallbackTimer);
    };
  }, [isLoggedIn]);

  const handleInstall = async () => {
    const prompt = deferredPrompt.current;

    if (prompt) {
      prompt.prompt();
      const result = await prompt.userChoice;
      deferredPrompt.current = null;

      if (result.outcome === 'accepted') {
        localStorage.setItem('meetify_installed', 'true');
        setMode('installed');
        setTimeout(() => {
          setShow(false);
        }, 2000);
      }
    }
  };

  const handleDismiss = () => {
    setShow(false);
  };

  const handleClose = () => {
    setShow(false);
  };

  if (!show) return null;

  const platform = getPlatform();

  return (
    <div className={styles.overlay}>
      <div className={styles.card}>
        {mode !== 'installed' && (
          <button className={styles.close} onClick={handleClose} aria-label="Close">
            <X size={18} />
          </button>
        )}

        {mode === 'installed' && (
          <>
            <div className={styles.iconWrap}>
              <CheckCircle size={28} />
            </div>
            <h3 className={styles.title}>Installed!</h3>
            <p className={styles.desc}>
              Meetifyy has been added to your home screen. Open it anytime from your app drawer.
            </p>
          </>
        )}

        {mode === 'instructions' && (
          <>
            <div className={styles.iconWrap}>
              <Smartphone size={28} />
            </div>
            <h3 className={styles.title}>Install Meetifyy</h3>
            <p className={styles.desc}>
              {platform === 'ios' ? (
                <>Tap the <strong>Share</strong> button <Share2 size={14} style={{ display: 'inline', verticalAlign: 'middle' }} /> in Safari, then scroll down and tap <strong>"Add to Home Screen"</strong>.</>
              ) : (
                <>Open this site in <strong>Chrome</strong>, tap the menu <strong>⋮</strong> and select <strong>"Add to Home Screen"</strong>.</>
              )}
            </p>
            <div className={styles.actions}>
              <button className={styles.installBtn} onClick={handleClose}>
                Got it
              </button>
            </div>
          </>
        )}

        {mode === 'open-app' && (
          <>
            <div className={styles.iconWrap}>
              <ExternalLink size={28} />
            </div>
            <h3 className={styles.title}>Open in App</h3>
            <p className={styles.desc}>
              You already have Meetifyy installed! Open it from your home screen for the best experience.
            </p>
            <div className={styles.actions}>
              <button className={styles.installBtn} onClick={handleClose}>
                Got it
              </button>
            </div>
          </>
        )}

        {mode === 'install' && (
          <>
            <div className={styles.iconWrap}>
              <Download size={28} />
            </div>
            <h3 className={styles.title}>Install Meetifyy</h3>
            <p className={styles.desc}>
              Add Meetifyy to your home screen for the best experience. Quick access, just like a native app.
            </p>
            <div className={styles.actions}>
              <button className={styles.installBtn} onClick={handleInstall}>
                Install
              </button>
              <button className={styles.laterBtn} onClick={handleDismiss}>
                Maybe later
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}