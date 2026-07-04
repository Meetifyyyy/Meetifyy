import { useState, useEffect, useRef } from 'react';
import { useAuth } from '../../context/AuthContext';
import { X, Download, CheckCircle, ExternalLink } from 'lucide-react';
import styles from './InstallPopup.module.css';

export default function InstallPopup() {
  const { isLoggedIn } = useAuth();
  const [show, setShow] = useState(false);
  const [mode, setMode] = useState('install'); // 'install' | 'open-app' | 'installing' | 'installed'
  const [progress, setProgress] = useState(0);
  const deferredPrompt = useRef(null);

  useEffect(() => {
    if (!isLoggedIn) return;

    const isStandalone = window.matchMedia('(display-mode: standalone)').matches ||
      window.navigator.standalone === true;

    // Already inside the installed app — no popup needed
    if (isStandalone) return;

    const appInstalled = localStorage.getItem('meetify_installed') === 'true';

    if (appInstalled) {
      // App is installed but user opened in browser — show "Open in App"
      setMode('open-app');
      setShow(true);
      return;
    }

    const dismissed = localStorage.getItem('meetify_install_dismissed');
    if (dismissed === 'true') return;

    const handler = (e) => {
      e.preventDefault();
      deferredPrompt.current = e;
      setMode('install');
      setShow(true);
    };

    window.addEventListener('beforeinstallprompt', handler);

    // Fallback: show install popup even if beforeinstallprompt never fires
    const fallbackTimer = setTimeout(() => {
      if (!deferredPrompt.current) {
        setMode('install');
        setShow(true);
      }
    }, 3000);

    return () => {
      window.removeEventListener('beforeinstallprompt', handler);
      clearTimeout(fallbackTimer);
    };
  }, [isLoggedIn]);

  const simulateProgress = () => {
    setMode('installing');
    setProgress(0);

    const interval = setInterval(() => {
      setProgress((prev) => {
        if (prev >= 90) {
          clearInterval(interval);
          return 90;
        }
        const increment = prev < 30 ? 15 : prev < 60 ? 8 : prev < 80 ? 4 : 2;
        return Math.min(prev + increment, 90);
      });
    }, 300);
  };

  const handleInstall = async () => {
    const prompt = deferredPrompt.current;

    if (prompt) {
      simulateProgress();
      prompt.prompt();
      const result = await prompt.userChoice;
      deferredPrompt.current = null;

      if (result.outcome === 'accepted') {
        localStorage.setItem('meetify_installed', 'true');
        setProgress(100);
        setMode('installed');
        setTimeout(() => {
          setShow(false);
          setProgress(0);
        }, 1500);
      } else {
        setMode('install');
        setProgress(0);
      }
    } else {
      simulateProgress();
      setTimeout(() => {
        localStorage.setItem('meetify_installed', 'true');
        setProgress(100);
        setMode('installed');
        setTimeout(() => {
          setShow(false);
          setProgress(0);
        }, 1500);
      }, 2000);
    }
  };

  const handleDismiss = () => {
    localStorage.setItem('meetify_install_dismissed', 'true');
    setShow(false);
  };

  const handleClose = () => {
    setShow(false);
  };

  if (!show) return null;

  return (
    <div className={styles.overlay}>
      <div className={styles.card}>
        {mode !== 'installing' && mode !== 'installed' && (
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

        {mode === 'installing' && (
          <>
            <div className={styles.iconWrap}>
              <Download size={28} />
            </div>
            <h3 className={styles.title}>Installing Meetifyy...</h3>
            <div className={styles.progressWrap}>
              <div className={styles.progressBar}>
                <div
                  className={styles.progressFill}
                  style={{ width: `${progress}%` }}
                />
              </div>
              <span className={styles.progressText}>{progress}%</span>
            </div>
            <p className={styles.desc}>
              Please follow the prompts on your browser to complete the installation.
            </p>
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