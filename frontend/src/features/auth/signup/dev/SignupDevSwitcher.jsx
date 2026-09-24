import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useSignup } from '../../context/SignupContext';

const POS_KEY = 'meetifyy_dev_switcher_pos';
const EDGE = 8;

function readPos() {
  try {
    const v = JSON.parse(sessionStorage.getItem(POS_KEY) || 'null');
    return v && Number.isFinite(v.x) && Number.isFinite(v.y) ? v : null;
  } catch {
    return null;
  }
}

/**
 * TEMPORARY dev-only step switcher. Rendered only when SIGNUP_DEV_BYPASS is
 * true (see signupDevBypass.js); absent from production bundles.
 *
 * Two buttons: back and forward. Forward past the last step opens the
 * finishing-screen preview (no API call, no navigation); back from the
 * preview returns to the last step. Drag it by the grip (or any part that is
 * not a button) to get it out of the way; the position is kept for the tab.
 */
export default function SignupDevSwitcher() {
  const { currentStep, totalSteps, goToStep, finishing, setFinishing, signupData } = useSignup();
  const barRef = useRef(null);
  const [pos, setPos] = useState(readPos);
  const drag = useRef(null);

  // Keep the bar on screen when the window shrinks.
  const clamp = useCallback((x, y) => {
    const el = barRef.current;
    const w = el ? el.offsetWidth : 120;
    const h = el ? el.offsetHeight : 44;
    return {
      x: Math.min(Math.max(x, EDGE), window.innerWidth - w - EDGE),
      y: Math.min(Math.max(y, EDGE), window.innerHeight - h - EDGE),
    };
  }, []);

  useEffect(() => {
    const onResize = () => setPos((p) => (p ? clamp(p.x, p.y) : p));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [clamp]);

  const onPointerDown = (e) => {
    if (e.target.closest('button')) return;
    const r = barRef.current.getBoundingClientRect();
    drag.current = { dx: e.clientX - r.left, dy: e.clientY - r.top };
    e.currentTarget.setPointerCapture(e.pointerId);
    e.preventDefault();
  };

  const onPointerMove = (e) => {
    if (!drag.current) return;
    setPos(clamp(e.clientX - drag.current.dx, e.clientY - drag.current.dy));
  };

  const onPointerUp = (e) => {
    if (!drag.current) return;
    drag.current = null;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    setPos((p) => {
      try { if (p) sessionStorage.setItem(POS_KEY, JSON.stringify(p)); } catch { /* dev only */ }
      return p;
    });
  };

  const back = () => {
    if (finishing) setFinishing(false);
    else goToStep(currentStep - 1);
  };
  const forward = () => {
    if (currentStep >= totalSteps) setFinishing({ avatar: signupData.avatar || '', preview: true });
    else goToStep(currentStep + 1);
  };

  const btn = {
    width: 36,
    height: 32,
    borderRadius: 8,
    border: '1px solid rgba(255,255,255,0.22)',
    background: 'rgba(255,255,255,0.08)',
    color: '#fff',
    font: '600 15px/1 system-ui, sans-serif',
    cursor: 'pointer',
  };

  const placement = pos
    ? { left: pos.x, top: pos.y }
    : { left: '50%', top: 'calc(8px + env(safe-area-inset-top, 0px))', transform: 'translateX(-50%)' };

  // Portalled: the auth panel's `contain: paint` would otherwise make this
  // `position: fixed` element relative to the card.
  return createPortal(
    <div
      ref={barRef}
      role="toolbar"
      aria-label="Dev: signup steps"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      style={{
        position: 'fixed',
        ...placement,
        // Above everything, the cookie banner included: it is a dev tool.
        zIndex: 2147483000,
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        padding: 5,
        borderRadius: 12,
        background: 'rgba(17, 17, 17, 0.88)',
        border: '1px dashed #f59e0b',
        boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
        cursor: 'grab',
        touchAction: 'none',
        userSelect: 'none',
      }}
    >
      {/* Grip: six dots, drawn, not typed. */}
      <span
        aria-hidden="true"
        style={{
          width: 10,
          height: 18,
          margin: '0 3px 0 2px',
          backgroundImage: 'radial-gradient(circle, #f59e0b 1.2px, transparent 1.6px)',
          backgroundSize: '5px 6px',
        }}
      />
      <button
        type="button"
        style={{ ...btn, opacity: !finishing && currentStep <= 1 ? 0.4 : 1 }}
        disabled={!finishing && currentStep <= 1}
        onClick={back}
        aria-label="Previous step"
      >
        ←
      </button>
      <button
        type="button"
        style={{ ...btn, opacity: finishing ? 0.4 : 1 }}
        disabled={!!finishing}
        onClick={forward}
        aria-label={currentStep >= totalSteps ? 'Preview finishing screen' : 'Next step'}
      >
        →
      </button>
    </div>,
    document.body,
  );
}
