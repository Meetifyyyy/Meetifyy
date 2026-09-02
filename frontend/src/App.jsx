import { lazy, Suspense, useMemo } from 'react';
import { IS_DEV_BUILD } from '@config';
import { isKnownAppRoute } from '@config/seo';
import { createBrowserRouter, RouterProvider, Navigate, Outlet, ScrollRestoration, useLocation } from 'react-router-dom';
import { QueryErrorResetBoundary } from '@tanstack/react-query';
import { SmartBackTracker } from './shared/hooks/useSmartBack';
import { useAuth } from './shared/context/AuthContext';
import DashboardLayoutWrapper from './layout/DashboardLayoutWrapper';
import ErrorBoundary, { RouteErrorBoundary } from './shared/components/ErrorBoundary';
import PageMetadata from './shared/seo/PageMetadata';
import SocketManager from './shared/components/SocketManager';
import OverlayHistoryBridge from './shared/components/OverlayHistoryBridge';
import LegacyPathRedirect from './shared/components/LegacyPathRedirect';
import { setRedirectIntent, consumeRedirectIntent, clearRedirectIntent } from './shared/utils/redirectIntent';
import CookieBanner, { CookiePreferencesModal } from './shared/components/CookieBanner/CookieBanner';
// DEV PREVIEW — remove before shipping
import CriticalErrorScreen from './shared/components/ui/CriticalErrorScreen';
import useDevToolsStore from './shared/stores/devToolsStore';
// Dev-only, and now off by default: the lab's floating button is fixed above
// everything at the bottom-right, so leaving it always-on in dev meant it sat
// on top of real controls (the chat Send button among them). Enable it from
// Settings -> Developer.
function NotificationLabMount() {
  const enabled = useDevToolsStore((s) => s.notificationLabEnabled);
  if (!IS_DEV_BUILD || !NotificationPlayground || !enabled) return null;
  return (
    <Suspense fallback={null}>
      <NotificationPlayground />
    </Suspense>
  );
}

// These three previews live in src/local/, which is gitignored — they exist on a
// developer's machine and never in a clean checkout.
//
// The gate MUST be the inline `import.meta.env.DEV`, not the IS_DEV_BUILD
// re-export. Vite substitutes the inline form with the literal `false` in a
// production build, so Rollup drops the whole branch and never tries to resolve
// the module. Behind an imported binding it cannot prove the branch is dead
// before resolution, so it attempts to resolve a path that is not in the repo
// and the build fails — which is exactly what broke the Vercel deploy.
const NotificationPlayground = import.meta.env.DEV
  ? lazy(() => import('./local/NotificationPlayground').catch(() => ({ default: () => null })))
  : null;
// DEV — logo animation experiment (remove before shipping)
const LogoAnimationPage = import.meta.env.DEV
  ? lazy(() => import('./local/LogoAnimation').catch(() => ({ default: () => null })))
  : null;
// DEV — Instant Match visual harness (every state, no backend needed)
const InstantMatchPreview = import.meta.env.DEV
  ? lazy(() => import('./local/InstantMatchPreview').catch(() => ({ default: () => null })))
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

function lazyRoute(componentImport) {
  // Route chunks are precached by the worker that owns this document. A new
  // worker is not activated until old clients close, so an active session keeps
  // access to the exact chunk set it started with. Unexpected import failures
  // reach the error boundary instead of wiping caches and reloading the app.
  return lazy(componentImport);
}

