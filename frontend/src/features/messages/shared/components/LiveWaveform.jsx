import { memo, useEffect, useRef } from 'react';
import { WAVEFORM_SAMPLES } from '@features/messages/hooks/useVoiceRecorder';

/**
 * Live recording waveform.
 *
 * Reads the amplitude ring buffer the voice recorder fills from its
 * AnalyserNode and paints it on a canvas each animation frame. No React state
 * is involved and the component is memoised on its (stable) props, so the
 * chat input's once-per-200ms timer tick never re-renders it and the canvas
 * never remounts mid-recording.
 */
function LiveWaveform({ levelsRef, active, color = '#ef4444', className }) {
  const canvasRef = useRef(null);
  const rafRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !active) return undefined;

    const ctx = canvas.getContext('2d');
    if (!ctx) return undefined;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let cssWidth = 0;
    let cssHeight = 0;

    // Assigning canvas.width/height clears the bitmap and resets the transform,
    // so it must happen ONLY when the size genuinely changed. Doing it on every
    // observer callback (they fire for identical sizes too) blanked the canvas
    // mid-frame, which read as a flicker.
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      if (rect.width === cssWidth && rect.height === cssHeight) return;
      cssWidth = rect.width;
      cssHeight = rect.height;
      canvas.width = Math.round(rect.width * dpr);
      canvas.height = Math.round(rect.height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();

    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(resize) : null;
    observer?.observe(canvas);

    const draw = () => {
      rafRef.current = requestAnimationFrame(draw);
      if (!cssWidth || !cssHeight) {
        resize();
        return;
      }

      const levels = levelsRef?.current;
      const count = WAVEFORM_SAMPLES;

      const slot = cssWidth / count;
      // Proportional to the slot, with no upper cap: a fixed cap left thin bars
      // stranded in wide slots, which read as a dotted line rather than a
      // waveform once the strip got any width.
      const barWidth = Math.max(2, slot * 0.52);
      // Silence still draws a short bar, never a dot — a dot row was what
      // looked like a second line under the wave.
      const minHeight = Math.min(2, cssHeight);

      ctx.clearRect(0, 0, cssWidth, cssHeight);
      ctx.fillStyle = color;

      for (let i = 0; i < count; i++) {
        // Painted straight from the buffer. The envelope is already smoothed at
        // the source, so there is nothing left to ease here — and easing a slot
        // whose meaning shifts every sample is exactly what caused the shake.
        const level = levels && levels.length === count ? levels[i] : 0;

        const height = Math.max(minHeight, Math.min(cssHeight, level * cssHeight));
        // Snap to whole device pixels: a bar landing on a half pixel is
        // antialiased differently frame to frame, which shimmers.
        const x = Math.round((i * slot + (slot - barWidth) / 2) * dpr) / dpr;
        const y = Math.round(((cssHeight - height) / 2) * dpr) / dpr;
        const radius = Math.min(barWidth / 2, height / 2, 2);

        ctx.beginPath();
        if (ctx.roundRect) {
          ctx.roundRect(x, y, barWidth, height, radius);
        } else {
          ctx.rect(x, y, barWidth, height);
        }
        ctx.fill();
      }
    };

    rafRef.current = requestAnimationFrame(draw);

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      observer?.disconnect();
    };
  }, [active, color, levelsRef]);

  if (!active) return null;

  return <canvas ref={canvasRef} className={className} aria-hidden="true" />;
}

export default memo(LiveWaveform);
