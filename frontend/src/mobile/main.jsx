/**
 * The mobile entry point.
 *
 * Deliberately thin, and deliberately not the web app in a different file. What
 * it proves at this phase is narrow and worth being precise about: that a
 * second client can be built from `core/` over `platform/capacitor/`, that it
 * owns its own runtime, and that the bundle it produces contains no service
 * worker. The mobile UI itself is the next phase; this is the shell it will
 * mount into.
 *
 * WHAT IS NOT HERE, AND IS NOT AN OVERSIGHT
 *   • No service-worker registration. `vite.mobile.config.js` does not load
 *     vite-plugin-pwa at all, so there is nothing to register — and because the
 *     code is absent rather than skipped by an `if`, it cannot fail open the way
 *     the web gate once did. CI greps `dist-mobile/` to keep it that way.
 *   • No launch-time version gate. A bundled app has no deployment to be stale
 *     against; updates come through the store.
 *   • No Vercel analytics. Web-only by construction, and already host-gated
 *     there.
 *   • No router and no screens yet. Phase 5.
 *
 * ITS OWN RUNTIME, WHICH IS THE RULE
 * The QueryClient below is created here, not imported. Neither it nor anything
 * else on this page is shared with the web client: `core/` exports factories
 * precisely so that each client builds its own, and a singleton crossing the
 * two would make "redesign one without touching the other" untrue at the first
 * cache invalidation.
 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { apiClient, getBackendUrl } from './api';

import '../styles/variables.css';
import '../styles/global.css';
import '../styles/typography.css';

/**
 * This client's cache, with mobile's own defaults rather than the web's.
 *
 * `refetchOnWindowFocus` is off because it does not mean anything useful in a
 * WebView: there is no tab to focus, and the event that actually matters —
 * the user returning to the app — arrives through `AppLifecycle.onResume`,
 * which Phase 6 wires up. Leaving the web default on would be a setting that
 * looks active and never fires.
 *
 * The retry policy is shared with the web client in spirit and duplicated in
 * fact, because it is four lines and extracting it would mean the two clients
 * could no longer diverge on mobile-data behaviour — which they probably
 * should.
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

/**
 * A placeholder screen, and an honest one.
 *
 * It reports what this build actually is and which API it resolved, because
 * that second fact is the one worth seeing on a device first: if the origin
 * reads `localhost` here, blocker B1 is back.
 */
function MobileShell() {
  return (
    <div style={{ padding: '2rem', fontFamily: 'system-ui, sans-serif' }}>
      <h1 style={{ fontSize: '1.25rem', margin: '0 0 0.5rem' }}>Meetifyy — mobile shell</h1>
      <p style={{ margin: '0 0 1.5rem', opacity: 0.7 }}>
        Build target: mobile. The mobile UI lands in the next phase.
      </p>
      <dl style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '0.25rem 1rem', fontSize: '0.9rem' }}>
        <dt style={{ opacity: 0.6 }}>API origin</dt>
        <dd style={{ margin: 0 }}><code>{getBackendUrl() || '(none)'}</code></dd>
        <dt style={{ opacity: 0.6 }}>API client</dt>
        <dd style={{ margin: 0 }}><code>{apiClient ? 'constructed' : 'missing'}</code></dd>
      </dl>
    </div>
  );
}

const shell = document.getElementById('launch-shell');
if (shell) shell.remove();

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <MobileShell />
    </QueryClientProvider>
  </StrictMode>,
);
