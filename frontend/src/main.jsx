import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AuthProvider } from './shared/context/AuthContext';
import { FollowProvider } from './shared/context/FollowContext';
import { DataProvider } from './shared/context/DataContext';
import { NotificationProvider } from './shared/context/NotificationContext';
import NotificationBridge from './shared/context/NotificationBridge';
import { ThemeProvider } from './shared/context/ThemeContext';
import App from './App.jsx';
import { MediaViewerProvider } from './shared/context/MediaViewerContext';
import MediaViewer from './shared/components/MediaViewer/MediaViewer';
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