const LandingPage = lazyRoute(() => import('./features/auth/pages/LandingPage'));
const AuthShell = lazyRoute(() => import('./features/auth/shared/ui/AuthShell'));
const FeedRoute = lazyRoute(() => import('./features/feed/pages/FeedRoute'));
const CommunitiesRoute = lazyRoute(() => import('./features/communities/pages/CommunitiesRoute'));
const CommunityDetailRoute = lazyRoute(() => import('./features/communities/pages/CommunityDetailRoute'));
const PostDetailRoute = lazyRoute(() => import('./features/feed/pages/PostDetailRoute'));
const MessagesRoute = lazyRoute(() => import('./features/messages/pages/MessagesRoute'));
const ProfilePage = lazyRoute(() => import('./features/profile/pages/ProfilePage'));
const SearchResultsRoute = lazyRoute(() => import('./features/search/pages/SearchResultsRoute'));
const LoginPage = lazyRoute(() => import('./features/auth/pages/LoginPage'));
const SignupPage = lazyRoute(() => import('./features/auth/pages/SignupPage'));
const ForgotPasswordPage = lazyRoute(() => import('./features/auth/pages/ForgotPasswordPage'));
const ResetPasswordPage = lazyRoute(() => import('./features/auth/pages/ResetPasswordPage'));
const OnboardingRoute = lazyRoute(() => import('./features/onboarding/pages/OnboardingRoute'));
const SettingsRoute = lazyRoute(() => import('./features/settings/pages/SettingsRoute'));
const FindYourCrewPage = lazyRoute(() => import('./features/crew/pages/FindYourCrewPage'));
const ActivityDetailPage = lazyRoute(() => import('./features/crew/pages/ActivityDetailPage'));
const CreateActivityPage = lazyRoute(() => import('./features/crew/pages/CreateActivityPage'));
const NotificationsRoute = lazyRoute(() => import('./features/notifications/pages/NotificationsRoute'));
const CampusPage = lazyRoute(() => import('./features/campus/pages/CampusPage'));
const DirectoryPage = lazyRoute(() => import('./features/campus/pages/DirectoryPage'));
const CampusCommunitiesPage = lazyRoute(() => import('./features/campus/pages/CampusCommunitiesPage'));
const CampusEventsPage = lazyRoute(() => import('./features/campus-events/pages/CampusEventsPage'));
const CampusEventDetailPage = lazyRoute(() => import('./features/campus-events/pages/CampusEventDetailPage'));
const SavedPage = lazyRoute(() => import('./features/feed/pages/SavedPage'));
const AboutPage = lazyRoute(() => import('./features/info/pages/AboutPage'));
const CommunityGuidelinesPage = lazyRoute(() => import('./features/info/pages/CommunityGuidelinesPage'));
const CookiePolicyPage = lazyRoute(() => import('./features/info/pages/CookiePolicyPage'));
const PrivacyPolicyPage = lazyRoute(() => import('./features/info/pages/PrivacyPolicyPage'));
const TermsPage = lazyRoute(() => import('./features/info/pages/TermsPage'));
const HelpSupportPage = lazyRoute(() => import('./features/info/help/HelpSupportPage'));

/**
 * Wraps a route element with a scoped error boundary and suspense fallback.
 * @param {JSX.Element} element - The route element to wrap.
 * @param {JSX.Element} [fallback] - Custom skeleton. Defaults to full-page shell for public routes.
 */
function withBoundary(element, fallback = null, boundaryProps = {}) {
  // element.type is the lazy component reference — unique per route.
  // Keying the boundary on it ensures React mounts a fresh boundary
  // instance for every distinct page, so a stale hasError never bleeds
  // into an unrelated route.
  const boundaryKey = element.type;
  return (
    <QueryErrorResetBoundary key={boundaryKey}>
      {({ reset }) => (
        <RouteErrorBoundary key={boundaryKey} resetKey={boundaryKey} onResetQueries={reset} {...boundaryProps}>
          <Suspense fallback={fallback}>
            {element}
          </Suspense>
        </RouteErrorBoundary>
      )}
    </QueryErrorResetBoundary>
  );
}


