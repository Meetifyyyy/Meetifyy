import { lazy, Suspense, useMemo, useEffect } from 'react';
import { createBrowserRouter, RouterProvider, Navigate, Outlet, ScrollRestoration, useLocation } from 'react-router-dom';
import { SmartBackTracker } from './shared/hooks/useSmartBack';
import { useAuth } from './shared/context/AuthContext';
import { useVersionCheck } from './shared/hooks/useVersionCheck';
import DashboardLayoutWrapper from './layout/DashboardLayoutWrapper';
import ErrorBoundary, { RouteErrorBoundary } from './shared/components/ErrorBoundary';
import SocketManager from './shared/components/SocketManager';
import OverlayHistoryBridge from './shared/components/OverlayHistoryBridge';
import LegacyPathRedirect from './shared/components/LegacyPathRedirect';
import { setRedirectIntent, consumeRedirectIntent, clearRedirectIntent } from './shared/utils/redirectIntent';
// DEV PREVIEW — remove before shipping
import CriticalErrorScreen from './shared/components/ui/CriticalErrorScreen';
const NotificationPlayground = import.meta.env.DEV
  ? lazy(() => import('./local/NotificationPlayground').catch(() => ({ default: () => null })))
  : null;
// DEV — logo animation experiment (remove before shipping)
const LogoAnimationPage = import.meta.env.DEV
  ? lazy(() => import('./local/LogoAnimation').catch(() => ({ default: () => null })))
  : null;

import HomeSkeleton from './features/feed/components/skeletons/HomeSkeleton';
import ProfilePageSkeleton from './features/profile/components/skeletons/ProfilePageSkeleton';

import CampusSkeleton from './features/campus/components/skeletons/CampusSkeleton';
import CrewSkeleton from './features/crew/components/skeletons/CrewSkeleton';
import CommunitiesSkeleton from './features/communities/components/skeletons/CommunitiesSkeleton';
import NotificationsSkeleton from './features/notifications/components/skeletons/NotificationsSkeleton';
import SearchSkeleton from './features/search/components/skeletons/SearchSkeleton';
import SettingsSkeleton from './features/settings/components/skeletons/SettingsSkeleton';
import SavedPageSkeleton from './features/feed/components/skeletons/SavedPageSkeleton';

function lazyWithRetry(componentImport) {
  return lazy(async () => {
    let pageHasAlreadyBeenReloaded = false;
    try {
      pageHasAlreadyBeenReloaded = JSON.parse(
        window.sessionStorage.getItem('page_reloaded_on_chunk_error') || 'false'
      );
    } catch (_) {}

    try {
      const component = await componentImport();
      try { window.sessionStorage.setItem('page_reloaded_on_chunk_error', 'false'); } catch (_) {}
      return component;
    } catch (error) {
      const msg = error?.message || '';
      const isChunkError =
        error?.name === 'ChunkLoadError' ||
        msg.includes('Failed to fetch dynamically imported module') ||
        msg.includes('Importing a module script failed') ||
        msg.includes('Failed to load module script') ||
        msg.includes('MIME type') ||
        msg.includes('Strict MIME type checking') ||
        msg.includes('dynamically imported module') ||
        msg.includes('Loading chunk');

      if (isChunkError && !pageHasAlreadyBeenReloaded) {
        try { window.sessionStorage.setItem('page_reloaded_on_chunk_error', 'true'); } catch (_) {}
        try {
          if ('serviceWorker' in navigator) {
            const registrations = await navigator.serviceWorker.getRegistrations();
            await Promise.all(registrations.map(r => r.unregister()));
          }
          if ('caches' in window) {
            const keys = await caches.keys();
            await Promise.all(keys.map(k => caches.delete(k)));
          }
        } catch {
          // ignore
        }
        const url = new URL(window.location.href);
        url.searchParams.set('_v', Date.now().toString());
        window.location.replace(url.toString());
        return new Promise(() => {}); // Hold until reload finishes
      }

      try { window.sessionStorage.setItem('page_reloaded_on_chunk_error', 'false'); } catch (_) {}
      throw error;
    }
  });
}

