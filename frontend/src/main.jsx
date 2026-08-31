import { StrictMode } from 'react';
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
if ('serviceWorker' in navigator) {
  if (!config.features.enableServiceWorker) {
    // Wherever the worker is disabled (every non-production build), tear down
    // any existing installation AND drop its caches. Unregistering alone leaves
    // the cached app shell on disk, and on the dev deployment that shell is
    // what let installed PWAs keep loading the site without ever making a
    // network request for Cloudflare Access to check.
    navigator.serviceWorker.getRegistrations().then(async (regs) => {
      await Promise.all(regs.map((r) => r.unregister()));
      if ('caches' in window) {
        const names = await caches.keys();
        await Promise.all(names.map((n) => caches.delete(n)));
      }
    }).catch(() => {});
  } else {
    // Deliberately NO `controllerchange` -> location.reload() here.
    //
    // That listener is what made a deployment yank the page out from under
    // whoever was using it: the new worker took over and the tab reloaded
    // mid-session, losing scroll position, form input and open dialogs. A new
    // worker is now allowed to take over silently, because taking over no
    // longer changes what the running page is showing.
    //
    // Freshness is handled where it belongs instead: index.html is served
    // `no-store` and the worker fetches navigations network-first, so the next
    // load or reload picks up the newest build on its own.

    // Register with updateViaCache: 'none' so the SW script itself is never
    // answered from the HTTP cache.
    window.addEventListener('load', () => {
      navigator.serviceWorker
        .register('/sw.js', { scope: '/', updateViaCache: 'none' })
        .then((reg) => {
          /**
           * Promote a waiting worker AT BOOT ONLY.
           *
           * This is the safe moment: the page has just loaded, so there is no
           * user state to lose, and activation is invisible. Without it a
           * waiting worker would sit there until every tab of the origin
           * closed — which on an installed mobile PWA can be never, stranding
           * the client on an old worker indefinitely.
           */
          if (reg.waiting) reg.waiting.postMessage({ type: 'SKIP_WAITING' });

          // A worker that finishes installing LATER in this session is left
          // waiting on purpose. It will be promoted at the next boot rather
          // than mid-session.
          reg.addEventListener('updatefound', () => {
            const installing = reg.installing;
            if (!installing) return;
            installing.addEventListener('statechange', () => {
              if (installing.state === 'installed' && navigator.serviceWorker.controller) {
                window.dispatchEvent(new CustomEvent('sw:updated'));
              }
            });
          });

          // Check for updates immediately, then hourly.
          reg.update();
          setInterval(() => reg.update(), 60 * 60 * 1000);
        })
        .catch(() => {});
    });
  }
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



