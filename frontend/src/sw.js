import { precacheAndRoute, cleanupOutdatedCaches } from 'workbox-precaching';
import { registerRoute, NavigationRoute } from 'workbox-routing';
import { StaleWhileRevalidate, CacheFirst, NetworkFirst, NetworkOnly } from 'workbox-strategies';
import { ExpirationPlugin } from 'workbox-expiration';
import { CacheableResponsePlugin } from 'workbox-cacheable-response';
import { createHandlerBoundToURL } from 'workbox-precaching';
import { clientsClaim } from 'workbox-core';

// ─── Core Workbox Setup ─────────────────────────────────────────────────────

self.skipWaiting();
clientsClaim();
cleanupOutdatedCaches();

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
  'meetifyy-api-swr',
  'meetifyy-api-network',
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

const navigationHandler = createHandlerBoundToURL('/index.html');
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

// ─── API Caching — Stale While Revalidate ───────────────────────────────────

const SWR_PATHS = [
  '/api/activities',
  '/api/communities',
  '/api/users',
  '/api/posts/feed',
  '/api/posts/community/',
];

registerRoute(
  ({ url }) => SWR_PATHS.some((p) => url.pathname.startsWith(p)),
  new StaleWhileRevalidate({
    cacheName: 'meetifyy-api-swr',
    plugins: [
      new ExpirationPlugin({ maxEntries: 50, maxAgeSeconds: 10 * 60 }),
      new CacheableResponsePlugin({ statuses: [0, 200] }),
    ],
  })
);

// ─── API Caching — Network First (auth, messages, notifications) ────────────

const NETWORK_FIRST_PATHS = [
  '/api/messages',
  '/api/notifications',
  '/api/presence',
];

registerRoute(
  ({ url }) => NETWORK_FIRST_PATHS.some((p) => url.pathname.startsWith(p)),
  new NetworkFirst({
    cacheName: 'meetifyy-api-network',
    plugins: [
      new ExpirationPlugin({ maxEntries: 30, maxAgeSeconds: 5 * 60 }),
      new CacheableResponsePlugin({ statuses: [0, 200] }),
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
