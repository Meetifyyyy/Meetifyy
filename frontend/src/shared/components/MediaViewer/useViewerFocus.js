import { useLayoutEffect } from 'react';

const focusable = 'button:not(:disabled), a[href], input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])';

/** Contain focus across the viewer and its portalled menus/nested dialogs. */
export function useViewerFocus(open, overlayRef) {
  useLayoutEffect(() => {
    const viewer = overlayRef.current;
    if (!open || !viewer) return undefined;
    const opener = document.activeElement;
    const originalInert = new Map();
    const dialogOpeners = new Map();
    let previousRoot = viewer;
    const dialogSelector = '[role="dialog"][aria-modal="true"]';
    const menuSelector = '[role="menu"]';
    const FOLLOWING = Node.DOCUMENT_POSITION_FOLLOWING;
    // Portals append to <body>, so document order is stacking order: a dialog
    // that follows the viewer was opened from it, and one that precedes it is a
    // layer the viewer was opened over. Treating every other dialog as "ours"
    // pulled focus into whatever sat underneath the viewer.
    const isAfterViewer = el => Boolean(viewer.compareDocumentPosition(el) & FOLLOWING);
    const nestedDialogs = () => [...document.querySelectorAll(dialogSelector)]
      .filter(el => el !== viewer && isAfterViewer(el) && !el.closest('[inert]'));
    const activeRoot = () => nestedDialogs().at(-1) || viewer;
    const roots = () => [activeRoot(), ...document.querySelectorAll(menuSelector)];
    const isAllowed = target => roots().some(root => root.contains(target));
    const tabbables = () => roots().flatMap(root => [...root.querySelectorAll(focusable)])
      .filter(el => !el.closest('[inert], [aria-hidden="true"]') && getComputedStyle(el).visibility !== 'hidden');
    const focusFirst = () => (tabbables()[0] || activeRoot()).focus();
    // Only layers opened after the viewer stay interactive. Everything else in
    // <body> - the app root and any dialog beneath the viewer - is made inert,
    // whether or not it happens to contain a dialog of its own.
    const isOwnLayer = child => child.contains(viewer)
      // Toasts are status messages, not content behind the viewer; inert would hide them from assistive tech.
      || child.classList.contains('custom-toast')
      || child.matches(menuSelector)
      || (isAfterViewer(child) && (child.matches(dialogSelector) || Boolean(child.querySelector(dialogSelector))));
    const syncBackground = () => {
      for (const child of document.body.children) {
        if (isOwnLayer(child) || ['SCRIPT', 'STYLE', 'LINK'].includes(child.tagName)) continue;
        if (!originalInert.has(child)) originalInert.set(child, child.getAttribute('inert'));
        child.setAttribute('inert', '');
      }
    };
    syncBackground();
    viewer.focus();
    const observer = new MutationObserver(() => {
      syncBackground();
      const root = activeRoot();
      if (root !== previousRoot) {
        if (previousRoot.isConnected && root !== viewer) dialogOpeners.set(root, document.activeElement);
        const trigger = dialogOpeners.get(previousRoot);
        previousRoot = root;
        if (trigger?.isConnected && isAllowed(trigger) && !trigger.closest('[inert]')) trigger.focus({ preventScroll: true });
        else if (!isAllowed(document.activeElement)) focusFirst();
      }
    });
    observer.observe(document.body, { childList: true });
    const onFocus = e => {
      if (viewer.hasAttribute('inert')) return;
      if (!isAllowed(e.target)) focusFirst();
    };
    const onKeyDown = e => {
      if (e.key !== 'Tab' || viewer.hasAttribute('inert')) return;
      const elements = tabbables();
      const current = elements.indexOf(document.activeElement);
      if (!elements.length) { e.preventDefault(); activeRoot().focus(); return; }
      if (current === -1 || (e.shiftKey && current === 0) || (!e.shiftKey && current === elements.length - 1)) {
        e.preventDefault();
        elements[e.shiftKey ? elements.length - 1 : 0].focus();
      }
    };
    document.addEventListener('focusin', onFocus);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      observer.disconnect();
      document.removeEventListener('focusin', onFocus);
      document.removeEventListener('keydown', onKeyDown);
      originalInert.forEach((value, child) => {
        if (value === null) child.removeAttribute('inert');
        else child.setAttribute('inert', value);
      });
      // Handing focus back must not move the page. A plain focus() scrolls the
      // element into view, and the opener is a media tile that is often taller
      // than the screen or partly above it - so closing the viewer used to jump
      // the page, and a delayed scroll restore then jumped it back: the flicker.
      if (opener?.isConnected && !opener.closest('[inert]')) opener.focus({ preventScroll: true });
    };
  }, [open, overlayRef]);
}
