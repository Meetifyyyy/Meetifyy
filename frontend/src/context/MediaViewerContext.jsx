import { createContext, useContext, useState, useCallback, useRef } from 'react';

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

  const openViewer = useCallback((items, startIndex = 0, meta = null, originRect = null) => {
    savedScrollRef.current = window.scrollY;
    setState({ open: true, items, index: startIndex, meta, originRect });
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
