/**
 * Meetifyy Service Worker
 * 
 * Caching strategies:
 *   Static assets (JS/CSS/fonts/icons) → Cache First with expiration
 *   Images (avatars, covers, media)    → Cache First with expiration
 *   Feed / community / activity API    → Stale While Revalidate
 *   Auth / messages / presence API     → Network First with Cache Fallback
 *   Mutations (POST/PUT/PATCH/DELETE)  → Network Only (never cache)
 * 
 * Background Sync:
 *   Queued outbox for like / bookmark actions when offline.
 * 
 * Offline:
 *   Falls back to /offline.html for navigation requests that fail.
 */

const CACHE_VERSION = 'v3';
const STATIC_CACHE   = `meetifyy-static-${CACHE_VERSION}`;
const IMAGE_CACHE    = `meetifyy-images-${CACHE_VERSION}`;
const API_CACHE      = `meetifyy-api-${CACHE_VERSION}`;

// Static assets to pre-cache on install
const PRECACHE_URLS = [
  '/',
  '/offline.html',
];

// API path prefixes for each strategy
const SWR_PATHS = [
  '/api/activities',
  '/api/communities',
  '/api/users',
  '/api/posts/feed',
  '/api/posts/community/',
];

const NETWORK_FIRST_PATHS = [
  '/api/messages',
  '/api/notifications',
  '/api/presence',
  '/api/auth',
];

const IMAGE_ORIGINS = self.location.origin;

// Max entries and TTLs
const IMAGE_MAX_AGE_MS    = 7  * 24 * 60 * 60 * 1000; // 7 days
const STATIC_MAX_AGE_MS   = 30 * 24 * 60 * 60 * 1000; // 30 days
const API_SWR_MAX_AGE_MS  = 10 * 60 * 1000;            // 10 min
const IMAGE_MAX_ENTRIES   = 200;

// ─── Install ────────────────────────────────────────────────────────────────

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => cache.addAll(PRECACHE_URLS)).then(() => self.skipWaiting())
  );
});

// ─── Activate ───────────────────────────────────────────────────────────────

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k.startsWith('meetifyy-') && ![STATIC_CACHE, IMAGE_CACHE, API_CACHE].includes(k))
          .map((k) => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// ─── Fetch ──────────────────────────────────────────────────────────────────

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Never intercept non-GET mutations or cross-origin requests (except images from CDN)
  if (request.method !== 'GET') return;

  // Skip Supabase auth / Realtime / Storage websocket upgrades
  if (url.hostname.includes('supabase') && url.pathname.includes('/realtime')) return;
  if (request.headers.get('upgrade') === 'websocket') return;

  const path = url.pathname;

  // 1. Image caching — Cache First with TTL eviction
  if (isImageRequest(request)) {
    event.respondWith(cacheFirstWithExpiry(request, IMAGE_CACHE, IMAGE_MAX_AGE_MS, IMAGE_MAX_ENTRIES));
    return;
  }

  // 2. Static assets — Cache First
  if (isStaticAsset(path)) {
    event.respondWith(cacheFirstWithExpiry(request, STATIC_CACHE, STATIC_MAX_AGE_MS));
    return;
  }

  // 3. SWR API routes — Stale While Revalidate (serve cache instantly, update in background)
  if (SWR_PATHS.some((p) => path.startsWith(p))) {
    event.respondWith(staleWhileRevalidate(request, API_CACHE, API_SWR_MAX_AGE_MS));
    return;
  }

  // 4. Network First with cache fallback — auth, messages, notifications
  if (NETWORK_FIRST_PATHS.some((p) => path.startsWith(p))) {
    event.respondWith(networkFirstWithFallback(request, API_CACHE));
    return;
  }

  // 5. Navigation (HTML pages) — Network First with offline fallback
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() => caches.match('/offline.html'))
    );
    return;
  }
});

// ─── Strategy Implementations ───────────────────────────────────────────────

async function cacheFirstWithExpiry(request, cacheName, maxAgeMs, maxEntries) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);

  if (cached) {
    const dateHeader = cached.headers.get('sw-cached-at');
    const age = dateHeader ? Date.now() - parseInt(dateHeader, 10) : 0;
    if (age < maxAgeMs) return cached;
    // Stale — delete and fall through to network
    cache.delete(request);
  }

  try {
    const response = await fetch(request);
    if (response.ok) {
      const clone = addCacheTimestamp(response.clone());
      cache.put(request, clone);
      if (maxEntries) trimCache(cache, maxEntries);
    }
    return response;
  } catch {
    return cached || new Response('Offline', { status: 503 });
  }
}

async function staleWhileRevalidate(request, cacheName, maxAgeMs) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);

  const networkPromise = fetch(request).then((response) => {
    if (response.ok) {
      const clone = addCacheTimestamp(response.clone());
      cache.put(request, clone);
    }
    return response;
  }).catch(() => null);

  if (cached) {
    const dateHeader = cached.headers.get('sw-cached-at');
    const age = dateHeader ? Date.now() - parseInt(dateHeader, 10) : 0;
    // Serve stale immediately; network promise updates cache in background
    if (age < maxAgeMs * 3) return cached;
  }

  // No cache or too stale — wait for network
  return networkPromise || new Response('Offline', { status: 503 });
}

async function networkFirstWithFallback(request, cacheName) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, addCacheTimestamp(response.clone()));
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    return cached || new Response('Offline', { status: 503 });
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function addCacheTimestamp(response) {
  const headers = new Headers(response.headers);
  headers.set('sw-cached-at', String(Date.now()));
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

async function trimCache(cache, maxEntries) {
  const keys = await cache.keys();
  if (keys.length > maxEntries) {
    await Promise.all(keys.slice(0, keys.length - maxEntries).map((k) => cache.delete(k)));
  }
}

function isImageRequest(request) {
  const accept = request.headers.get('accept') || '';
  if (accept.includes('image')) return true;
  const url = new URL(request.url);
  return /\.(png|jpe?g|webp|gif|svg|avif|ico)$/i.test(url.pathname);
}

function isStaticAsset(path) {
  return /\.(js|css|woff2?|ttf|otf|eot)$/i.test(path) || path.startsWith('/assets/');
}

// ─── Background Sync ─────────────────────────────────────────────────────────

self.addEventListener('sync', (event) => {
  if (event.tag === 'meetifyy-outbox') {
    event.waitUntil(flushOutbox());
  }
});

async function flushOutbox() {
  // Outbox is written by the frontend to IndexedDB under key 'sw_outbox'
  // Each entry: { url, method, body, headers }
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

// ─── Push Notifications ──────────────────────────────────────────────────────

self.addEventListener('push', (event) => {
  if (!event.data) return;
  try {
    const data = event.data.json();
    event.waitUntil(
      self.registration.showNotification(data.title || 'Meetifyy', {
        body: data.body || '',
        icon: '/icons/icon-192.png',
        badge: '/icons/badge-72.png',
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
