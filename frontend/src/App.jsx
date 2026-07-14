import { lazy, Suspense, useMemo } from 'react';
import { createBrowserRouter, RouterProvider, Navigate, Outlet, ScrollRestoration, useLocation } from 'react-router-dom';
import { SmartBackTracker } from './shared/hooks/useSmartBack';
import { useAuth } from './shared/context/AuthContext';
import DashboardLayoutWrapper from './layout/DashboardLayoutWrapper';
import ErrorBoundary, { RouteErrorBoundary } from './shared/components/ErrorBoundary';
import InstallPopup from './shared/components/InstallPopup';
import PageShellSkeleton from './shared/components/PageShellSkeleton';

const LandingPage = lazy(() => import('./features/auth/pages/LandingPage'));
const FeedRoute = lazy(() => import('./features/feed/pages/FeedRoute'));
const CommunitiesRoute = lazy(() => import('./features/communities/pages/CommunitiesRoute'));
const CommunityDetailRoute = lazy(() => import('./features/communities/pages/CommunityDetailRoute'));
const PostDetailRoute = lazy(() => import('./features/feed/pages/PostDetailRoute'));
const MessagesRoute = lazy(() => import('./features/messages/pages/MessagesRoute'));
const ProfilePage = lazy(() => import('./features/profile/pages/ProfilePage'));
const SearchResultsRoute = lazy(() => import('./features/search/pages/SearchResultsRoute'));
const LoginPage = lazy(() => import('./features/auth/pages/LoginPage'));
const SignupPage = lazy(() => import('./features/auth/pages/SignupPage'));
const ForgotPasswordPage = lazy(() => import('./features/auth/pages/ForgotPasswordPage'));
const OnboardingRoute = lazy(() => import('./features/onboarding/pages/OnboardingRoute'));
const SettingsRoute = lazy(() => import('./features/settings/pages/SettingsRoute'));
const FindYourCrewPage = lazy(() => import('./features/crew/pages/FindYourCrewPage'));
const ActivityDetailPage = lazy(() => import('./features/crew/pages/ActivityDetailPage'));
const CreateActivityPage = lazy(() => import('./features/crew/pages/CreateActivityPage'));
const NotificationsRoute = lazy(() => import('./features/notifications/pages/NotificationsRoute'));
const CampusPage = lazy(() => import('./features/campus/pages/CampusPage'));
const DirectoryPage = lazy(() => import('./features/campus/pages/DirectoryPage'));
const ActivitiesPage = lazy(() => import('./features/campus/pages/ActivitiesPage'));
const GroupsPage = lazy(() => import('./features/campus/pages/GroupsPage'));
const SavedPage = lazy(() => import('./features/feed/pages/SavedPage'));

/** Wraps a route element with a scoped error boundary and suspense fallback */
function withBoundary(element) {
  return (
    <RouteErrorBoundary>
      <Suspense fallback={<PageShellSkeleton />}>
        {element}
      </Suspense>
    </RouteErrorBoundary>
  );
}

function ProtectedRoute({ children }) {
  const { isLoggedIn, currentUser } = useAuth();
  const location = useLocation();
  if (!isLoggedIn) return <Navigate to="/" replace state={{ from: location }} />;
  if (currentUser?.isNewUser && location.pathname !== '/onboarding') return <Navigate to="/onboarding" replace />;
  return children;
}

function PublicRoute({ children }) {
  const { isLoggedIn } = useAuth();
  if (isLoggedIn) return <Navigate to="/home" replace />;
  return children;
}

/**
 * NotFound — shown for authenticated users who hit an unmatched route.
 * Keeps the shell (header + sidebar) mounted.
 */
