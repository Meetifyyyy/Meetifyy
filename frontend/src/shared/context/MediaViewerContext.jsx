import { createContext, useContext, useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { getMediaUrl } from '@shared/api/apiClient';
import { overlayManager } from '@shared/services/OverlayManager';
import { clearReportedTargets } from '@shared/utils/reportedTargets';
import { useAuth } from './AuthContext';

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
 * Turns one caller-supplied entry into a viewer item, or null when it cannot be
 * shown. Every field the caller passed survives (ids, report data, ...); the
 * viewer only adds to it:
 *   url      - resolved, absolute (see openViewer)
 *   rawUrl   - the url exactly as the caller gave it, before resolution
 *   slideKey - unique per entry, so two entries with the same url (a forwarded
 *              attachment shown twice) do not collide as React keys
 */
function normalizeItem(item, position) {
  if (!item) return null;
  const input = typeof item === 'string' ? { url: item, type: 'image' } : item;
  if (typeof input !== 'object' || typeof input.url !== 'string' || input.url === '') return null;
  const url = getMediaUrl(input.url);
  return {
    ...input,
    url,
    rawUrl: input.rawUrl ?? input.url,
    ...(input.thumb ? { thumb: getMediaUrl(input.thumb) } : {}),
    slideKey: `${position}:${url}`,
  };
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
    // Bumped by every openViewer. The viewer keys its per-open state on it, so a
    // sheet, a report flow or a download left over from one open cannot carry
    // into the next.
    sessionId: 0,
  });

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
    const source = Array.isArray(items) ? items : [];
    const wanted = Number.isFinite(startIndex) ? Math.trunc(startIndex) : 0;

    // Entries that cannot be shown are dropped, and the index is carried across
    // the drop: it is the NUMBER OF SHOWABLE ENTRIES BEFORE the one the caller
    // asked for, so the viewer opens on that same entry rather than on whatever
    // now sits at the old position. Out of range clamps to the nearest end.
    const resolved = [];
    let before = 0;
    source.forEach((entry, i) => {
      const item = normalizeItem(entry, resolved.length);
      if (!item) return;
      if (i < wanted) before += 1;
      resolved.push(item);
    });

    // Nothing to show: opening an empty dialog (counter and menu, no media)
    // is worse than not opening.
    if (resolved.length === 0) return;

    const index = Math.min(Math.max(before, 0), resolved.length - 1);
    setState((prev) => ({ open: true, items: resolved, index, meta, originRect, sessionId: (prev.sessionId ?? 0) + 1 }));
  }, []);

  const closeViewer = useCallback(() => {
    // The viewer never moves the page behind it (the scroll lock freezes it and
    // focus is handed back without scrolling), so there is no position to restore.
    setState((prev) => (prev.open ? { ...prev, open: false } : prev));
  }, []);

  /*
   * The viewer sits above the router and the auth gate, so nothing closes it
   * when the page underneath changes. Two things must:
   *
   *   - a page change the router makes (a deep link, a session-expiry redirect;
   *     `popstate` never fires for these - see OverlayManager.onRouteChange);
   *   - the session ending, which would otherwise leave a signed-in user's media
   *     on screen over the login page.
   *
   * Both just close it. It used to restore a saved scroll offset ~320 ms later,
   * which on a different page scrolled the new route to the old route's offset;
   * the viewer no longer moves the page, so there is nothing to undo.
   */
  const dismissForNavigation = closeViewer;

  useEffect(() => overlayManager.onRouteChange(dismissForNavigation), [dismissForNavigation]);

  const { isLoggedIn } = useAuth();
  const wasLoggedInRef = useRef(isLoggedIn);
  useEffect(() => {
    if (wasLoggedInRef.current && !isLoggedIn) {
      dismissForNavigation();
      // What the signed-out person reported is not what the next one has.
      clearReportedTargets();
    }
    wasLoggedInRef.current = isLoggedIn;
  }, [isLoggedIn, dismissForNavigation]);

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
    () => ({ openViewer, closeViewer, navigate }),
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
