import { useEffect, useId, useRef } from 'react';
import { overlayManager } from '@shared/services/OverlayManager';

/**
 * Hook to automatically register a modal/drawer/overlay with the central OverlayManager.
 * Ensures hitting browser/hardware Back button closes the overlay instead of changing page route.
 *
 * @param {boolean} isOpen - Whether the overlay is currently visible
 * @param {Function} onClose - Callback function to close the overlay
 * @param {Object} [options] - Additional options (e.g. pushHistoryState)
 */
export function useOverlayBack(isOpen, onClose, options = {}) {
  const overlayId = useId();
  const onCloseRef = useRef(onClose);
  const pushHistoryState = options.pushHistoryState ?? false;

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!isOpen) return;

    const handleClose = () => {
      if (typeof onCloseRef.current === 'function') {
        onCloseRef.current();
      }
    };

    const cleanup = overlayManager.open(overlayId, handleClose, { pushHistoryState });

    return () => {
      cleanup();
    };
  }, [isOpen, overlayId, pushHistoryState]);
}

