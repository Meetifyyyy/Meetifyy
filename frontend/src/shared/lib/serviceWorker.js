/**
 * Service Worker registration + lifecycle management.
 * Called once from main.jsx after React mounts.
 */

export async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;

  // In development, unregister any existing SW to prevent stale cache issues
  if (import.meta.env.DEV) {
    const regs = await navigator.serviceWorker.getRegistrations();
    await Promise.all(regs.map((r) => r.unregister()));
    return;
  }

  try {
    const registration = await navigator.serviceWorker.register('/sw.js', {
      scope: '/',
      updateViaCache: 'none',
    });

    // Check for updates in the background every 60 minutes
    setInterval(() => registration.update(), 60 * 60 * 1000);

    // When a new SW becomes active, prompt the user to reload
    registration.addEventListener('updatefound', () => {
      const newWorker = registration.installing;
      if (!newWorker) return;
      newWorker.addEventListener('statechange', () => {
        if (newWorker.state === 'activated' && navigator.serviceWorker.controller) {
          // Dispatch a custom event — the app can show a "New version available" toast
          window.dispatchEvent(new CustomEvent('sw:updated'));
        }
      });
    });

    return registration;
  } catch (err) {
    // SW registration failure is non-fatal — app works without it
    console.warn('[SW] Registration failed:', err);
  }
}

/**
 * Request a background sync for the given tag.
 * Used for offline-resilient actions (likes, bookmarks, etc.)
 */
export async function requestBackgroundSync(tag = 'meetifyy-outbox') {
  try {
    const reg = await navigator.serviceWorker.ready;
    if ('sync' in reg) {
      await reg.sync.register(tag);
    }
  } catch {
    // Background Sync API not available — the action already fired online
  }
}
