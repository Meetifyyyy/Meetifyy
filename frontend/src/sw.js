import { precacheAndRoute, cleanupOutdatedCaches } from 'workbox-precaching';
import { registerRoute, NavigationRoute } from 'workbox-routing';
import { StaleWhileRevalidate, CacheFirst, NetworkFirst, NetworkOnly } from 'workbox-strategies';
import { ExpirationPlugin } from 'workbox-expiration';
import { CacheableResponsePlugin } from 'workbox-cacheable-response';
import { clientsClaim } from 'workbox-core';

// ─── Core Workbox Setup ─────────────────────────────────────────────────────

// NOTE: there is deliberately no top-level `self.skipWaiting()`.
//
// Calling it made every new deployment activate immediately and take over
// running tabs, which fired `controllerchange` and forced a full reload in the
// middle of whatever the user was doing. A new worker now installs quietly and
// waits; it takes over only when a client explicitly asks (see the
// SKIP_WAITING handler below), and clients only ask at page load, when there is
// no session state to lose.
clientsClaim();
cleanupOutdatedCaches();

// The page asks for the waiting worker to take over — sent at boot only.
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

// Inject the Vite-generated precache manifest at build time
precacheAndRoute(self.__WB_MANIFEST);

// Purge ALL legacy caches on activate — not just Workbox-prefixed ones.
// The old hand-written SW left behind caches (meetifyy-static-v3, meetifyy-images-v3,
// meetifyy-api-v3, etc.) that cleanupOutdatedCaches() never touches.
const CURRENT_CACHES = new Set([
  'js-chunks-cache',
  'css-chunks-cache',
  'google-fonts-cache',
  'gstatic-fonts-cache',
  'meetifyy-images-v3',
  // 'meetifyy-api-swr' is deliberately absent. No route writes to it any more,
  // and leaving it off the allowlist means the activate handler below deletes
  // whatever stale bodies an existing installation is still holding.
  'meetifyy-api-network',
  // Holds the last good index.html for offline navigations (see below).
  'app-shell',
]);

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(
        names
          .filter((n) => !CURRENT_CACHES.has(n) && !n.startsWith('workbox-precache'))
          .map((n) => caches.delete(n))
      )
    )
  );
});

// ─── Navigation Fallback ────────────────────────────────────────────────────

/**
 * Navigations are NETWORK-FIRST, falling back to the last good HTML offline.
 *
 * This is what makes "every reload gets the latest version" true without any
 * forced refresh. It used to be `createHandlerBoundToURL('/index.html')`, which
 * answers every navigation out of the precache — so a running installation kept
 * serving the HTML of the build it was installed with, no matter how many times
 * the user reloaded, until something forcibly wiped the cache. That stale shell
 * is exactly what the old force-refresh logic existed to paper over.
 *
 * Going to the network first removes the need for it: index.html is served
 * `no-store` (see vercel.json), so a reload always picks up the newest document
 * and therefore the newest hashed asset URLs. Those assets are content-addressed
 * and immutable, so they cache forever safely.
 *
 * The short timeout keeps this honest on a flaky mobile connection: if the
 * network has not answered in 4s, the cached shell is served rather than
 * leaving the user on a blank page.
 */
