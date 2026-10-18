import { useEffect, useLayoutEffect, useRef } from 'react';
import { initialOffset, resolveSheetSnap, snapOffset } from './coverSheetSnap';

/**
 * The Edit cover sheet's gestures on phones: it opens at its usual height,
 * grows to full screen, and is dismissed by dragging it down.
 *
 * - The sheet is laid out once at full height (top at the status-bar inset)
 *   and only ever moved with a composited `translate3d`; nothing animates
 *   height, so a drag never re-lays-out the grid. The footer carries the
 *   opposite offset, so Save stays on screen at the opening height.
 * - Scrolling the body is native, fling included. The first scroll while at
 *   the opening height expands the sheet (a passive `scroll` listener).
 * - Dragging the header moves the sheet both ways. Dragging the body moves it
 *   only downward, and only when the body is at its top: from full screen
 *   that returns to the opening height, from there it closes.
 * - Touch events, painted at most once per frame from requestAnimationFrame.
 *   Release settles on a snap from `resolveSheetSnap` with a 250ms ease;
 *   prefers-reduced-motion snaps without animating.
 * - The rounded top corners flatten at full screen by toggling
 *   `data-expanded` once, not by writing a radius every frame.
 *
 * Wider screens (the centred card) get none of this: every inline style is
 * cleared and the card keeps its CSS layout.
 *
 * Returns refs for the sheet, its drag header, scrolling body and footer.
 */
