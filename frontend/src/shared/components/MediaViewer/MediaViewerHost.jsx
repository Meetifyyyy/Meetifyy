import { Component, lazy, Suspense, useRef, useState } from 'react';
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
function createViewer() {
  return lazy(() => import('./MediaViewer'));
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

function ViewerLoading() {
  return (
    <div style={scrim} role="status" aria-live="polite" aria-label="Loading media viewer" />
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

  if (open) everOpened.current = true;
  if (!everOpened.current) return null;

  const retry = () => setLoad((prev) => ({ attempt: prev.attempt + 1, Viewer: createViewer() }));
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
        <Viewer />
      </Suspense>
    </ViewerBoundary>
  );
}
