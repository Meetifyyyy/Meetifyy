import { createContext, useContext, useState, useCallback, useMemo, useRef } from 'react';
import { getMediaUrl } from '@shared/api/apiClient';

/**
 * Two contexts, deliberately.
 *
 * The viewer's *state* changes every time it opens, closes or pages to the next
 * image. Its *actions* never change. They used to live in one context value —
 * a fresh object literal on every provider render — so every consumer woke up
 * on every state change, including each of the ~16 <Post> cards on screen,
 * which only ever wanted `openViewer`. Opening one image re-rendered the whole
 * visible feed (measured: 16/16 posts, 22ms) and React.memo could not stop it,
 * because a context read is not a prop.
 *
 * Splitting them means a component subscribes to exactly what it uses:
 * `useMediaViewerActions()` never re-renders, `useMediaViewerState()` re-renders
 * only the viewer itself.
 */
const MediaViewerStateContext = createContext(null);
const MediaViewerActionsContext = createContext(null);

/** Actions only — a stable value, so reading this never causes a re-render. */
export function useMediaViewerActions() {
  const ctx = useContext(MediaViewerActionsContext);
  if (!ctx) throw new Error('useMediaViewerActions must be used inside MediaViewerProvider');
  return ctx;
}

/** State only — for the viewer itself. */
export function useMediaViewerState() {
  const ctx = useContext(MediaViewerStateContext);
  if (!ctx) throw new Error('useMediaViewerState must be used inside MediaViewerProvider');
  return ctx;
}

/**
 * Both halves at once. Only the viewer component needs this; anything that just
 * opens the viewer should use `useMediaViewerActions()` so it is not woken by
 * state it does not read.
 */
export function useMediaViewer() {
  const state = useMediaViewerState();
  const actions = useMediaViewerActions();
  return useMemo(() => ({ state, ...actions }), [state, actions]);
}

/**
 * mediaItems: Array of { url, type: 'image'|'video', caption?, thumb? }
 * startIndex: which item to open on
 * meta: { authorName, authorAvatar, authorUsername, timestamp, source, isOwner }
 * originRect: DOMRect of the clicked element for the open animation
 */
export function MediaViewerProvider({ children }) {
  const [state, setState] = useState({
    open: false,
    items: [],
    index: 0,
    meta: null,
    originRect: null,
  });

  const savedScrollRef = useRef(0);

  /**
   * The viewer renders `item.url` straight into an <img>/<video>, and did no
   * resolution of its own — so it worked only for callers that happened to pass
   * an already-absolute URL. Callers handing it what the API stored (a relative
   * `/api/media/<key>` path) opened a viewer that could not load anything.
   *
   * Resolving here fixes every caller at once, and is safe to apply blindly:
   * `getMediaUrl` returns absolute http(s), data: and blob: URLs untouched, so
   * a caller that already resolved is unaffected.
   */
  const openViewer = useCallback((items, startIndex = 0, meta = null, originRect = null) => {
    savedScrollRef.current = window.scrollY;
    const resolved = (Array.isArray(items) ? items : []).map((item) => {
      if (!item) return item;
      if (typeof item === 'string') return { url: getMediaUrl(item), type: 'image' };
      return {
        ...item,
        ...(item.url ? { url: getMediaUrl(item.url) } : {}),
        ...(item.thumb ? { thumb: getMediaUrl(item.thumb) } : {}),
      };
    });
    setState({ open: true, items: resolved, index: startIndex, meta, originRect });
  }, []);

  const closeViewer = useCallback(() => {
    setState((prev) => ({ ...prev, open: false }));
    // Scroll restoration handled in modal after close animation
  }, []);

  const navigate = useCallback((dir) => {
    setState((prev) => {
      const next = prev.index + dir;
      if (next < 0 || next >= prev.items.length) return prev;
      return { ...prev, index: next };
    });
  }, []);

  // All three callbacks are `useCallback`-stable and the ref is an identity, so
  // this object is created once for the life of the provider.
  const actions = useMemo(
    () => ({ openViewer, closeViewer, navigate, savedScrollRef }),
    [openViewer, closeViewer, navigate],
  );

  return (
    <MediaViewerActionsContext.Provider value={actions}>
      <MediaViewerStateContext.Provider value={state}>
        {children}
      </MediaViewerStateContext.Provider>
    </MediaViewerActionsContext.Provider>
  );
}
