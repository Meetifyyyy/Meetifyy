import { useLayoutEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { notifyPageCommitted } from '@shared/lib/navigation/pageTransition';

/**
 * Tells the page transition (shared/lib/navigation/pageTransition.js) that a
 * navigation has reached the DOM.
 *
 * Mounted once at the router root, so it renders in the same commit as the
 * page the location now names. A layout effect runs after that page's DOM is
 * in and before it is painted, which is the earliest moment the driver can
 * start waiting for the paint it will move.
 */
export default function PageTransitionSignal() {
  const location = useLocation();

  useLayoutEffect(() => {
    notifyPageCommitted();
  }, [location.key]);

  return null;
}
