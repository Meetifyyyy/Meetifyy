import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from './shared/context/AuthContext';
import { FollowProvider } from './shared/context/FollowContext';
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
      gcTime:    1000 * 60 * 10,       // cached for 10 min
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

// Clear out old Service Workers in development mode to prevent old cache/mock data issues
if (import.meta.env.DEV && 'serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then((registrations) => {
    for (let registration of registrations) {
      registration.unregister();
    }
  });
}

createRoot(document.getElementById('root')).render(
  <QueryClientProvider client={queryClient}>
    <StrictMode>
      <ThemeProvider>
        <AuthProvider>
            <FollowProvider>
              <MediaViewerProvider>
                <Toaster position="top-center" richColors />
                <App />
                <MediaViewer />
              </MediaViewerProvider>
            </FollowProvider>
        </AuthProvider>
      </ThemeProvider>
    </StrictMode>
  </QueryClientProvider>,
);



