import { lazy, Suspense, useMemo } from 'react';
import { createBrowserRouter, RouterProvider, Navigate, Outlet, ScrollRestoration, useLocation } from 'react-router-dom';
import { SmartBackTracker } from './shared/hooks/useSmartBack';
import { useAuth } from './shared/context/AuthContext';
import DashboardLayoutWrapper from './layout/DashboardLayoutWrapper';
import ErrorBoundary, { RouteErrorBoundary } from './shared/components/ErrorBoundary';
import SocketManager from './shared/components/SocketManager';

import HomeSkeleton from './features/feed/components/skeletons/HomeSkeleton';
import ProfilePageSkeleton from './features/profile/components/skeletons/ProfilePageSkeleton';
import MessagesSkeleton from './features/messages/components/skeletons/MessagesSkeleton';
import CampusSkeleton from './features/campus/components/skeletons/CampusSkeleton';
import CrewSkeleton from './features/crew/components/skeletons/CrewSkeleton';
import CommunitiesSkeleton from './features/communities/components/skeletons/CommunitiesSkeleton';
import NotificationsSkeleton from './features/notifications/components/skeletons/NotificationsSkeleton';
import SearchSkeleton from './features/search/components/skeletons/SearchSkeleton';
import SettingsSkeleton from './features/settings/components/skeletons/SettingsSkeleton';
import SavedPageSkeleton from './features/feed/components/skeletons/SavedPageSkeleton';

function lazyWithRetry(componentImport) {
  return lazy(async () => {
    const pageHasAlreadyBeenReloaded = JSON.parse(
      window.sessionStorage.getItem('page_reloaded_on_chunk_error') || 'false'
    );
    try {
      const component = await componentImport();
      window.sessionStorage.setItem('page_reloaded_on_chunk_error', 'false');
      return component;
    } catch (error) {
      if (!pageHasAlreadyBeenReloaded) {
        window.sessionStorage.setItem('page_reloaded_on_chunk_error', 'true');
        window.location.reload();
      }
      throw error;
    }
  });
}

import LandingPage from './features/auth/pages/LandingPage';
const FeedRoute = lazyWithRetry(() => import('./features/feed/pages/FeedRoute'));
const CommunitiesRoute = lazyWithRetry(() => import('./features/communities/pages/CommunitiesRoute'));
const CommunityDetailRoute = lazyWithRetry(() => import('./features/communities/pages/CommunityDetailRoute'));
const PostDetailRoute = lazyWithRetry(() => import('./features/feed/pages/PostDetailRoute'));
const MessagesRoute = lazyWithRetry(() => import('./features/messages/pages/MessagesRoute'));
const ProfilePage = lazyWithRetry(() => import('./features/profile/pages/ProfilePage'));
const SearchResultsRoute = lazyWithRetry(() => import('./features/search/pages/SearchResultsRoute'));
const LoginPage = lazyWithRetry(() => import('./features/auth/pages/LoginPage'));
const SignupPage = lazyWithRetry(() => import('./features/auth/pages/SignupPage'));
const ForgotPasswordPage = lazyWithRetry(() => import('./features/auth/pages/ForgotPasswordPage'));
const ResetPasswordPage = lazyWithRetry(() => import('./features/auth/pages/ResetPasswordPage'));
const OnboardingRoute = lazyWithRetry(() => import('./features/onboarding/pages/OnboardingRoute'));
const SettingsRoute = lazyWithRetry(() => import('./features/settings/pages/SettingsRoute'));
const FindYourCrewPage = lazyWithRetry(() => import('./features/crew/pages/FindYourCrewPage'));
const ActivityDetailPage = lazyWithRetry(() => import('./features/crew/pages/ActivityDetailPage'));
const CreateActivityPage = lazyWithRetry(() => import('./features/crew/pages/CreateActivityPage'));
const NotificationsRoute = lazyWithRetry(() => import('./features/notifications/pages/NotificationsRoute'));
const CampusPage = lazyWithRetry(() => import('./features/campus/pages/CampusPage'));
const DirectoryPage = lazyWithRetry(() => import('./features/campus/pages/DirectoryPage'));
const ActivitiesPage = lazyWithRetry(() => import('./features/campus/pages/ActivitiesPage'));
const GroupsPage = lazyWithRetry(() => import('./features/campus/pages/GroupsPage'));
const SavedPage = lazyWithRetry(() => import('./features/feed/pages/SavedPage'));
const AboutPage = lazyWithRetry(() => import('./features/info/pages/AboutPage'));
const CommunityGuidelinesPage = lazyWithRetry(() => import('./features/info/pages/CommunityGuidelinesPage'));
const CookiePolicyPage = lazyWithRetry(() => import('./features/info/pages/CookiePolicyPage'));
const PrivacyPolicyPage = lazyWithRetry(() => import('./features/info/pages/PrivacyPolicyPage'));
const TermsPage = lazyWithRetry(() => import('./features/info/pages/TermsPage'));
const ContactPage = lazyWithRetry(() => import('./features/info/pages/ContactPage'));

/**
 * Wraps a route element with a scoped error boundary and suspense fallback.
 * @param {JSX.Element} element - The route element to wrap.
 * @param {JSX.Element} [fallback] - Custom skeleton. Defaults to full-page shell for public routes.
 */
