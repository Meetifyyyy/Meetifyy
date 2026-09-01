import { StrictMode } from 'react';
import { clearStaleChunkMarker } from '@shared/lib/staleChunkRecovery';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from './shared/context/AuthContext';
import { CookieConsentProvider } from './shared/context/CookieConsentContext';
import { Toaster } from 'sonner';
import { ThemeProvider } from './shared/context/ThemeContext';
import App from './App.jsx';
import { MediaViewerProvider } from './shared/context/MediaViewerContext';
import { UsersMapProvider } from './shared/hooks/useUsersMap';
import MediaViewer from './shared/components/MediaViewer/MediaViewer';
import { config } from '@config';
import { isNonProductionHost } from './config/deploymentEnv';
import './styles/variables.css';
import './styles/global.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,              // 30s default; real-time data overrides via sockets or per-query values
      gcTime:    1000 * 60 * 15,       // cached for 15 min
      refetchOnWindowFocus: true,     // Refetch when switching back to tab
      refetchOnReconnect: true,
      retry: 1,
      // NOTE: `placeholderData: (prev) => prev` is deliberately NOT a global
      // default. As a default it applies when the *query key changes*, which
      // means every keyed query renders the previous key's data as though it
      // belonged to the new key — /profile/alice → /profile/bob showed alice's
      // avatar, bio and follower counts under bob's name until his fetch
      // landed. That is not staleness, it is the wrong record.
      //
      // It is the right behaviour for a query whose key varies over the *same*
      // dataset — a search term, a filter, a page — so those opt in
      // individually (useCrewDirectory, useGlobalSearch, useActivities).
    },
  },
});

// Enable CSS :active pseudo-class on mobile Safari / iOS touch devices
if (typeof document !== 'undefined') {
  document.addEventListener('touchstart', () => {}, { passive: true });
}

// Disable browser context menu on images and videos globally
if (typeof window !== 'undefined') {
  window.addEventListener('contextmenu', (e) => {
    const target = e.target;
    if (target && (
      target.tagName === 'IMG' ||
      target.tagName === 'VIDEO' ||
      target.closest('img') ||
      target.closest('video')
    )) {
      e.preventDefault();
    }
  }, true);
}

// Service Worker registration
//
// Two independent gates decide whether a real worker may run: the build-time
// flag (an explicit VITE_APP_ENV=production) and the hostname. Either one
// refusing is enough. A caching worker on a Cloudflare Access-protected host
// serves its cached shell without a network request for Access to authorize, so
// this failing open is an access-control hole rather than a caching nuisance.
if ('serviceWorker' in navigator) {
  const workerAllowed =
    config.features.enableServiceWorker &&
    !isNonProductionHost(window.location.hostname);

  if (!workerAllowed) {
    // Tear down any existing installation AND drop its caches. Unregistering
    // alone leaves the cached app shell on disk, and on the dev deployment that
    // shell is what let installed PWAs keep loading the site without ever making
    // a network request for Cloudflare Access to check.
    //
    // This runs immediately, unlike the tombstone worker the non-production
    // build ships, which only unregisters once every client has closed — and an
    // installed PWA that is never fully closed would otherwise stay stale
    // indefinitely.
    navigator.serviceWorker.getRegistrations().then(async (regs) => {
      await Promise.all(regs.map((r) => r.unregister()));
      if ('caches' in window) {
        const names = await caches.keys();
        await Promise.all(names.map((n) => caches.delete(n)));
      }
    }).catch(() => {});
  } else {
    window.addEventListener('load', () => {
      navigator.serviceWorker
        .register('/sw.js', { scope: '/', updateViaCache: 'none' })
        .then(manageWorkerUpdates)
        .catch((err) => console.warn('[SW] Registration failed:', err));
    });
  }
}

/**
 * Adopt a new deployment without interrupting anyone.
 *
 * `sw.js` deliberately does not call `skipWaiting()`: activating a new worker
 * under a running page lets Workbox delete the precache that page is still
 * loading lazy chunks from. So a new worker waits — but with an installed PWA
 * that is never fully closed, "waits" can mean days, and the user sits on an old
 * build with no way forward short of a hard refresh. That is the problem this
 * solves.
 *
 * The waiting worker is therefore promoted only while the page is HIDDEN, and
 * only after it has stayed hidden long enough that the user has plainly moved
 * on. The reload that follows happens on a page nobody is looking at, so the
 * next time they open the app it is simply the new version — no flicker, no
 * forced refresh, and no reload landing mid-interaction.
 *
 * The tradeoff, stated honestly: reloading a hidden tab discards unsaved
 * in-page state such as a half-typed message. The grace period is what keeps
 * that from happening to someone who merely switched tabs for a moment.
 */
const HIDDEN_GRACE_MS = 60_000;
const UPDATE_POLL_MS = 30 * 60 * 1000;

function manageWorkerUpdates(registration) {
  if (!registration) return;

  let waitingWorker = registration.waiting || null;
  let hiddenSince = null;
  let promoted = false;

  const promote = () => {
    if (promoted || !waitingWorker) return;
    if (document.visibilityState !== 'hidden') return;
    if (hiddenSince === null || Date.now() - hiddenSince < HIDDEN_GRACE_MS) return;
    promoted = true;
    waitingWorker.postMessage({ type: 'SKIP_WAITING' });
  };

  registration.addEventListener('updatefound', () => {
    const installing = registration.installing;
    if (!installing) return;
    installing.addEventListener('statechange', () => {
      // `controller` is null on the very first install; there is no previous
      // worker to replace then, so there is nothing to promote.
      if (installing.state === 'installed' && navigator.serviceWorker.controller) {
        waitingWorker = installing;
        promote();
      }
    });
  });

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    // Only ever reached via the promotion above, which requires a hidden page.
    if (document.visibilityState === 'hidden') window.location.reload();
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      hiddenSince = Date.now();
      setTimeout(promote, HIDDEN_GRACE_MS);
    } else {
      hiddenSince = null;
      // Returning to the app is the natural moment to look for a new build.
      registration.update().catch(() => {});
    }
  });

  setInterval(() => registration.update().catch(() => {}), UPDATE_POLL_MS);
}

createRoot(document.getElementById('root')).render(
  <QueryClientProvider client={queryClient}>
    <StrictMode>
      <ThemeProvider>
        <CookieConsentProvider>
          <AuthProvider>
            <MediaViewerProvider>
              <UsersMapProvider>
                <Toaster 
                  position="top-center" 
                  duration={4500} 
                  gap={10}
                  visibleToasts={4}
                  toastOptions={{
                    style: {
                      background: 'transparent',
                      border: 'none',
                      boxShadow: 'none',
                      padding: 0,
                      width: '380px',
                      maxWidth: 'calc(100vw - 24px)',
                    }
                  }}
                />
                <App />
                <MediaViewer />
              </UsersMapProvider>
            </MediaViewerProvider>
          </AuthProvider>
        </CookieConsentProvider>
      </ThemeProvider>
    </StrictMode>
  </QueryClientProvider>,
);




// The app reached this point, so whatever stale chunk triggered a recovery
// reload is resolved. Clearing the marker means a LATER deploy can recover in
// the same tab instead of being suppressed by the cooldown from this one.
clearStaleChunkMarker();
