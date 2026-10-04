import { useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { overlayManager } from '@shared/services/OverlayManager';

/**
 * Hands the OverlayManager singleton the router's navigate function.
 *
 * Overlays need to push a history entry so Back dismisses them, but that entry
 * must be created by React Router — a raw `history.pushState` reuses the
 * router's `idx` stamp and silently desyncs every later `navigate(-n)`. Mount
 * this once inside the router root.
 *
 * It also reports page changes. Overlays mounted above the router (the media
 * viewer) cannot see the location, and `popstate` does not fire for a pushed
 * navigation, so they would survive onto the new route. Only the path and the
 * search count: an overlay opening pushes an entry for the SAME url, which must
 * not read as leaving the page.
 */
export default function OverlayHistoryBridge() {
  const navigate = useNavigate();
  const { pathname, search } = useLocation();
  const url = pathname + search;
  const lastUrlRef = useRef(url);

  useEffect(() => {
    overlayManager.setNavigator(navigate);
  }, [navigate]);

  useEffect(() => {
    if (lastUrlRef.current === url) return;
    lastUrlRef.current = url;
    overlayManager.notifyRouteChange(url);
  }, [url]);

  return null;
}