const navigationHandler = new NetworkFirst({
  cacheName: 'app-shell',
  networkTimeoutSeconds: 4,
  plugins: [new CacheableResponsePlugin({ statuses: [200] })],
});
const navigationRoute = new NavigationRoute(navigationHandler, {
  denylist: [/^\/api\//, /^\/version\.json/, /^\/assets\//, /\.[a-zA-Z0-9]+$/],
});
registerRoute(navigationRoute);

// ─── Static Asset Caching ───────────────────────────────────────────────────

// Hashed JS chunks — StaleWhileRevalidate (reject text/html responses from SPA fallback)
registerRoute(
  /\/assets\/.*\.js$/,
  new StaleWhileRevalidate({
    cacheName: 'js-chunks-cache',
    plugins: [
      new ExpirationPlugin({ maxEntries: 100, maxAgeSeconds: 30 * 24 * 60 * 60 }),
      {
        cacheWillUpdate: async ({ response }) => {
          if (!response || response.status !== 200) return null;
          const contentType = response.headers.get('content-type') || '';
          // Never cache HTML as a JavaScript chunk
          if (contentType.includes('text/html') || (!contentType.includes('javascript') && !contentType.includes('ecmascript'))) {
            return null;
          }
          return response;
        },
      },
    ],
  })
);

// CSS chunks — StaleWhileRevalidate (reject text/html responses from SPA fallback)
registerRoute(
  /\/assets\/.*\.css$/,
  new StaleWhileRevalidate({
    cacheName: 'css-chunks-cache',
    plugins: [
      new ExpirationPlugin({ maxEntries: 50, maxAgeSeconds: 30 * 24 * 60 * 60 }),
      {
        cacheWillUpdate: async ({ response }) => {
          if (!response || response.status !== 200) return null;
          const contentType = response.headers.get('content-type') || '';
          // Never cache HTML as a CSS chunk
          if (contentType.includes('text/html') || !contentType.includes('css')) {
            return null;
          }
          return response;
        },
      },
    ],
  })
);

// ─── Font Caching ───────────────────────────────────────────────────────────

registerRoute(
  /^https:\/\/fonts\.googleapis\.com\/.*/i,
  new CacheFirst({
    cacheName: 'google-fonts-cache',
    plugins: [
      new ExpirationPlugin({ maxEntries: 10, maxAgeSeconds: 365 * 24 * 60 * 60 }),
      new CacheableResponsePlugin({ statuses: [0, 200] }),
    ],
  })
);

registerRoute(
  /^https:\/\/fonts\.gstatic\.com\/.*/i,
  new CacheFirst({
    cacheName: 'gstatic-fonts-cache',
    plugins: [
      new ExpirationPlugin({ maxEntries: 10, maxAgeSeconds: 365 * 24 * 60 * 60 }),
      new CacheableResponsePlugin({ statuses: [0, 200] }),
    ],
  })
);

// ─── Image Caching — Cache First with TTL ───────────────────────────────────

registerRoute(
  ({ request, url }) => {
    const accept = request.headers.get('accept') || '';
    if (accept.includes('image')) return true;
    return /\.(png|jpe?g|webp|gif|svg|avif|ico)$/i.test(url.pathname);
  },
  new CacheFirst({
    cacheName: 'meetifyy-images-v3',
    plugins: [
      new ExpirationPlugin({ maxEntries: 200, maxAgeSeconds: 7 * 24 * 60 * 60 }),
      new CacheableResponsePlugin({ statuses: [0, 200] }),
    ],
  })
);

// ─── API Caching — Network First, for offline reads only ────────────────────
//
// These used to be split, with activities / communities / users / feed served
// StaleWhileRevalidate for 10 minutes. That strategy returns the cached body
// *and then* refreshes in the background — so the response the app actually
// received was the stale one, and the fresh one only landed in the cache for
// next time.
//
// Sitting underneath React Query, that shadowed every cache fix above it: a
// refetch triggered right after a mutation was answered from the worker with a
// pre-mutation body, and React Query accepted it as server truth. Create a post
// and navigate back and it was gone again; create an activity and the Crew page
// did not have it. Chrome's hard reload bypasses the service worker entirely,
// which is a large part of why a force refresh appeared to fix so much.
//
// NetworkFirst keeps the offline benefit — a cached body is still there when
// the network fails — without ever shadowing a live response while online.
// React Query already provides stale-while-revalidate at the application layer,
// where invalidation actually exists.
const NETWORK_FIRST_PATHS = [
  '/api/activities',
  '/api/communities',
  '/api/users',
  '/api/posts/feed',
  '/api/posts/community/',
  '/api/messages',
  '/api/notifications',
  '/api/presence',
];

registerRoute(
  ({ url }) => NETWORK_FIRST_PATHS.some((p) => url.pathname.startsWith(p)),
  new NetworkFirst({
    cacheName: 'meetifyy-api-network',
    plugins: [
      new ExpirationPlugin({ maxEntries: 60, maxAgeSeconds: 5 * 60 }),
      // 200 only. Status 0 is an opaque cross-origin response whose body cannot
      // be read — caching one as though it were an API answer stores something
      // no caller can use.
      new CacheableResponsePlugin({ statuses: [200] }),
    ],
  })
);

// C-3 fix: Never cache auth endpoints. Force them to network only to prevent
// sensitive JWTs/sessions from landing in local SW caches on shared devices.
registerRoute(
  ({ url }) => url.pathname.startsWith('/api/auth'),
  new NetworkOnly()
);

// ─── Background Sync ────────────────────────────────────────────────────────

self.addEventListener('sync', (event) => {
  if (event.tag === 'meetifyy-outbox') {
    event.waitUntil(flushOutbox());
  }
});

async function flushOutbox() {
  try {
    const db = await openOutboxDB();
    const tx = db.transaction('outbox', 'readwrite');
    const store = tx.objectStore('outbox');
    const all = await new Promise((res) => {
      const req = store.getAll();
      req.onsuccess = () => res(req.result);
      req.onerror = () => res([]);
    });
    for (const entry of all) {
      try {
        await fetch(entry.url, { method: entry.method, headers: entry.headers, body: entry.body });
        store.delete(entry.id);
      } catch {
        // Leave in outbox — retry on next sync
      }
    }
  } catch {
    // IndexedDB unavailable — skip
  }
}

function openOutboxDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('meetifyy_outbox', 1);
    req.onupgradeneeded = (e) => {
      e.target.result.createObjectStore('outbox', { keyPath: 'id', autoIncrement: true });
    };
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror = () => reject(req.error);
  });
}

// ─── Push Notifications ─────────────────────────────────────────────────────

self.addEventListener('push', (event) => {
  if (!event.data) return;
  try {
    const data = event.data.json();
    event.waitUntil(
      self.registration.showNotification(data.title || 'Meetifyy', {
        body: data.body || '',
        icon: '/logo-192.png',
        badge: '/favicon.png',
        data: { url: data.url || '/' },
        tag: data.tag || 'meetifyy',
        renotify: !!data.tag,
      })
    );
  } catch {
    // Malformed push payload — ignore
  }
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = event.notification.data?.url || '/';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
      const existing = wins.find((w) => w.url.includes(self.location.origin));
      if (existing) return existing.focus().then(() => existing.navigate(target));
      return clients.openWindow(target);
    })
  );
});
