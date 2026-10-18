import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  clamp,
  clampView,
  cropSide,
  decodeImage,
  drawCrop,
  formatBytes,
  initialView,
  renderLogo,
  zoomRange,
  type CropView,
  type DecodedImage,
  type LogoResult,
} from '../utils/logoImage';

interface Props {
  file: File;
  onCancel: () => void;
  /** Called with the processed (square, compressed) file. */
  onApply: (file: File, result: LogoResult) => void;
}

const PREVIEW_PX = 64;

/** Draws the crop into a canvas whose backing store is `px` square. */
function paint(canvas: HTMLCanvasElement | null, img: DecodedImage, view: CropView, px: number) {
  if (!canvas) return;
  if (canvas.width !== px) {
    canvas.width = px;
    canvas.height = px;
  }
  const ctx = canvas.getContext('2d');
  if (ctx) drawCrop(ctx, img, view, px);
}

/**
 * Fixed 1:1 crop. Drag to pan, wheel / pinch / slider to zoom, arrow keys and
 * +/- from the keyboard. The result is rendered by the same drawing routine
 * the stage and previews use, so what you see is what is uploaded.
 */
export const LogoCropDialog: React.FC<Props> = ({ file, onCancel, onApply }) => {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const stageCanvas = useRef<HTMLCanvasElement>(null);
  const circleCanvas = useRef<HTMLCanvasElement>(null);
  const squareCanvas = useRef<HTMLCanvasElement>(null);

  const [img, setImg] = useState<DecodedImage | null>(null);
  const [view, setView] = useState<CropView | null>(null);
  const [stagePx, setStagePx] = useState(320);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<LogoResult | null>(null);
  const [busy, setBusy] = useState(false);

  // Latest values for the native listeners, which are attached once.
  const live = useRef<{ img: DecodedImage | null; view: CropView | null }>({ img: null, view: null });
  live.current = { img, view };

  const update = useCallback((fn: (v: CropView, i: DecodedImage) => CropView) => {
    const { img: i, view: v } = live.current;
    if (!i || !v) return;
    const next = clampView(i, fn(v, i));
    live.current = { img: i, view: next };
    setView(next);
  }, []);

  useEffect(() => {
    let cancelled = false;
    let decoded: DecodedImage | null = null;
    decodeImage(file).then(
      (d) => {
        if (cancelled) { d.close(); return; }
        decoded = d;
        setImg(d);
        setView(initialView(d));
      },
      (e: unknown) => { if (!cancelled) setError(e instanceof Error ? e.message : 'Could not read image.'); },
    );
    return () => { cancelled = true; decoded?.close(); };
  }, [file]);

  // Stage size follows layout (390px phone vs desktop).
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setStagePx(Math.round(el.clientWidth) || 320));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Paint stage and previews.
  useEffect(() => {
    if (!img || !view) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    paint(stageCanvas.current, img, view, Math.round(stagePx * dpr));
    paint(circleCanvas.current, img, view, PREVIEW_PX * 2);
    paint(squareCanvas.current, img, view, PREVIEW_PX * 2);
  }, [img, view, stagePx]);

  // Final size/dimensions, debounced while the user is still adjusting.
  useEffect(() => {
    if (!img || !view) return;
    let stale = false;
    const t = window.setTimeout(() => {
      renderLogo(img, view).then(
        (r) => { if (!stale) { setInfo(r); setError(null); } },
        (e: unknown) => { if (!stale) { setInfo(null); setError(e instanceof Error ? e.message : 'Encoding failed.'); } },
      );
    }, 250);
    return () => { stale = true; window.clearTimeout(t); };
  }, [img, view]);

  // Wheel needs a non-passive listener to stop the page scrolling behind.
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      update((v) => ({ ...v, zoom: v.zoom * Math.exp(-e.deltaY * 0.0015) }));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [update]);

  // Pointer pan (one pointer) and pinch (two).
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ dist: number; zoom: number } | null>(null);
  const dist = () => {
    const [a, b] = [...pointers.current.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  };
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2 && live.current.view) {
      pinch.current = { dist: dist(), zoom: live.current.view.zoom };
    }
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const prev = pointers.current.get(e.pointerId);
    if (!prev) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size >= 2 && pinch.current) {
      const base = pinch.current;
      update((v) => ({ ...v, zoom: base.zoom * (dist() / base.dist) }));
      return;
    }
    const dx = e.clientX - prev.x;
    const dy = e.clientY - prev.y;
    update((v, i) => {
      const k = cropSide(i, v.zoom) / stagePx;
      return { ...v, cx: v.cx - dx * k, cy: v.cy - dy * k };
    });
  };
  const onPointerEnd = (e: React.PointerEvent<HTMLDivElement>) => {
    pointers.current.delete(e.pointerId);
    pinch.current = null;
  };

  const onStageKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 0.2 : 0.05;
    const pan = (sx: number, sy: number) => {
      e.preventDefault();
      update((v, i) => {
        const side = cropSide(i, v.zoom);
        return { ...v, cx: v.cx + sx * side * step, cy: v.cy + sy * side * step };
      });
    };
    if (e.key === 'ArrowLeft') pan(-1, 0);
    else if (e.key === 'ArrowRight') pan(1, 0);
    else if (e.key === 'ArrowUp') pan(0, -1);
    else if (e.key === 'ArrowDown') pan(0, 1);
    else if (e.key === '+' || e.key === '=') { e.preventDefault(); update((v) => ({ ...v, zoom: v.zoom * 1.1 })); }
    else if (e.key === '-' || e.key === '_') { e.preventDefault(); update((v) => ({ ...v, zoom: v.zoom / 1.1 })); }
  };

  // Escape cancels; Tab stays inside the dialog; background does not scroll.
  useEffect(() => {
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    stageRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); if (!busyRef.current) onCancelRef.current(); return; }
      if (e.key !== 'Tab' || !dialogRef.current) return;
      const items = dialogRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), [tabindex="0"]');
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.body.style.overflow = prevOverflow;
      opener?.focus();
    };
  }, []);
  const busyRef = useRef(busy);
  busyRef.current = busy;
  const onCancelRef = useRef(onCancel);
  onCancelRef.current = onCancel;

  const apply = async () => {
    if (!img || !view || busy) return;
    setBusy(true);
    try {
      const result = await renderLogo(img, view);
      const ext = result.type === 'image/webp' ? 'webp' : 'png';
      onApply(new File([result.blob], `logo.${ext}`, { type: result.type }), result);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not process the image.');
      setBusy(false);
    }
  };

  const range = img ? zoomRange(img) : { min: 0.1, max: 4 };
  const zoomPct = view ? Math.round(view.zoom * 100) : 100;

  return createPortal(
    <div className="logo-crop-backdrop">
      <div ref={dialogRef} className="logo-crop" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <h2 id={titleId} className="logo-crop-title">Crop logo</h2>
        <p className="logo-crop-hint">Drag to move, scroll or pinch to zoom. The logo is always square.</p>

        <div
          ref={stageRef}
          className="logo-crop-stage"
          tabIndex={0}
          role="application"
          aria-label="Crop area. Arrow keys move the image, plus and minus zoom."
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerEnd}
          onPointerCancel={onPointerEnd}
          onKeyDown={onStageKey}
        >
          <canvas ref={stageCanvas} className="logo-crop-canvas" />
          <span className="logo-crop-grid" aria-hidden="true" />
          {!img && !error && <span className="logo-crop-loading">Loading image…</span>}
        </div>

        <div className="logo-crop-zoom">
          <button type="button" className="btn-secondary logo-crop-step" aria-label="Zoom out" onClick={() => update((v) => ({ ...v, zoom: v.zoom / 1.15 }))}>−</button>
          <input
            type="range"
            aria-label="Zoom"
            min={Math.log(range.min)}
            max={Math.log(range.max)}
            step={0.005}
            value={view ? Math.log(clamp(view.zoom, range.min, range.max)) : 0}
            disabled={!img}
            onChange={(e) => update((v) => ({ ...v, zoom: Math.exp(Number(e.target.value)) }))}
          />
          <button type="button" className="btn-secondary logo-crop-step" aria-label="Zoom in" onClick={() => update((v) => ({ ...v, zoom: v.zoom * 1.15 }))}>+</button>
          <span className="logo-crop-pct" aria-live="off">{zoomPct}%</span>
        </div>

        <div className="logo-crop-bottom">
          <div className="logo-crop-previews" aria-label="Preview">
            <canvas ref={circleCanvas} className="logo-crop-prev logo-crop-prev-round" style={{ width: PREVIEW_PX, height: PREVIEW_PX }} />
            <canvas ref={squareCanvas} className="logo-crop-prev logo-crop-prev-square" style={{ width: PREVIEW_PX, height: PREVIEW_PX }} />
          </div>
          <div className="logo-crop-info" role="status">
            {info
              ? <>{info.width}×{info.height}px · {info.type === 'image/webp' ? 'WebP' : 'PNG'} · {formatBytes(info.blob.size)}</>
              : img ? 'Calculating size…' : ''}
          </div>
        </div>

        {error && <div className="logo-crop-error" role="alert">{error}</div>}

        <div className="logo-crop-actions">
          <button type="button" className="btn-secondary" disabled={!img} onClick={() => img && setView(initialView(img))}>Reset</button>
          <span style={{ flex: 1 }} />
          <button type="button" className="btn-secondary" onClick={onCancel} disabled={busy}>Cancel</button>
          <button type="button" className="btn-primary" onClick={apply} disabled={!img || busy || !!error && !info}>
            {busy ? 'Processing…' : 'Apply'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
};
