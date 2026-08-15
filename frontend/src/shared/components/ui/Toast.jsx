import { useEffect } from 'react';
import styles from './Toast.module.css';

export default function Toast({ message, visible, onHide }) {
  useEffect(() => {
    if (visible) {
      const t = setTimeout(onHide, 2500);
      return () => clearTimeout(t);
    }
  }, [visible, onHide]);

  return (
    <div className={`${styles.toast}${visible ? ` ${styles.visible}` : ''}`} id="toast" role="alert">
      <span>{message}</span>
    </div>
  );
}