function withBoundary(element, fallback = null) {
  return (
    <RouteErrorBoundary>
      <Suspense fallback={fallback}>
        {element}
      </Suspense>
    </RouteErrorBoundary>
  );
}

function ProtectedRoute({ children }) {
  const { isLoggedIn, currentUser, loading } = useAuth();
  const location = useLocation();
  if (loading) return null;
  if (!isLoggedIn) return <Navigate to="/" replace state={{ from: location }} />;
  if (currentUser?.isNewUser && location.pathname !== '/onboarding' && location.pathname !== '/signup') return <Navigate to="/onboarding" replace />;
  return children;
}

function PublicRoute({ children }) {
  const { isLoggedIn, currentUser, loading } = useAuth();
  const location = useLocation();
  if (loading) return null;
  if (isLoggedIn) {
    if (currentUser?.isNewUser && location.pathname === '/signup') {
      return children;
    }
    return <Navigate to="/home" replace />;
  }
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
  // NOTE: This router is created inside the App component using useMemo so that
  // nested route elements and hooks (like ProtectedRoute, SocketManager) can
  // safely consume context from AuthProvider, which wraps App in main.jsx.
  // Do not restructure App to wrap AuthProvider; outer context must remain wrapper.
  const router = useMemo(() => createBrowserRouter([
    {
      path: '/',
      element: (
        <ErrorBoundary>
          <SmartBackTracker />
          <ScrollRestoration />
          <SocketManager />
          <Outlet />
        </ErrorBoundary>
      ),
      children: [
        {
          path: '/',
          element: (
            <PublicRoute>
              {withBoundary(<LandingPage />, null)}
            </PublicRoute>
          ),
        },
        {
          path: '/login',
          element: (
            <PublicRoute>
              {withBoundary(<LoginPage />, null)}
            </PublicRoute>
          ),
        },
        {
          path: '/signup',
          element: (
            <PublicRoute>
              {withBoundary(<SignupPage />, null)}
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
          path: '/reset-password',
          element: (
            <PublicRoute>
              {withBoundary(<ResetPasswordPage />)}
            </PublicRoute>
          ),
        },
        {
          path: '/about',
          element: withBoundary(<AboutPage />, null),
        },
        {
          path: '/privacy-policy',
          element: withBoundary(<PrivacyPolicyPage />, null),
        },
        {
          path: '/terms-and-conditions',
          element: withBoundary(<TermsPage />, null),
        },
        {
          path: '/terms',
          element: <Navigate to="/terms-and-conditions" replace />,
        },
        {
          path: '/community-guidelines',
          element: withBoundary(<CommunityGuidelinesPage />, null),
        },
        {
          path: '/cookie-policy',
          element: withBoundary(<CookiePolicyPage />, null),
        },
        {
          path: '/contact',
          element: withBoundary(<ContactPage />, null),
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
            { path: '/home',                       element: withBoundary(<FeedRoute />, <HomeSkeleton />) },
            { path: '/search',                     element: withBoundary(<SearchResultsRoute />, <SearchSkeleton />), handle: { wide: true } },
            { path: '/communities',                element: withBoundary(<CommunitiesRoute />, <CommunitiesSkeleton />), handle: { wide: true } },
            { path: '/communities/:id',            element: withBoundary(<CommunityDetailRoute />, null), handle: { wide: true } },
            { path: '/messages/:conversationId?',  element: withBoundary(<MessagesRoute />, <MessagesSkeleton />), handle: { wide: true } },
            { path: '/post/:id',                   element: withBoundary(<PostDetailRoute />, null) },
            { path: '/profile/:profileUsername?',  element: withBoundary(<ProfilePage />, <ProfilePageSkeleton />), handle: { wide: true } },
            { path: '/settings',                   element: withBoundary(<SettingsRoute />, <SettingsSkeleton />) },
            { path: '/notifications',              element: withBoundary(<NotificationsRoute />, <NotificationsSkeleton />), handle: { wide: true } },
            { path: '/campus',                     element: withBoundary(<CampusPage />, <CampusSkeleton />), handle: { wide: true } },
            { path: '/campus/directory',           element: withBoundary(<DirectoryPage />, null), handle: { wide: true } },
            { path: '/campus/activities',          element: withBoundary(<ActivitiesPage />, null), handle: { wide: true } },
            { path: '/campus/groups',              element: withBoundary(<GroupsPage />, null), handle: { wide: true } },
            { path: '/crew',                       element: withBoundary(<FindYourCrewPage />, <CrewSkeleton />), handle: { wide: true } },
            { path: '/crew/create',                element: withBoundary(<CreateActivityPage />, null), handle: { wide: true } },
            { path: '/crew/:id',                   element: withBoundary(<ActivityDetailPage />, null), handle: { wide: true } },
            { path: '/saved',                      element: withBoundary(<SavedPage />, <SavedPageSkeleton />) },
            { path: '*',                           element: withBoundary(<NotFound />) },
          ],
        },
      ],
    },
  ],
},
{ path: '*', element: <Navigate to="/" replace /> },
], {
  future: {
    v7_startTransition: true,
  }
}), []);

  return <RouterProvider router={router} />;
}
