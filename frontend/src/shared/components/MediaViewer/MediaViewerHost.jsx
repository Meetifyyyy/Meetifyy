import { Component, lazy, Suspense, useEffect, useRef, useState } from 'react';
import { useMediaViewerActions, useMediaViewerState } from '@shared/context/MediaViewerContext';
import { recoverFromStaleChunk } from '@shared/lib/staleChunkRecovery';

/**
 * Mounts the media viewer only once something has actually opened it.
 *
 * The viewer is a full image/video lightbox — pan and pinch handling, the video
 * player, the forward and report sheets — and it was mounted at the app root on
 * every page load, so ImageViewer, VideoViewer and MediaViewer itself all sat
 * in the entry chunk (~83 kB raw) waiting for a tap most sessions never make.
 *
 * The gate is deliberately sticky: once opened it stays mounted for the rest of
 * the session. Unmounting on close would throw away the close animation and
 * make a second tap pay the load again, and by then the chunk is cached anyway.
 *
 * Loading it lazily means the FIRST open can fail - offline before the chunk is
 * cached, an interrupted fetch, or a deploy that retired the chunk's filename
 * under an already-open tab. The host sits beside <App />, outside every route
 * error boundary, so an unhandled rejection here would unmount the whole app.
 * It therefore has its own boundary, shows a loading card while the chunk is
 * in flight, and on failure offers Retry and Close instead of nothing.
 *
 * Styled inline on purpose: importing the viewer's CSS module here would pull
 * the whole stylesheet into the entry chunk, which is what the lazy split
 * exists to avoid.
 */
/*
 * Why the first open used to flicker: the Suspense fallback was a scrim at 82%
 * black, and the viewer that replaced it starts its open animation from a
 * transparent overlay (MediaViewer.module.css `.overlay`). So the first tap of
 * every session painted dark, then clear, then faded back to black - measured
 * in the dev build as the scrim for ~95 ms followed by the overlay at alpha 0.
 *
 * Two changes remove it. The chunk is fetched while the app is idle, and once
 * it has arrived the host renders it directly instead of through React.lazy -
 * a lazy component suspends on its first render even when its promise has
 * already settled, which would still commit the fallback for a frame. And the
 * fallback itself now matches the viewer's first frame (transparent), so even
 * on a slow network nothing darkens and then clears again.
 */
let loadedViewer = null;
let viewerImport = null;

function importViewer() {
  if (!viewerImport) {
    viewerImport = import('./MediaViewer').then(
      (mod) => { loadedViewer = mod.default; return mod; },
      (error) => { viewerImport = null; throw error; },
    );
  }
  return viewerImport;
}

/** Fetches the viewer chunk ahead of the first tap. Safe to call repeatedly. */
export function preloadMediaViewer() {
  importViewer().catch(() => {
    // A failed prefetch is not an error yet: the real open retries the import
    // and reports through the boundary below.
  });
}

function createViewer() {
  return lazy(importViewer);
}

function scheduleIdle(fn) {
  if (typeof window === 'undefined') return () => {};
  if (typeof window.requestIdleCallback === 'function') {
    const id = window.requestIdleCallback(fn, { timeout: 4000 });
    return () => window.cancelIdleCallback?.(id);
  }
  const id = window.setTimeout(fn, 1500);
  return () => window.clearTimeout(id);
}

const scrim = {
  position: 'fixed',
  inset: 0,
  zIndex: 10000,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'rgba(0, 0, 0, 0.82)',
  color: '#fff',
  fontFamily: 'var(--font-family-sans, system-ui, sans-serif)',
};

const card = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: '0.85rem',
  width: 'min(20rem, calc(100vw - 3rem))',
  padding: '1.5rem',
  borderRadius: '20px',
  background: 'rgba(24, 24, 27, 0.96)',
  border: '1px solid rgba(255, 255, 255, 0.1)',
  textAlign: 'center',
};

const button = {
  minHeight: '44px',
  padding: '0 1.25rem',
  borderRadius: '12px',
  border: '1px solid rgba(255, 255, 255, 0.25)',
  background: 'rgba(255, 255, 255, 0.1)',
  color: '#fff',
  font: 'inherit',
  cursor: 'pointer',
};

// The viewer's overlay starts transparent and fades to black on its own, so
// the loading state must start from the same place or the hand-over flashes.
const loadingScrim = { ...scrim, background: 'transparent' };

function ViewerLoading() {
  return (
    <div style={loadingScrim} role="status" aria-live="polite" aria-label="Loading media viewer" />
  );
}

function ViewerLoadFailed({ onRetry, onClose }) {
  return (
    <div style={scrim} role="alertdialog" aria-modal="true" aria-label="Media viewer unavailable">
      <div style={card}>
        <span>Couldn&apos;t open the media viewer.</span>
        <div style={{ display: 'flex', gap: '0.75rem' }}>
          <button type="button" style={button} onClick={onRetry}>Try again</button>
          <button type="button" style={button} onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

/** Catches a failed viewer chunk load (or a crash while rendering it). */
class ViewerBoundary extends Component {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error) {
    console.error('[MediaViewerHost]', error);
    // A chunk the server no longer has can only be fixed by a fresh index.html.
    // Reloads at most once a minute per tab, so a real outage cannot loop.
    recoverFromStaleChunk(error);
  }

  render() {
    if (this.state.failed) return this.props.renderFailure();
    return this.props.children;
  }
}

export default function MediaViewerHost() {
  const { open } = useMediaViewerState();
  const { closeViewer } = useMediaViewerActions();
  const everOpened = useRef(false);
  // A rejected React.lazy stays rejected for good, so a retry needs a NEW lazy
  // component. The attempt number rebuilds it and remounts the boundary.
  const [{ attempt, Viewer }, setLoad] = useState(() => ({ attempt: 0, Viewer: createViewer() }));

  // Fetch the chunk while the app is idle so the first tap does not wait on it.
  useEffect(() => scheduleIdle(preloadMediaViewer), []);

  // The component type is fixed at the first open and kept: switching from the
  // lazy wrapper to the loaded module later would remount the viewer mid-close.
  const viewerType = useRef(null);

  if (open) everOpened.current = true;
  if (!everOpened.current) return null;
  if (!viewerType.current) viewerType.current = loadedViewer ?? Viewer;
  const ActiveViewer = viewerType.current;

  const retry = () => {
    viewerType.current = null;
    setLoad((prev) => ({ attempt: prev.attempt + 1, Viewer: createViewer() }));
  };
  const close = () => {
    closeViewer();
    retry();
  };

  return (
    <ViewerBoundary
      key={attempt}
      renderFailure={() => (open ? <ViewerLoadFailed onRetry={retry} onClose={close} /> : null)}
    >
      <Suspense fallback={open ? <ViewerLoading /> : null}>
        <ActiveViewer />
      </Suspense>
    </ViewerBoundary>
  );
}
