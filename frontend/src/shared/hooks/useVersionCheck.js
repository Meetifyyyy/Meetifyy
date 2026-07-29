import { useEffect, useRef } from 'react';

/**
 * Polls /version.json every 30s and on window focus.
 * On version mismatch: wipes all caches, service workers, and forces a hard
 * navigation to the current URL with a cache-bust param — no soft reload.
 */
export function useVersionCheck() {
  const currentVersionRef = useRef(null);

  useEffect(() => {
    let active = true;

    const forceHardRefresh = async () => {
      // 1. Unregister all service workers
      if ('serviceWorker' in navigator) {
        const registrations = await navigator.serviceWorker.getRegistrations();
        await Promise.all(registrations.map(r => r.unregister()));
      }

      // 2. Nuke all Cache API caches
      if ('caches' in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map(k => caches.delete(k)));
      }

      // 3. Navigate (not reload) with cache-bust so browser fetches fresh HTML
      const url = new URL(window.location.href);
      url.searchParams.set('_v', Date.now().toString());
      window.location.replace(url.toString());
    };

    const checkVersion = async () => {
      try {
        const res = await fetch(`/version.json?t=${Date.now()}`, {
          cache: 'no-store',
          headers: { 'Cache-Control': 'no-cache, no-store, must-revalidate' }
        });
        if (!res.ok) return;
        const data = await res.json();
        const newVersion = data.version;

        if (currentVersionRef.current === null) {
          currentVersionRef.current = newVersion;
        } else if (active && currentVersionRef.current !== newVersion) {
          await forceHardRefresh();
        }
      } catch {
        // Silently ignore network interruptions
      }
    };

    checkVersion();
    const interval = setInterval(checkVersion, 30000);
    const handleFocus = () => checkVersion();
    window.addEventListener('focus', handleFocus);

    return () => {
      active = false;
      clearInterval(interval);
      window.removeEventListener('focus', handleFocus);
    };
  }, []);
}
