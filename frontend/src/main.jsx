import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AuthProvider } from './context/AuthContext';
import { FollowProvider } from './context/FollowContext';
import { DataProvider } from './context/DataContext';
import { NotificationProvider } from './context/NotificationContext';
import { ThemeProvider } from './context/ThemeContext';
import NotificationBridge from './context/NotificationBridge';
import App from './App.jsx';
import './styles/variables.css';
import './styles/global.css';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    {/* ThemeProvider is outermost so data-theme is set on <html> before any paint */}
    <ThemeProvider>
      <AuthProvider>
        <DataProvider>
          <NotificationProvider>
            <NotificationBridge>
              <FollowProvider>
                <App />
              </FollowProvider>
            </NotificationBridge>
          </NotificationProvider>
        </DataProvider>
      </AuthProvider>
    </ThemeProvider>
  </StrictMode>,
);

