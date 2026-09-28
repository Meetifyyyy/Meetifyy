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
 * Gradient and empty covers need no blur: they render as themselves.
 */
export default function BlurredCover({ cover, className = '' }) {
  const resolved = getCleanCoverUrl(cover);
  const url = !resolved.isEmpty && !resolved.isGradient ? resolved.url : null;
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!url || !canvas) return undefined;
    let cancelled = false;
    const img = new Image();
    img.decoding = 'async';

    const draw = () => {
      if (cancelled || !img.naturalWidth) return;
      const box = canvas.getBoundingClientRect();
      const aspect = box.width > 0 && box.height > 0 ? box.height / box.width : 1 / 3;
      const w = BITMAP_WIDTH;
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
      const m = BITMAP_BLUR_PX * 2;
      ctx.filter = `blur(${BITMAP_BLUR_PX}px)`;
      ctx.drawImage(img, sx, sy, sw, sh, -m, -m, w + m * 2, h + m * 2);
      canvas.dataset.ready = 'true';
    };

    img.onload = draw;
    img.src = url;
    if (img.complete) draw();

    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(draw) : null;
    observer?.observe(canvas);
    return () => {
      cancelled = true;
      img.onload = null;
      observer?.disconnect();
    };
  }, [url]);

  if (resolved.isEmpty) return <div className={`${styles.box} ${styles.empty} ${className}`} />;
  if (resolved.isGradient) {
    return <div className={`${styles.box} ${className}`} style={{ background: resolved.gradient }} />;
  }
  return <canvas ref={canvasRef} className={`${styles.box} ${className}`} aria-hidden="true" />;
}
