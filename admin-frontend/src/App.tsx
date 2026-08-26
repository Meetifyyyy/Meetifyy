import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import './App.css';
import { AuthProvider, useAuth } from './context/AuthContext';
import { AdminLayout } from './components/AdminLayout';
import { LoginPage } from './pages/LoginPage';
import { DashboardPage } from './pages/DashboardPage';
import { CollegesPage } from './pages/CollegesPage';
import { UsersPage } from './pages/UsersPage';
import { CampusRepsPage } from './pages/CampusRepsPage';
import { ReportsPage } from './pages/ReportsPage';
import { SupportPage } from './pages/SupportPage';
import { MonitoringPage } from './pages/MonitoringPage';
import { FlagsPage } from './pages/FlagsPage';
import { SettingsPage } from './pages/SettingsPage';
import { AuditPage } from './pages/AuditPage';
import { SessionsPage } from './pages/SessionsPage';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
      // Treat data as fresh for 30s so rapid navigation between admin pages
      // reuses the cache instead of refetching + flashing a loader every time.
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      // Keep the previous page's data visible while the next query loads.
      placeholderData: (prev: unknown) => prev,
    },
  },
});

/**
 * Single, stable splash shown while auth state is being resolved. Both guards
 * render this identical element so there is never a flip between blank / login /
 * dashboard before authentication is known.
 */
const AuthSplash: React.FC = () => (
  <div
    style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'var(--color-bg-main, #0b0f1a)',
      color: 'var(--color-text-light, #94a3b8)',
      fontSize: '0.9rem',
      letterSpacing: '0.02em',
    }}
  >
    <span className="spin" style={{ width: 18, height: 18, border: '2px solid currentColor', borderTopColor: 'transparent', borderRadius: '50%', marginRight: 10, display: 'inline-block' }} />
    Authenticating…
  </div>
);

const ProtectedRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { admin, loading } = useAuth();
  if (loading) return <AuthSplash />;
  if (!admin) return <Navigate to="/login" replace />;
  return <>{children}</>;
};

const PublicRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { admin, loading } = useAuth();
  if (loading) return <AuthSplash />;
  if (admin) return <Navigate to="/dashboard" replace />;
  return <>{children}</>;
};

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route
              path="/login"
              element={
                <PublicRoute>
                  <LoginPage />
                </PublicRoute>
              }
            />

            <Route
              element={
                <ProtectedRoute>
                  <AdminLayout />
                </ProtectedRoute>
              }
            >
              <Route path="/dashboard" element={<DashboardPage />} />
              <Route path="/colleges" element={<CollegesPage />} />
              <Route path="/users" element={<UsersPage />} />
              <Route path="/campus-reps" element={<CampusRepsPage />} />
              <Route path="/reports" element={<ReportsPage />} />
              <Route path="/support" element={<SupportPage />} />
              <Route path="/monitoring" element={<MonitoringPage />} />
              <Route path="/analytics" element={<DashboardPage />} />
              <Route path="/flags" element={<FlagsPage />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="/audit" element={<AuditPage />} />
              <Route path="/sessions" element={<SessionsPage />} />
              <Route path="*" element={<Navigate to="/dashboard" replace />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </QueryClientProvider>
  );
}
