import { lazy, Suspense, useRef } from 'react';
import { useMediaViewerState } from '@shared/context/MediaViewerContext';

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
 */
const MediaViewer = lazy(() => import('./MediaViewer'));

export default function MediaViewerHost() {
  const { open } = useMediaViewerState();
  const everOpened = useRef(false);
  if (open) everOpened.current = true;
  if (!everOpened.current) return null;

  return (
    <Suspense fallback={null}>
      <MediaViewer />
    </Suspense>
  );
}
