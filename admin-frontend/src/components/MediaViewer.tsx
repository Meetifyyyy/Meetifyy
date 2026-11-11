import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from './icons';
import './MediaViewer.css';

interface MediaViewerProps {
  title: string;
  alt: string;
  src: string | null;
  revision?: number;
  fallback?: React.ReactNode;
  onClose: () => void;
  onImageError?: () => void;
}

/** Presentation only: the caller owns private URL access and refresh/retry policy. */
export function MediaViewer({ title, alt, src, revision = 0, fallback, onClose, onImageError }: MediaViewerProps) {
  const titleId = React.useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const closeAction = useRef(onClose);
  const [zoom, setZoom] = useState(1);
  const [natural, setNatural] = useState<{ width: number; height: number } | null>(null);
  const [failed, setFailed] = useState(false);
  const [bounds, setBounds] = useState({ width: 0, height: 0 });

  useLayoutEffect(() => { closeAction.current = onClose; }, [onClose]);
  useLayoutEffect(() => { setNatural(null); setFailed(false); setZoom(1); }, [src, revision]);
  useLayoutEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const measure = () => setBounds({
      width: stage.clientWidth || Math.max(1, window.innerWidth - 32),
      height: stage.clientHeight || Math.max(1, window.innerHeight - 120),
    });
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(stage);
    window.addEventListener('resize', measure);
    return () => { observer?.disconnect(); window.removeEventListener('resize', measure); };
  }, []);

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const app = document.getElementById('root');
    const previousInert = app?.inert;
    const previousOverflow = document.body.style.overflow;
    if (app) app.inert = true;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus();
    const focusable = () => Array.from(dialogRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), [tabindex="0"]') || []);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault(); event.stopPropagation(); closeAction.current();
      } else if (event.key === 'Tab') {
        const items = focusable();
        const first = items[0];
        const last = items[items.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    const keepFocus = (event: FocusEvent) => {
      if (!dialogRef.current?.contains(event.target as Node)) closeRef.current?.focus();
    };
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('focusin', keepFocus);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('focusin', keepFocus);
      if (app) app.inert = previousInert ?? false;
      document.body.style.overflow = previousOverflow;
      if (opener?.isConnected) opener.focus();
    };
  }, []);

  const scale = natural ? Math.min(1, bounds.width / natural.width, bounds.height / natural.height) : 1;
  const width = natural ? natural.width * scale * zoom : 0;
  const height = natural ? natural.height * scale * zoom : 0;

  return createPortal(
    <div className="media-viewer-backdrop" onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div ref={dialogRef} className="media-viewer-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <header className="media-viewer-header">
          <h2 id={titleId}>{title}</h2>
          <div className="media-viewer-tools" role="group" aria-label="Image controls">
            <button type="button" className="media-viewer-button" aria-label="Zoom out" disabled={!natural || zoom <= 1} onClick={() => setZoom((current) => Math.max(1, current - 0.5))}>−</button>
            <span className="media-viewer-zoom" aria-live="polite">{Math.round(zoom * 100)}%</span>
            <button type="button" className="media-viewer-button" aria-label="Zoom in" disabled={!natural || zoom >= 4} onClick={() => setZoom((current) => Math.min(4, current + 0.5))}>+</button>
            <button type="button" className="media-viewer-button" disabled={zoom === 1} onClick={() => setZoom(1)}>Fit</button>
            <button ref={closeRef} type="button" className="media-viewer-button" aria-label="Close media viewer" onClick={onClose}><X size={20} /></button>
          </div>
        </header>
        <div ref={stageRef} className="media-viewer-stage" tabIndex={0} aria-label="Image viewing area">
          {!src ? <div className="media-viewer-message">{fallback || 'No image available.'}</div> : failed ? (
            <div className="media-viewer-message" role="alert">The image could not be loaded.</div>
          ) : (
            <>
              {!natural && <div className="media-viewer-loading" role="status">Loading image…</div>}
              <div className="media-viewer-canvas" style={{ width: Math.max(bounds.width, width), height: Math.max(bounds.height, height) }}>
                <img key={`${src}-${revision}`} src={src} alt={alt} draggable={false}
                  style={natural ? { width, height } : { maxWidth: '100%', maxHeight: '100%', opacity: 0 }}
                  onLoad={(event) => { setNatural({ width: event.currentTarget.naturalWidth || 1, height: event.currentTarget.naturalHeight || 1 }); }}
                  onError={() => { setFailed(true); onImageError?.(); }} />
              </div>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
