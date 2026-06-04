import { useEffect, useRef } from 'react';

export default function ConfirmModal({ title, desc, visible, onCancel, onConfirm }) {
  const overlayRef = useRef(null);

  useEffect(() => {
    if (visible && overlayRef.current) {
      requestAnimationFrame(() => overlayRef.current?.classList.add('open'));
    }
  }, [visible]);

  if (!visible) return null;

  const handleClose = () => {
    overlayRef.current?.classList.remove('open');
    setTimeout(onCancel, 250);
  };

  const handleConfirm = () => {
    overlayRef.current?.classList.remove('open');
    setTimeout(onConfirm, 250);
  };

  return (
    <div className="confirm-overlay" ref={overlayRef} onClick={(e) => { if (e.target === overlayRef.current) handleClose(); }}>
      <div className="confirm-modal">
        <div className="confirm-icon">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
            <line x1="12" y1="9" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
        </div>
        <div className="confirm-title">{title}</div>
        <div className="confirm-desc">{desc}</div>
        <div className="confirm-actions">
          <button className="confirm-btn confirm-btn-cancel" onClick={handleClose}>Cancel</button>
          <button className="confirm-btn confirm-btn-leave" onClick={handleConfirm}>Leave</button>
        </div>
      </div>
    </div>
  );
}
