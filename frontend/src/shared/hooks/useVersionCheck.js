import { useEffect, useRef } from 'react';

/**
 * Polls /version.json every 30s and on window focus.
 * On version mismatch: wipes all caches, service workers, and forces a hard
 * navigation to the current URL with a cache-bust param — no soft reload.
 */
export function useVersionCheck() {
  const currentVersionRef = useRef(null);

  useEffect(() => {
    if (import.meta.env.DEV) return;

    let active = true;

    const forceHardRefresh = async (newVersion) => {
      try {
        if ('serviceWorker' in navigator) {
          const registrations = await navigator.serviceWorker.getRegistrations();
          await Promise.all(registrations.map(r => r.unregister()));
        }

        if ('caches' in window) {
          const keys = await caches.keys();
          await Promise.all(keys.map(k => caches.delete(k)));
        }
      } catch {
        // Silently ignore cache wipe errors
      }

      if (newVersion) {
        window.sessionStorage.setItem('app_installed_version', String(newVersion));
      }

      const url = new URL(window.location.href);
      url.searchParams.set('_v', Date.now().toString());
      window.location.replace(url.toString());
    };

    const checkVersion = async () => {
      try {
        const res = await fetch(`/version.json?t=${Date.now()}`, {
          cache: 'no-store',
          headers: {
            'Cache-Control': 'no-cache, no-store, must-revalidate',
            'Pragma': 'no-cache'
          }
        });
        if (!res.ok) return;
        const data = await res.json();
        const serverVersion = Number(data.version);
        if (!serverVersion || isNaN(serverVersion)) return;

        const installedVersionStr = window.sessionStorage.getItem('app_installed_version');
        const installedVersion = installedVersionStr ? Number(installedVersionStr) : null;

        if (currentVersionRef.current === null) {
          currentVersionRef.current = serverVersion;
          if (!installedVersion) {
            window.sessionStorage.setItem('app_installed_version', String(serverVersion));
          } else if (serverVersion > installedVersion) {
            await forceHardRefresh(serverVersion);
            return;
          }
        } else if (active && serverVersion > currentVersionRef.current) {
          currentVersionRef.current = serverVersion;
          await forceHardRefresh(serverVersion);
        }
      } catch {
        // Silently ignore network interruptions
      }
    };

    checkVersion();
    const interval = setInterval(checkVersion, 30000);
    const handleFocus = () => checkVersion();
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') checkVersion();
    };

    window.addEventListener('focus', handleFocus);
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      active = false;
      clearInterval(interval);
      window.removeEventListener('focus', handleFocus);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, []);
}
