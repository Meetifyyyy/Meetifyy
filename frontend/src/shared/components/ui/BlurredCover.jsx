import { useEffect, useRef } from 'react';
import { getCleanCoverUrl } from './CoverImage';
import styles from './BlurredCover.module.css';

/** Width of the blurred bitmap, in pixels. Stretched to fill the box by the GPU. */
const BITMAP_WIDTH = 48;
/** Blur applied while drawing the small bitmap (≈ 20px once stretched). */
const BITMAP_BLUR_PX = 2;

/**
 * A cover, blurred once and cheaply: drawn into a canvas about 48px wide with
 * a small blur, then stretched to fill its box.
 *
 * A CSS `filter: blur()` over a full-size layer is among the most expensive
 * things a compositor can be asked to keep; stretching a tiny bitmap is almost
 * free (bilinear filtering does the rest), and nothing is recomputed while the
 * page scrolls or is pulled — callers only change this element's opacity.
 *
 * The crop matches CoverImage's `object-fit: cover`. Drawing a cross-origin
 * image into a canvas that is only DISPLAYED is allowed (it taints the canvas
 * for reading, which never happens), so media needs no CORS for this.
 * `bitmapWidth` and `blurPx` set how soft it is (a wider bitmap with a smaller
 * blur keeps more of the picture; the defaults are the profile cover's).
 * Gradient and empty covers need no blur: they render as themselves.
 */
export default function BlurredCover({
  cover,
  className = '',
  bitmapWidth = BITMAP_WIDTH,
  blurPx = BITMAP_BLUR_PX,
  sources = null,
  onReady,
  onFail,
  onSourceError,
}) {
  const resolved = getCleanCoverUrl(cover);
  const url = !resolved.isEmpty && !resolved.isGradient ? resolved.url : null;
  // `sources`: addresses to try in turn (a thumbnail first, then the original),
  // used instead of `cover` when given. `onReady` is called once the picture
  // has drawn, `onFail` if none of the addresses loads, `onSourceError(url)` for
  // each address that did not.
  const list = sources && sources.length ? sources : url ? [url] : [];
  const listKey = list.join('|');
  const canvasRef = useRef(null);
  const callbacks = useRef({ onReady, onFail, onSourceError });
  callbacks.current = { onReady, onFail, onSourceError };

  useEffect(() => {
    const canvas = canvasRef.current;
    const addresses = listKey ? listKey.split('|') : [];
    if (!addresses.length || !canvas) return undefined;
    let cancelled = false;
    let img = null;
    let index = 0;
    let drawn = false;

    const draw = () => {
      if (cancelled || !img || !img.naturalWidth) return;
      const box = canvas.getBoundingClientRect();
      const aspect = box.width > 0 && box.height > 0 ? box.height / box.width : 1 / 3;
      const w = bitmapWidth;
      const h = Math.max(4, Math.round(w * aspect));
      if (canvas.width !== w) canvas.width = w;
      if (canvas.height !== h) canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      // object-fit: cover — the largest centred crop with the box's aspect.
      const srcAspect = img.naturalHeight / img.naturalWidth;
      let sw = img.naturalWidth;
      let sh = img.naturalHeight;
      if (srcAspect > aspect) sh = sw * aspect;
      else sw = sh / aspect;
      const sx = (img.naturalWidth - sw) / 2;
      const sy = (img.naturalHeight - sh) / 2;
      // Drawn past the edges by the blur radius, so the blur has image to
      // sample there instead of fading to transparent at the border.
      const m = blurPx * 2;
      ctx.filter = `blur(${blurPx}px)`;
      ctx.drawImage(img, sx, sy, sw, sh, -m, -m, w + m * 2, h + m * 2);
      canvas.dataset.ready = 'true';
      if (!drawn) {
        drawn = true;
        callbacks.current.onReady?.();
      }
    };

    const load = () => {
      if (cancelled) return;
      if (index >= addresses.length) {
        callbacks.current.onFail?.();
        return;
      }
      const address = addresses[index];
      const attempt = new Image();
      img = attempt;
      attempt.decoding = 'async';
      attempt.onload = draw;
      attempt.onerror = () => {
        if (cancelled || img !== attempt) return;
        callbacks.current.onSourceError?.(address);
        index += 1;
        load();
      };
      attempt.src = address;
      if (attempt.complete && attempt.naturalWidth) draw();
    };
    load();

    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(draw) : null;
    observer?.observe(canvas);
    return () => {
      cancelled = true;
      if (img) {
        img.onload = null;
        img.onerror = null;
      }
      observer?.disconnect();
    };
  }, [listKey, bitmapWidth, blurPx]);

  if (!list.length && resolved.isEmpty) return <div className={`${styles.box} ${styles.empty} ${className}`} />;
  if (!list.length && resolved.isGradient) {
    return <div className={`${styles.box} ${className}`} style={{ background: resolved.gradient }} />;
  }
  return <canvas ref={canvasRef} className={`${styles.box} ${className}`} aria-hidden="true" />;
}
