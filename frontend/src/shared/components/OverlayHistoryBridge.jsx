import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { overlayManager } from '@shared/services/OverlayManager';

/**
 * Hands the OverlayManager singleton the router's navigate function.
 *
 * Overlays need to push a history entry so Back dismisses them, but that entry
 * must be created by React Router — a raw `history.pushState` reuses the
 * router's `idx` stamp and silently desyncs every later `navigate(-n)`. Mount
 * this once inside the router root.
 */
export default function OverlayHistoryBridge() {
  const navigate = useNavigate();

  useEffect(() => {
    overlayManager.setNavigator(navigate);
  }, [navigate]);

  return null;
}