function ProtectedRoute({ children }) {
  const { isLoggedIn, currentUser, loading } = useAuth();
  const location = useLocation();
  if (loading) return null;
  if (!isLoggedIn) {
    // A url that matches no route is not a page to sign in for, it is a page
    // that does not exist. Sending it to '/' made every dead link answer 200
    // with the landing page (a soft 404), and stored a redirect intent that
    // would drop the user back on the same dead url right after signing in.
    //
    // `isKnownAppRoute` is the same predicate the edge uses to choose between
    // the SPA shell and a real 404 response, so the status code and the page
    // the visitor sees always agree.
    if (!isKnownAppRoute(location.pathname)) {
      return <PublicNotFound />;
    }
    // Remember the deep link so signing in returns the user to the page they
    // actually asked for. History state can't carry it: the user walks through
    // the landing page and login before it is needed.
    setRedirectIntent(location.pathname + location.search + location.hash);
    return <Navigate to="/" replace state={{ from: location }} />;
  }
  if (currentUser?.isNewUser && location.pathname !== '/onboarding') {
    return <Navigate to="/onboarding" replace />;
  }
  // Both gates wrap rather than redirect: neither a suspended account nor one
  // inside its deletion window has anywhere to be sent, and a dedicated route
  // would just be somewhere to navigate away from. Each renders its notice over
  // every authenticated page and renders the page untouched for everyone else.
  // The server refuses the underlying requests regardless, so these are the
  // explanation, not the enforcement.
  //
  // Deletion is checked outermost: an account can be both suspended and
  // pending deletion, and in that case the recoverable state is the one the
  // person can still act on.
  return (
    <AccountDeletionGate>
      <SuspensionGate>
        {children}
        {/* Sits inside the gates on purpose: an account that is suspended or
            being deleted should not be congratulated on being verified. */}
        <VerifiedWelcome />
      </SuspensionGate>
    </AccountDeletionGate>
  );
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

import SuspensionGate from './shared/components/SuspensionGate';
import AccountDeletionGate from './shared/components/AccountDeletionGate';
import VerifiedWelcome from './shared/components/VerifiedWelcome';
import NotFoundState from './shared/components/ui/NotFoundState';
import PublicNotFound from './shared/components/PublicNotFound';

/**
 * NotFound — shown for authenticated users who hit an unmatched route.
 * Keeps the shell (header + sidebar) mounted.
 */
function NotFound() {
  const { isLoggedIn } = useAuth();
  // Signed-out visitors no longer reach this: ProtectedRoute renders
  // PublicNotFound for them, with the landing chrome rather than the dashboard
  // shell, which a session is required to build. Kept as a guard so the branch
  // stays correct if this catch-all is ever moved out of the auth boundary.
  if (!isLoggedIn) return <PublicNotFound />;
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
          <PageMetadata />
          <OverlayHistoryBridge />
          <ScrollRestoration />
          <SocketManager />
          <NotificationLabMount />
          <CookieBanner />
          <CookiePreferencesModal />
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
          path: '/help-and-support',
          element: <StaticRoute>{withBoundary(<HelpSupportPage />, null)}</StaticRoute>,
        },
        {
          path: '/support',
          element: <Navigate to="/help-and-support" replace />,
        },
        {
          path: '/help',
          element: <Navigate to="/help-and-support" replace />,
        },
        {
          // The old contact page was a frontend-only form that recorded nothing
          // and mailed nobody; Help & Support replaces it end to end. Kept as a
          // redirect rather than removed, because /contact is already linked
          // from outside the app and from older emails.
          path: '/contact',
          element: <Navigate to="/help-and-support" replace />,
        },
        // -- DEV PREVIEW - delete this route before shipping ------------------
        // Gated on IS_DEV_BUILD like its three neighbours. It was not, so
        // /dev/critical-error was a live route on the production site: a
        // crawlable URL that renders a full-screen error page under the real
        // domain. robots.txt disallows /dev, but a disallowed URL can still be
        // listed from an external link, and the fix for a page that should not
        // exist in production is to not ship it.
        ...(IS_DEV_BUILD ? [
          {
            path: '/dev/critical-error',
            element: <CriticalErrorScreen onRetry={() => window.location.reload()} />,
          },
        ] : []),
        ...(IS_DEV_BUILD && NotificationPlayground ? [
          {
            path: '/dev/notifications',
            element: <Suspense fallback={null}><NotificationPlayground /></Suspense>,
          }
        ] : []),
        ...(IS_DEV_BUILD && InstantMatchPreview ? [
          {
            path: '/dev/instant-match',
            element: <StaticRoute><Suspense fallback={null}><InstantMatchPreview /></Suspense></StaticRoute>,
          }
        ] : []),
        // DEV — logo animation experiment
        ...(IS_DEV_BUILD && LogoAnimationPage ? [
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
            { path: '/onboarding', element: withBoundary(<OnboardingRoute />, null, { fullScreen: true }) },
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