export function useExpandableCoverSheet(onClose, { enabled = true, media = '(max-width: 768px)' } = {}) {
  const sheetRef = useRef(null);
  const headerRef = useRef(null);
  const bodyRef = useRef(null);
  const footerRef = useRef(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  // Layout effect: the sheet must be placed off screen before its first paint.
  useLayoutEffect(() => {
    const sheet = sheetRef.current;
    const body = bodyRef.current;
    const footer = footerRef.current;
    const header = headerRef.current;
    if (!sheet || !body || !footer || !enabled || typeof window === 'undefined' || !window.matchMedia) return undefined;

    const mq = window.matchMedia(media);
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const EASE = 'cubic-bezier(0.22, 1, 0.36, 1)';
    const SNAP_MS = 250;

    let height = 0;
    let initial = 0;
    let y = 0;
    let snap = 'initial';
    let active = false;
    let closing = false;
    let frame = 0;
    let timer = 0;

    // Gesture state.
    let armed = false;
    let dragging = false;
    let fromHeader = false;
    let startX = 0;
    let startY = 0;
    let baseY = 0;
    let fingerY = 0;
    let lastY = 0;
    let lastT = 0;
    let velocity = 0;
    let dragFrom = 'initial';

    const setTransition = (ms) => {
      const move = ms > 0 ? `transform ${ms}ms ${EASE}` : '';
      // The corner radius keeps its own short ease, even mid-drag.
      const corners = reduceMotion.matches ? '' : 'border-radius 200ms ease';
      sheet.style.transition = [move, corners].filter(Boolean).join(', ') || 'none';
      footer.style.transition = move || 'none';
    };

    const paint = (offset) => {
      y = offset;
      sheet.style.transform = `translate3d(0, ${offset}px, 0)`;
      // At or above the opening height the footer sits on the screen's bottom
      // edge; past it, it leaves with the sheet.
      const lift = Math.min(offset, initial);
      footer.style.transform = lift ? `translate3d(0, ${-lift}px, 0)` : '';
      const expanded = initial > 0 && offset < initial / 2;
      if ((sheet.dataset.expanded === 'true') !== expanded) sheet.dataset.expanded = String(expanded);
    };

    const measure = () => {
      height = sheet.offsetHeight || window.innerHeight;
      // The body fills the full-height sheet, so its own height says nothing
      // about the content; measure to the bottom of its last child instead.
      const last = body.lastElementChild;
      const content = last
        ? last.getBoundingClientRect().bottom - body.getBoundingClientRect().top + body.scrollTop
          + (parseFloat(window.getComputedStyle(body).paddingBottom) || 0)
        : 0;
      const natural = (header?.offsetHeight || 0) + content + footer.offsetHeight;
      initial = initialOffset({ height, natural, viewport: window.innerHeight });
    };

    const settle = (to, ms) => {
      if (timer) { window.clearTimeout(timer); timer = 0; }
      snap = to;
      const instant = reduceMotion.matches ? 0 : ms;
      setTransition(instant);
      paint(snapOffset(to, { initial, height }));
      if (to === 'close') {
        closing = true;
        timer = window.setTimeout(() => {
          onCloseRef.current?.();
          // A caller that keeps the sheet mounted gets it back where it opened.
          closing = false;
          snap = 'initial';
          setTransition(0);
          paint(initial);
          sheet.style.willChange = '';
        }, instant);
      } else {
        timer = window.setTimeout(() => { sheet.style.willChange = ''; }, instant);
      }
    };

    const clear = () => {
      active = false;
      for (const el of [sheet, footer]) {
        el.style.transform = '';
        el.style.transition = '';
        el.style.willChange = '';
      }
      delete sheet.dataset.expanded;
    };

    const activate = () => {
      active = true;
      // The CSS entrance would fight the inline transform; it is run here.
      sheet.style.animation = 'none';
      measure();
      setTransition(0);
      paint(height + 24);
      if (reduceMotion.matches) {
        paint(initial);
        return;
      }
      // Force the off-screen position to apply before animating from it.
      sheet.getBoundingClientRect();
      settle('initial', 320);
    };

    const onMedia = () => {
      if (mq.matches) activate();
      else clear();
    };

    const onResize = () => {
      if (!active || dragging || closing) return;
      measure();
      setTransition(0);
      paint(snapOffset(snap, { initial, height }));
    };

    const onScroll = () => {
      // Native scrolling at the opening height means "show me more".
      if (active && !dragging && !closing && snap === 'initial' && initial > 0 && body.scrollTop > 4) {
        sheet.style.willChange = 'transform';
        settle('full', SNAP_MS);
      }
    };

    const onFrame = () => {
      frame = 0;
      let next = baseY + (fingerY - startY);
      // The header may lift the sheet to full screen, never beyond it.
      next = Math.max(fromHeader ? 0 : baseY, next);
      paint(Math.max(0, next));
    };

    const onStart = (e) => {
      if (!active || closing || e.touches.length !== 1) return;
      const target = e.target;
      fromHeader = Boolean(header && header.contains(target));
      if (!fromHeader && body.contains(target) && body.scrollTop > 0) return;
      armed = true;
      dragging = false;
      startY = fingerY = lastY = e.touches[0].clientY;
      startX = e.touches[0].clientX;
      lastT = e.timeStamp;
      velocity = 0;
    };

    const onMove = (e) => {
      if (!armed) return;
      const cy = e.touches[0].clientY;
      const dy = cy - startY;
      if (!dragging) {
        const dx = Math.abs(e.touches[0].clientX - startX);
        if (dx > 6 && dx >= Math.abs(dy)) { armed = false; return; }
        // Upward in the body is a scroll (which expands via onScroll).
        if (!fromHeader && dy < -4) { armed = false; return; }
        if (Math.abs(dy) < 6 || Math.abs(dy) < dx) return;
        if (fromHeader && dy < 0 && snap === 'full') { armed = false; return; }
        dragging = true;
        startY = cy;
        if (timer) { window.clearTimeout(timer); timer = 0; }
        baseY = y;
        dragFrom = snap;
        sheet.style.willChange = 'transform';
        setTransition(0);
      }
      e.preventDefault();
      const dt = e.timeStamp - lastT;
      if (dt > 0) velocity = velocity * 0.6 + ((cy - lastY) / dt) * 0.4;
      lastY = cy;
      lastT = e.timeStamp;
      fingerY = cy;
      if (!frame) frame = window.requestAnimationFrame(onFrame);
    };

    const onEnd = (e) => {
      if (!armed) return;
      armed = false;
      if (!dragging) return;
      dragging = false;
      if (frame) { window.cancelAnimationFrame(frame); frame = 0; onFrame(); }
      // A finger that stopped before lifting is not a flick.
      const stale = e && e.timeStamp - lastT > 80;
      const speed = stale ? 0 : velocity;
      const to = resolveSheetSnap({ y, velocity: speed, initial, visible: height - initial, from: dragFrom });
      if (to === 'close') {
        const remaining = height + 24 - y;
        settle('close', Math.round(Math.min(320, Math.max(160, remaining / Math.max(speed, 1.2)))));
      } else {
        settle(to, SNAP_MS);
      }
    };

    if (mq.matches) activate();
    mq.addEventListener?.('change', onMedia);
    window.addEventListener('resize', onResize, { passive: true });
    body.addEventListener('scroll', onScroll, { passive: true });
    sheet.addEventListener('touchstart', onStart, { passive: true });
    // Non-passive: only a cancelled touchmove can claim the gesture.
    sheet.addEventListener('touchmove', onMove, { passive: false });
    sheet.addEventListener('touchend', onEnd, { passive: true });
    sheet.addEventListener('touchcancel', onEnd, { passive: true });
    return () => {
      window.clearTimeout(timer);
      if (frame) window.cancelAnimationFrame(frame);
      mq.removeEventListener?.('change', onMedia);
      window.removeEventListener('resize', onResize);
      body.removeEventListener('scroll', onScroll);
      sheet.removeEventListener('touchstart', onStart);
      sheet.removeEventListener('touchmove', onMove);
      sheet.removeEventListener('touchend', onEnd);
      sheet.removeEventListener('touchcancel', onEnd);
    };
  }, [enabled, media]);

  return { sheetRef, headerRef, bodyRef, footerRef };
}

export default useExpandableCoverSheet;
