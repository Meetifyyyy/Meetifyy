import { createContext, useContext, useState, useCallback, useRef } from 'react';
import { getMediaUrl } from '@shared/api/apiClient';

const MediaViewerContext = createContext(null);

export function useMediaViewer() {
  const ctx = useContext(MediaViewerContext);
  if (!ctx) throw new Error('useMediaViewer must be used inside MediaViewerProvider');
  return ctx;
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

  return (
    <MediaViewerContext.Provider value={{ state, openViewer, closeViewer, navigate, savedScrollRef }}>
      {children}
    </MediaViewerContext.Provider>
  );
}
