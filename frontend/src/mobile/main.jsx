/**
 * The native app's entry point.
 *
 * It mounts THE WEBSITE. Same `App`, same providers, same routes, same screens
 * — the native build is the existing app running in a WebView, not a second app
 * that resembles it. Everything that makes the site work on a phone is already
 * there: it is responsive, it has a bottom nav below 768px, it uses safe-area
 * insets. None of that needed rebuilding and none of it was.
 *
 * WHAT ACTUALLY DIFFERS, AND WHY EACH ONE HAS TO
 *
 *   1. The opening screen. `/` on the website is a landing page — a marketing
 *      surface for someone who has not heard of Meetifyy. Someone opening the
 *      installed app has heard of it and installed it, so they get a front door
 *      instead. One route, overridden by prop.
 *
 *   2. No service worker. Not skipped by a runtime check — `vite.mobile.config.js`
 *      never loads the PWA plugin, so the code is absent. A caching worker in a
 *      WebView can serve its copy of the DEPLOYED SITE instead of the reviewed
 *      bundle, and iOS has no service worker support at all.
 *
 *   3. No launch-time version gate. It compares the running build against the
 *      deployed one; a bundled app has no deployment to be stale against, and
 *      updates come through the store.
 *
 *   4. No Vercel analytics. It reports to a web project and is already gated to
 *      production hosts there.
 *
 * The API origin differs too, but that is not decided here — see
 * `shared/api/apiClient.js`, which picks its platform from `config.client`.
 * Without it every request inside the WebView would go to `localhost:4000`.
 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'sonner';

import App from '../App.jsx';
import AppOpenScreen from './AppOpenScreen';
import { AuthProvider } from '../shared/context/AuthContext';
import { CookieConsentProvider } from '../shared/context/CookieConsentContext';
import { ThemeProvider } from '../shared/context/ThemeContext';
import { MediaViewerProvider } from '../shared/context/MediaViewerContext';
import { UsersMapProvider } from '../shared/hooks/useUsersMap';
import MediaViewerHost from '../shared/components/MediaViewer/MediaViewerHost';
import { createCapacitorBackButton } from '../platform/capacitor/backButton';
import { installNativeBackButton } from './nativeBackButton';
import UpdateGate from './UpdateGate';
import { createCapacitorSystemBars } from '../platform/capacitor/systemBars';
import { installSystemBars } from './installSystemBars';

import '../styles/variables.css';
import '../styles/global.css';
import '../styles/typography.css';
/*
 * Last, and app-only. Everything above is shared with the website; this is the
 * file that is allowed to make decisions the website must not inherit.
 */
import './mobile.css';

/**
 * The same cache settings as the website, with one deliberate change.
 *
 * `refetchOnWindowFocus` is off: there is no tab to focus in a WebView, so what
 * fires on the web when someone returns to the tab would simply never fire
 * here. Leaving it on would be a setting that looks active and does nothing.
 * The event that matters on a device — reopening the app — arrives from
 * `AppLifecycle.onResume` once the Capacitor plugins are installed.
 *
 * The rest is copied rather than shared, so the two clients can diverge on
 * mobile-data behaviour without one of them changing the other.
 */
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 1000 * 60 * 15,
      refetchOnWindowFocus: false,
      refetchOnReconnect: true,
      retry: (failureCount, error) => {
        const status = error?.status;
        if (typeof status === 'number' && status >= 400 && status < 500) return false;
        return failureCount < 1;
      },
      retryDelay: (attempt) =>
        Math.min(30_000, 1000 * 2 ** attempt) * (0.5 + Math.random() * 0.5),
    },
  },
});

// Enables CSS :active on touch devices — the same one-liner the website uses.
if (typeof document !== 'undefined') {
  document.addEventListener('touchstart', () => {}, { passive: true });
}

/**
 * Android's back button, claimed before the first render.
 *
 * Capacitor only suppresses Android's default — finish the Activity — while a
 * listener is attached, so this is subscribed once for the life of the process
 * rather than from an effect. Measured on a device before this existed: one
 * back press on `/login` killed the app instead of returning to the previous
 * screen.
 *
 * Never unsubscribed, and that is correct: it lives exactly as long as the app
 * does, and there is no unmount to clean up after.
 */
installNativeBackButton(createCapacitorBackButton());

/**
 * The phone's status bar and navigation bar, painted to match the app.
 *
 * Installed here rather than from a component because it is a property of the
 * process, not of any screen, and it must survive every route change. It reads
 * `--color-bg-white` — the colour the app's own header and bottom navigation
 * use — so the system bars and the app's bars are the same colour by
 * construction rather than by two values being kept in step by hand.
 *
 * Runs after the stylesheets above are imported; reading the variable before
 * them returns nothing and the bars keep the window's default white.
 */
installSystemBars(createCapacitorSystemBars());

createRoot(document.getElementById('root')).render(
  <QueryClientProvider client={queryClient}>
    <StrictMode>
      <ThemeProvider>
        <CookieConsentProvider>
          <AuthProvider>
            <MediaViewerProvider>
              <UsersMapProvider>
                <Toaster
                  position="top-center"
                  duration={4500}
                  gap={10}
                  visibleToasts={4}
                  toastOptions={{
                    style: {
                      background: 'transparent',
                      border: 'none',
                      boxShadow: 'none',
                      padding: 0,
                      width: '380px',
                      maxWidth: 'calc(100vw - 24px)',
                    },
                  }}
                />
                {/*
                  Inside the providers, not outside: the wall is rendered by the
                  same tree as the app, so it inherits the theme and does not
                  need its own copy of anything. Outside `App` so that a blocked
                  build never mounts the router at all — a wall that renders on
                  top of a running app is a wall with the app still running
                  behind it, making requests.
                */}
                <UpdateGate>
                  <App homeElement={<AppOpenScreen />} />
                </UpdateGate>
                <MediaViewerHost />
              </UsersMapProvider>
            </MediaViewerProvider>
          </AuthProvider>
        </CookieConsentProvider>
      </ThemeProvider>
    </StrictMode>
  </QueryClientProvider>,
);
