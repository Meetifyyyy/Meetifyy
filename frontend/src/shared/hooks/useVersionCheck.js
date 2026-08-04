import { useEffect, useRef } from 'react';

/**
 * Polls /version.json every 15s and on window focus/visibility.
 * On version mismatch: wipes all service workers, clears all CacheStorage,
 * and forces a hard refresh to force all older PWA clients to load the new build.
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
        try {
          localStorage.setItem('meetifyy_installed_version', String(newVersion));
          sessionStorage.setItem('app_installed_version', String(newVersion));
        } catch (_) {}
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

        const clientBuildTime = typeof __APP_BUILD_TIME__ !== 'undefined' ? Number(__APP_BUILD_TIME__) : 0;
        const storedVersionStr = localStorage.getItem('meetifyy_installed_version');
        const storedVersion = storedVersionStr ? Number(storedVersionStr) : 0;

        // If server version is newer than running JS bundle or stored version
        const isClientStale = (clientBuildTime > 0 && serverVersion > clientBuildTime) ||
                              (storedVersion > 0 && serverVersion > storedVersion);

        if (isClientStale) {
          await forceHardRefresh(serverVersion);
          return;
        }

        if (currentVersionRef.current === null) {
          currentVersionRef.current = serverVersion;
          localStorage.setItem('meetifyy_installed_version', String(serverVersion));
        } else if (active && serverVersion > currentVersionRef.current) {
          currentVersionRef.current = serverVersion;
          await forceHardRefresh(serverVersion);
        }
      } catch {
        // Silently ignore network interruptions
      }
    };

    checkVersion();
    const interval = setInterval(checkVersion, 15000);
    const handleFocus = () => checkVersion();
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') checkVersion();
    };
    const handlePageshow = (e) => {
      if (e.persisted) checkVersion();
    };
    const handleOnline = () => checkVersion();

    window.addEventListener('focus', handleFocus);
    window.addEventListener('pageshow', handlePageshow);
    window.addEventListener('online', handleOnline);
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      active = false;
      clearInterval(interval);
      window.removeEventListener('focus', handleFocus);
      window.removeEventListener('pageshow', handlePageshow);
      window.removeEventListener('online', handleOnline);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, []);
}
