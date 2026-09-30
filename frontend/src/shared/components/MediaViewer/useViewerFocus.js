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
    const nestedDialogs = () => [...document.querySelectorAll(dialogSelector)]
      .filter(el => el !== viewer && !el.closest('[inert]'));
    const activeRoot = () => nestedDialogs().at(-1) || viewer;
    const roots = () => [activeRoot(), ...document.querySelectorAll('[role="menu"]')];
    const isAllowed = target => roots().some(root => root.contains(target));
    const tabbables = () => roots().flatMap(root => [...root.querySelectorAll(focusable)])
      .filter(el => !el.closest('[inert], [aria-hidden="true"]') && getComputedStyle(el).visibility !== 'hidden');
    const focusFirst = () => (tabbables()[0] || activeRoot()).focus();
    const syncBackground = () => {
      for (const child of document.body.children) {
        const isPortal = child === viewer || child.matches(`${dialogSelector}, [role="menu"]`) || child.querySelector(dialogSelector);
        if (isPortal || ['SCRIPT', 'STYLE', 'LINK'].includes(child.tagName)) continue;
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
        if (trigger?.isConnected && isAllowed(trigger) && !trigger.closest('[inert]')) trigger.focus();
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
      if (opener?.isConnected && !opener.closest('[inert]')) opener.focus();
    };
  }, [open, overlayRef]);
}
