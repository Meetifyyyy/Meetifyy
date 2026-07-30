import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from './shared/context/AuthContext';
import { Toaster } from 'sonner';
import { ThemeProvider } from './shared/context/ThemeContext';
import App from './App.jsx';
import { MediaViewerProvider } from './shared/context/MediaViewerContext';
import MediaViewer from './shared/components/MediaViewer/MediaViewer';
import './styles/variables.css';
import './styles/global.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 2,       // fresh for 2 min
      gcTime:    1000 * 60 * 15,       // cached for 15 min
      refetchOnWindowFocus: false,
      refetchOnReconnect: true,
      retry: 1,
      placeholderData: (prev) => prev, // SWR: show stale instantly, fetch in background
    },
  },
});

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

// Service Worker — register in production, unregister stale SWs in development
if ('serviceWorker' in navigator) {
  if (import.meta.env.DEV) {
    navigator.serviceWorker.getRegistrations().then((registrations) => {
      for (const registration of registrations) registration.unregister();
    });
  } else {
    let refreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!refreshing) {
        refreshing = true;
        window.location.reload();
      }
    });

    window.addEventListener('load', () => {
      navigator.serviceWorker
        .register('/sw.js', { scope: '/', updateViaCache: 'none' })
        .then((registration) => {
          registration.update();
          window.addEventListener('focus', () => registration.update());
        })
        .catch((err) => {
          console.warn('SW registration failed:', err);
        });
    });
  }
}

createRoot(document.getElementById('root')).render(
  <QueryClientProvider client={queryClient}>
    <StrictMode>
      <ThemeProvider>
        <AuthProvider>
          <MediaViewerProvider>
            <Toaster position="top-center" richColors />
            <App />
            <MediaViewer />
          </MediaViewerProvider>
        </AuthProvider>
      </ThemeProvider>
    </StrictMode>
  </QueryClientProvider>,
);