function NotFound() {
  const { isLoggedIn } = useAuth();
  if (!isLoggedIn) return <Navigate to="/" replace />;
  return (
    <main className="centre">
      <div style={{
        padding: '3rem 2rem',
        textAlign: 'center',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '1rem',
        marginTop: '4rem',
      }}>
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--color-text-light)" strokeWidth="1.5">
          <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        <h1 style={{ fontSize: '1.35rem', fontWeight: 700, color: 'var(--color-text-main)', margin: 0 }}>Page not found</h1>
        <p style={{ fontSize: '0.875rem', color: 'var(--color-text-muted)', margin: 0 }}>
          That page doesn't exist or has been moved.
        </p>
      </div>
    </main>
  );
}

/**
 * App — router is created inside the component so it can use React context
 * (auth, query clients, etc.) in future data loaders without needing workarounds.
 *
 * Each route element is wrapped individually in <RouteErrorBoundary> so a crash
 * on one page never unmounts the surrounding shell (header, sidebar, bottom nav).
 */
export default function App() {
  const router = useMemo(() => createBrowserRouter([
    {
      path: '/',
      element: (
        <ErrorBoundary>
          <SmartBackTracker />
          <ScrollRestoration />
          <InstallPopup />
          <Outlet />
        </ErrorBoundary>
      ),
      children: [
        {
          path: '/',
          element: (
            <PublicRoute>
              {withBoundary(<LandingPage />)}
            </PublicRoute>
          ),
        },
        {
          path: '/login',
          element: (
            <PublicRoute>
              {withBoundary(<LoginPage />)}
            </PublicRoute>
          ),
        },
        {
          path: '/signup',
          element: (
            <PublicRoute>
              {withBoundary(<SignupPage />)}
            </PublicRoute>
          ),
        },
        {
          path: '/forgot-password',
          element: (
            <PublicRoute>
              {withBoundary(<ForgotPasswordPage />)}
            </PublicRoute>
          ),
        },
        {
          element: (
            <ProtectedRoute>
              <Outlet />
            </ProtectedRoute>
          ),
          children: [
            { path: '/onboarding', element: withBoundary(<OnboardingRoute />) },
            {
              element: <DashboardLayoutWrapper />,
              children: [
            { path: '/home',                       element: withBoundary(<FeedRoute />) },
            { path: '/search',                     element: withBoundary(<SearchResultsRoute />), handle: { wide: true } },
            { path: '/communities',                element: withBoundary(<CommunitiesRoute />), handle: { wide: true } },
            { path: '/communities/:id',            element: withBoundary(<CommunityDetailRoute />), handle: { wide: true } },
            { path: '/messages/:conversationId?',  element: withBoundary(<MessagesRoute />), handle: { wide: true } },
            { path: '/post/:id',                   element: withBoundary(<PostDetailRoute />) },
            { path: '/profile/:profileUsername?',  element: withBoundary(<ProfilePage />), handle: { wide: true } },
            { path: '/settings',                   element: withBoundary(<SettingsRoute />), handle: { wide: true } },
            { path: '/notifications',              element: withBoundary(<NotificationsRoute />), handle: { wide: true } },
            { path: '/campus',                     element: withBoundary(<CampusPage />), handle: { wide: true } },
            { path: '/campus/directory',           element: withBoundary(<DirectoryPage />), handle: { wide: true } },
            { path: '/campus/activities',          element: withBoundary(<ActivitiesPage />), handle: { wide: true } },
            { path: '/campus/groups',              element: withBoundary(<GroupsPage />), handle: { wide: true } },
            { path: '/crew',                       element: withBoundary(<FindYourCrewPage />), handle: { wide: true } },
            { path: '/crew/create',                element: withBoundary(<CreateActivityPage />), handle: { wide: true } },
            { path: '/crew/:id',                   element: withBoundary(<ActivityDetailPage />), handle: { wide: true } },
            { path: '/saved',                      element: withBoundary(<SavedPage />) },
            { path: '*',                           element: withBoundary(<NotFound />) },
          ],
        },
      ],
    },
  ],
},
{ path: '*', element: <Navigate to="/" replace /> },
]), []);

  return <RouterProvider router={router} />;
}
