import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AuthProvider } from './context/AuthContext';
import { FollowProvider } from './context/FollowContext';
import { DataProvider } from './context/DataContext';
import { NotificationProvider } from './context/NotificationContext';
import NotificationBridge from './context/NotificationBridge';
import { ThemeProvider } from './context/ThemeContext';
import App from './App.jsx';
import { MediaViewerProvider } from './context/MediaViewerContext';
import MediaViewer from './components/common/MediaViewer/MediaViewer';
import './styles/variables.css';
import './styles/global.css';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ThemeProvider>
      <AuthProvider>
        <DataProvider>
          <NotificationProvider>
            <NotificationBridge>
              <FollowProvider>
                <MediaViewerProvider>
                  <App />
                  <MediaViewer />
                </MediaViewerProvider>
              </FollowProvider>
            </NotificationBridge>
          </NotificationProvider>
        </DataProvider>
      </AuthProvider>
    </ThemeProvider>
  </StrictMode>,
);

/* Register service worker for PWA in production, unregister in development */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    if (import.meta.env.PROD) {
      navigator.serviceWorker.register('/sw.js');
    } else {
      navigator.serviceWorker.getRegistrations().then((registrations) => {
        for (const registration of registrations) {
          registration.unregister();
        }
      });
    }
  });
}

