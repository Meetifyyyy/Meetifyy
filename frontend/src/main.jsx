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
    // Unregister all SWs wherever the worker is disabled (development default)
    navigator.serviceWorker.getRegistrations().then((regs) => {
      for (const r of regs) r.unregister();
    });
  } else {
    // Reload when a new SW takes control (breaks out of stale cache)
    let refreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!refreshing) {
        refreshing = true;
        window.location.reload();
      }
    });

    // Register with updateViaCache: 'none' to bypass HTTP cache for SW script
    window.addEventListener('load', () => {
      navigator.serviceWorker
        .register('/sw.js', { scope: '/', updateViaCache: 'none' })
        .then((reg) => {
          // Check for updates immediately, then every 60 minutes
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