const LandingPage = lazyWithRetry(() => import('./features/auth/pages/LandingPage'));
const AuthShell = lazyWithRetry(() => import('./features/auth/shared/ui/AuthShell'));
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
const CampusCommunitiesPage = lazyWithRetry(() => import('./features/campus/pages/CampusCommunitiesPage'));
const CampusEventsPage = lazyWithRetry(() => import('./features/campus-events/pages/CampusEventsPage'));
const CampusEventDetailPage = lazyWithRetry(() => import('./features/campus-events/pages/CampusEventDetailPage'));
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
  // element.type is the lazy component reference — unique per route.
  // Keying the boundary on it ensures React mounts a fresh boundary
  // instance for every distinct page, so a stale hasError never bleeds
  // into an unrelated route.
  const boundaryKey = element.type;
  return (
    <RouteErrorBoundary key={boundaryKey} resetKey={boundaryKey}>
      <Suspense fallback={fallback}>
        {element}
      </Suspense>
    </RouteErrorBoundary>
  );
}

/**
 * Toggles a class on <html> to hide the window scrollbar on routes that scroll
 * at the window level (home feed) or should read as chrome-less (search). Scoped
 * to those paths so every other page keeps its normal scrollbar.
 */
function WindowScrollbarToggle() {
  const location = useLocation();
  useEffect(() => {
    const hide = location.pathname === '/home' || location.pathname === '/search';
    document.documentElement.classList.toggle('hide-window-scrollbar', hide);
    return () => document.documentElement.classList.remove('hide-window-scrollbar');
  }, [location.pathname]);
  return null;
}

function ProtectedRoute({ children }) {
  const { isLoggedIn, currentUser, loading } = useAuth();
  const location = useLocation();
  if (loading) return null;
  if (!isLoggedIn) {
    // Remember the deep link so signing in returns the user to the page they
    // actually asked for. History state can't carry it: the user walks through
    // the landing page and login before it is needed.
    setRedirectIntent(location.pathname + location.search + location.hash);
    return <Navigate to="/" replace state={{ from: location }} />;
  }
  if (currentUser?.isNewUser && location.pathname !== '/onboarding') {
    return <Navigate to="/onboarding" replace />;
  }
  return children;
}

function PublicRoute({ children }) {
  const { isLoggedIn, currentUser, loading } = useAuth();
  const location = useLocation();
  if (loading) return null;
  if (isLoggedIn) {
    if (currentUser?.isNewUser) {
      if (location.pathname === '/signup') {
        return children;
      }
      // The pending deep link is for a finished account; onboarding takes
      // priority and the stale intent must not fire later.
      clearRedirectIntent();
      return <Navigate to="/onboarding" replace />;
    }
    // Land on the page the user originally asked for, if there was one.
    return <Navigate to={consumeRedirectIntent() || '/home'} replace />;
  }
  return children;
}

function StaticRoute({ children }) {
  const { isLoggedIn, currentUser, loading } = useAuth();
  const location = useLocation();
  if (loading) return null;
  // Do not redirect to /onboarding from /reset-password — a PASSWORD_RECOVERY
  // session does not trigger a full sync, so currentUser.isNewUser may be stale.
  if (isLoggedIn && currentUser?.isNewUser && location.pathname !== '/reset-password') {
    return <Navigate to="/onboarding" replace />;
  }
  return children;
}

import NotFoundState from './shared/components/ui/NotFoundState';

/**
 * NotFound — shown for authenticated users who hit an unmatched route.
 * Keeps the shell (header + sidebar) mounted.
 */
