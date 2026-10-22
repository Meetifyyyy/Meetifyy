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
// First: keeps a phone in landscape on the mobile layout (see the module).
import './installLandscapePhoneMedia';
import { installLaunchReadiness } from './launchReadiness';
import { warmSignedInLanding } from './warmSignedInLanding';
import { installQuerySnapshots } from './querySnapshots';
import { scheduleStorageMaintenance } from '../shared/lib/storageMaintenance';
import { installNetworkStatus } from '../shared/lib/networkStatus';
import { mutationDefaults } from '../shared/lib/mutationDefaults';
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
import { createNativeThemeRevealDriver } from '../platform/capacitor/themeReveal';
import { setThemeTransitionDriver } from '@shared/theme/themeTransition';
import { installSystemBars } from './installSystemBars';
import { readPageEdgeColors } from './pageEdgeColors';
import { createCapacitorDeepLinks } from '../platform/capacitor/deepLinks';
import { createCapacitorPush } from '../platform/capacitor/push';
import { setPushService } from '../shared/push/pushPlatform';
import DeepLinkNavigator from './navigation/DeepLinkNavigator';
import { installBackgroundSocket } from './backgroundSocket';
import { installLinkPressGuard } from './installLinkPressGuard';
import { config } from '../config';
import { installCapacitorSentry } from '../platform/capacitor/sentry';

import '../styles/variables.css';
import '../styles/global.css';
import '../styles/typography.css';
/*
 * Last, and app-only. Everything above is shared with the website; this is the
 * file that is allowed to make decisions the website must not inherit.
 */
import './mobile.css';

// Error monitoring first (JavaScript and native crashes), so a failure during
// boot is reported too. A no-op without a DSN; see platform/capacitor/sentry.js
// and docs/sentry.md. The version is stamped at build time by
// vite.mobile.config.js.
installCapacitorSentry({
  config,
  appVersion: typeof __MEETIFYY_APP_VERSION__ === 'string' ? __MEETIFYY_APP_VERSION__ : '',
});

/**
 * The same cache settings as the website, with one deliberate change.
 *
 * `refetchOnWindowFocus` is how the app refreshes on RESUME. It was off, on the
 * premise that a WebView has no tab to focus — but TanStack's focus manager
 * listens for `visibilitychange`, and the WebView fires it when the app goes to
 * the background and comes back (measured on a device, 2026-10-05). The
 * `AppLifecycle.onResume` that was meant to replace it was never implemented,
 * so nothing refreshed on resume at all.
 *
 * Every stale active query refreshes EXCEPT infinite lists (feed, community
 * posts, a chat's history, profile posts…). Refetching one re-requests every
 * page scrolled through, on mobile data, and reorders the list under someone's
 * thumb the moment they come back — resume also fires on return from the photo
 * picker mid-compose. Those lists have pull-to-refresh and live socket updates.
 *
 * The rest is copied rather than shared, so the two clients can diverge on
 * mobile-data behaviour without one of them changing the other.
 */
// The device's connectivity, handed to TanStack before anything queries; see
// shared/lib/networkStatus.js.
installNetworkStatus();

const queryClient = new QueryClient({
  defaultOptions: {
    // Fail fast offline instead of pausing silently; see shared/lib/mutationDefaults.js.
    mutations: mutationDefaults,
    queries: {
      staleTime: 5 * 60_000, // see src/main.jsx
      gcTime: 1000 * 60 * 30,
      // Resuming the app does not refetch every query; sockets reconnect and
      // deliver what changed, and refetchOnReconnect covers a dropped network.
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
 * The phone's system bars, continued from the page.
 *
 * Installed here rather than from a component because it is a property of the
 * process, not of any screen, and it must survive every route change. The bars
 * are transparent and the WebView runs beneath them, so the page paints them
 * itself: each strip takes the colour the current page paints at the edge it
 * meets (`readPageEdgeColors`), in the same frame as the change that caused it.
 * The theme's chrome colour is the fallback and what the next cold start
 * launches with.
 *
 * Runs after the stylesheets above are imported; reading the variable before
 * them returns nothing and the strips keep their CSS fallback.
 */
const systemBars = createCapacitorSystemBars();
installSystemBars(systemBars, { readEdges: readPageEdgeColors });

// The theme switch's reveal, drawn by the shell where it can be (see
// platform/capacitor/themeReveal.js); the same circle as the website's.
setThemeTransitionDriver(createNativeThemeRevealDriver());

// Before the app renders: AuthContext may call ready() on its first effect.
// The release is pushed to native as it happens (see SystemUiPlugin.appReady).
installLaunchReadiness({
  onRelease: () => systemBars.launchReady({
    theme: document.documentElement.getAttribute('data-theme') || '',
  }),
});

/**
 * Links into the app: `https://<site>/post/…` and the other shareable routes,
 * delivered by Android App Links (see AndroidManifest.xml). Subscribed before
 * the first render so the link that cold-started the app is not missed; the
 * navigator inside the router drains it once mounted.
 */
const deepLinks = createCapacitorDeepLinks({
  allowedHosts: [safeHost(config.app.siteUrl)],
});
/**
 * Push (docs/push-notifications.md): created before the first render for the
 * same reason, so a notification tap that cold-started the app is caught and
 * held for the navigator. It registers listeners only; it never prompts and
 * never registers a token on its own.
 */
const push = createCapacitorPush();
setPushService(push);
const deepLinkNavigator = <DeepLinkNavigator deepLinks={deepLinks} push={push} />;

function safeHost(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

// A returning user's home route and first feed page, started alongside the
// session restore rather than after it (see the module).
warmSignedInLanding(queryClient);

// The main tabs' first pages, restored from the device when a screen first
// asks for them and saved after each real fetch; see the module.
installQuerySnapshots(queryClient);

// Ask for this app's storage to be kept under storage pressure rather than
// evicted with other best-effort sites. Chromium decides silently, without a
// prompt; a refusal changes nothing, since every cache here can be rebuilt
// from the server.
try {
  void navigator.storage?.persist?.().catch(() => {});
} catch {
  // Storage API unavailable in this WebView.
}

// Release the realtime socket while the app sits in the background; see the module.
installBackgroundSocket();

// Holding a link lifts a draggable preview box in the WebView; the app has none.
installLinkPressGuard();

/**
 * Load Changa once the first screen is up. Only Profile uses it (the name and
 * the counters), so it is not preloaded at launch, but left to the first
 * Profile render it arrived after the text had painted in the fallback font,
 * which then visibly swapped. Loading it while the app is idle means it is
 * ready before Profile opens, without costing launch anything.
 */
if (typeof document !== 'undefined' && document.fonts?.load) {
  const warmChanga = () => {
    void document.fonts.load('800 1em Changa').catch(() => {
      // Nothing to do: the page still renders in the fallback font.
    });
  };
  if (typeof window.requestIdleCallback === 'function') {
    window.requestIdleCallback(warmChanga, { timeout: 3000 });
  } else {
    setTimeout(warmChanga, 1500);
  }
}

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
                  <App homeElement={<AppOpenScreen />} rootExtras={deepLinkNavigator} />
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

// Trim the on-device caches once per launch, when the WebView is idle; see the
// module. After the render call so it can never delay the first paint.
scheduleStorageMaintenance();
