import { useState, useEffect, useRef } from 'react';
import { useAuth } from '../../context/AuthContext';
import { X, Download } from 'lucide-react';
import styles from './InstallPopup.module.css';

export default function InstallPopup() {
  const { isLoggedIn } = useAuth();
  const [show, setShow] = useState(false);
  const deferredPrompt = useRef(null);

  useEffect(() => {
    if (!isLoggedIn) return;

    const isInstalled = window.matchMedia('(display-mode: standalone)').matches ||
      window.navigator.standalone === true;

    if (isInstalled) return;

    const handler = (e) => {
      e.preventDefault();
      deferredPrompt.current = e;
    };
    window.addEventListener('beforeinstallprompt', handler);

    const key = 'meetify_visit_count';
    const raw = localStorage.getItem(key);
    const count = raw ? parseInt(raw, 10) + 1 : 1;
    localStorage.setItem(key, count.toString());

    const dismissed = localStorage.getItem('meetify_install_dismissed');
    if (dismissed === 'true') return;

    if (count % 2 === 0) {
      setShow(true);
    }

    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, [isLoggedIn]);

  const handleInstall = async () => {
    const prompt = deferredPrompt.current;
    if (prompt) {
      prompt.prompt();
      const result = await prompt.userChoice;
      deferredPrompt.current = null;
      if (result.outcome === 'accepted') {
        localStorage.setItem('meetify_visit_count', '0');
      }
    }
    setShow(false);
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
        <button className={styles.close} onClick={handleClose} aria-label="Close">
          <X size={18} />
        </button>
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
      </div>
    </div>
  );
}