function NotFound() {
  const { isLoggedIn } = useAuth();
  if (!isLoggedIn) return <Navigate to="/" replace />;
  return (
    <main style={{ gridColumn: '2 / -1', width: '100%', maxWidth: 'none', margin: 0, padding: 0 }}>
      <NotFoundState type="page" coverPage={true} />
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
  useVersionCheck();
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
          <OverlayHistoryBridge />
          <WindowScrollbarToggle />
          <ScrollRestoration />
          <SocketManager />
          {import.meta.env.DEV && NotificationPlayground && (
            <Suspense fallback={null}>
              <NotificationPlayground />
            </Suspense>
          )}
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
          element: (
            <PublicRoute>
              <AuthShell>
                <Outlet />
              </AuthShell>
            </PublicRoute>
          ),
          children: [
            {
              path: '/login',
              element: withBoundary(<LoginPage />, null),
            },
            {
              path: '/signup',
              element: withBoundary(<SignupPage />, null),
            },
            {
              path: '/forgot-password',
              element: withBoundary(<ForgotPasswordPage />),
            },
          ],
        },
        {
          path: '/reset-password',
          element: (
            // StaticRoute (not PublicRoute) — allows both logged-in and logged-out
            // users through. PublicRoute would redirect authenticated users to /home
            // before the Supabase PASSWORD_RECOVERY session can establish, breaking
            // the reset link for users who were previously signed in on this browser.
            // The page itself validates the PASSWORD_RECOVERY token.
            <StaticRoute>
              <AuthShell>
                {withBoundary(<ResetPasswordPage />)}
              </AuthShell>
            </StaticRoute>
          ),
        },
        {
          path: '/about',
          element: <StaticRoute>{withBoundary(<AboutPage />, null)}</StaticRoute>,
        },
        {
          path: '/privacy-policy',
          element: <StaticRoute>{withBoundary(<PrivacyPolicyPage />, null)}</StaticRoute>,
        },
        {
          path: '/terms-and-conditions',
          element: <StaticRoute>{withBoundary(<TermsPage />, null)}</StaticRoute>,
        },
        {
          path: '/terms',
          element: <Navigate to="/terms-and-conditions" replace />,
        },
        {
          path: '/community-guidelines',
          element: <StaticRoute>{withBoundary(<CommunityGuidelinesPage />, null)}</StaticRoute>,
        },
        {
          path: '/cookie-policy',
          element: <StaticRoute>{withBoundary(<CookiePolicyPage />, null)}</StaticRoute>,
        },
        {
          path: '/contact',
          element: <StaticRoute>{withBoundary(<ContactPage />, null)}</StaticRoute>,
        },
        // -- DEV PREVIEW - delete this route before shipping ------------------
        {
          path: '/dev/critical-error',
          element: <CriticalErrorScreen onRetry={() => window.location.reload()} />,
        },
        ...(import.meta.env.DEV && NotificationPlayground ? [
          {
            path: '/dev/notifications',
            element: <Suspense fallback={null}><NotificationPlayground /></Suspense>,
          }
        ] : []),
        // DEV — logo animation experiment
        ...(import.meta.env.DEV && LogoAnimationPage ? [
          {
            path: '/logo-animation',
            element: <StaticRoute><Suspense fallback={null}><LogoAnimationPage /></Suspense></StaticRoute>,
          }
        ] : []),
        // ----------------------------------------------------------------------
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
            { path: '/search',                     element: withBoundary(<SearchResultsRoute />, <SearchSkeleton />) },
            { path: '/communities',                element: withBoundary(<CommunitiesRoute />, <CommunitiesSkeleton />), handle: { wide: true } },
            { path: '/communities/:id',            element: withBoundary(<CommunityDetailRoute />, null), handle: { wide: true } },
            { path: '/messages/:param1?/:param2?', element: withBoundary(<MessagesRoute />, null), handle: { wide: true } },
            // /inbox was the old prefix for the same screens. It stays routable
            // for existing links but redirects, so Messages has exactly one
            // canonical URL per conversation.
            { path: '/inbox/*',                    element: <LegacyPathRedirect from="/inbox" to="/messages" /> },
            { path: '/post/:id',                   element: withBoundary(<PostDetailRoute />, null) },
            { path: '/profile/:profileUsername?',  element: withBoundary(<ProfilePage />, <ProfilePageSkeleton />) },
            { path: '/settings',                   element: withBoundary(<SettingsRoute />, <SettingsSkeleton />), handle: { wide: true } },
            { path: '/settings/:panel',            element: withBoundary(<SettingsRoute />, <SettingsSkeleton />), handle: { wide: true } },
            { path: '/notifications',              element: withBoundary(<NotificationsRoute />, <NotificationsSkeleton />), handle: { wide: true } },
            { path: '/campus',                     element: withBoundary(<CampusPage />, <CampusSkeleton />), handle: { wide: true } },
            { path: '/campus/directory',           element: withBoundary(<DirectoryPage />, null), handle: { wide: true } },
            { path: '/campus/communities',         element: withBoundary(<CampusCommunitiesPage />, null), handle: { wide: true } },
            { path: '/campus/events',              element: withBoundary(<CampusEventsPage />, null), handle: { wide: true } },
            { path: '/campus/events/:id',          element: withBoundary(<CampusEventDetailPage />, null), handle: { wide: true } },
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
// No sibling catch-all here: the root layout route already matches every path,
// so an unmatched URL is handled by the '*' child inside the dashboard shell
// above. A second catch-all at this level is unreachable, and having one
// invited the assumption that unknown URLs bounce to the landing page — they
// don't, and shouldn't: they render Not Found with the shell intact.
], {
  future: {
    v7_startTransition: true,
  }
}), []);

  return <RouterProvider router={router} />;
}
