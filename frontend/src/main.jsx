import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AuthProvider } from './context/AuthContext';
import { FollowProvider } from './context/FollowContext';
import { DataProvider } from './context/DataContext';
import App from './App.jsx';
import './styles/variables.css';
import './styles/global.css';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <AuthProvider>
      <DataProvider>
        <FollowProvider>
          <App />
        </FollowProvider>
      </DataProvider>
    </AuthProvider>
  </StrictMode>,
);
