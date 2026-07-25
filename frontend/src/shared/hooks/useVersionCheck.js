import { useEffect, useRef } from 'react';

/**
 * Custom hook that polls public/version.json to detect new GitHub deployments
 * and automatically force-refreshes active user sessions.
 */
export function useVersionCheck() {
  const currentVersionRef = useRef(null);

  useEffect(() => {
    let active = true;

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
        } else if (currentVersionRef.current !== newVersion) {
          // New deployment detected! Clear all caches & force hard refresh
          if (active) {
            currentVersionRef.current = newVersion;
            if ('serviceWorker' in navigator) {
              const registrations = await navigator.serviceWorker.getRegistrations();
              for (const reg of registrations) {
                await reg.unregister();
              }
            }
            if ('caches' in window) {
              const keys = await caches.keys();
              await Promise.all(keys.map(k => caches.delete(k)));
            }
            window.location.reload(true);
          }
        }
      } catch (e) {
        // Silently ignore network interruptions during background polling
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
