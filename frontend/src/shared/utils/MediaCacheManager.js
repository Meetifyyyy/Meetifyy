import { apiClient, getMediaUrl } from '../api/apiClient';

class MediaCacheManager {
  constructor() {
    this.cache = new Map(); // key -> { url, expiresAt }
    this.pendingRequests = new Map(); // key -> Promise
    this.batchQueue = new Set();
    this.batchTimeout = null;
    this.resolvers = []; // Array of { resolve, reject, keys }
    this.EXPIRY_BUFFER = 60 * 1000; // 1 minute buffer before actual expiry
    this.PERSIST_KEY = 'meetifyy_media_urls_v1';
    this.STABLE_TTL = 7 * 24 * 60 * 60 * 1000; // 7d — safe for immutable public assets
    this._hydrateFromStorage();
  }

  // A signed/expiring URL carries auth query params; a public immutable R2 URL
  // does not. Only stable URLs are worth persisting across reloads.
  _isStableUrl(url) {
    if (!url || typeof url !== 'string') return false;
    if (/[?&](X-Amz-|token=|Signature=|Expires=)/i.test(url)) return false;
    if (url.includes('/object/sign/')) return false;
    return url.startsWith('http://') || url.startsWith('https://');
  }

  _hydrateFromStorage() {
    try {
      if (typeof localStorage === 'undefined') return;
      const raw = localStorage.getItem(this.PERSIST_KEY);
      if (!raw) return;
      const now = Date.now();
      const obj = JSON.parse(raw);
      for (const [key, entry] of Object.entries(obj)) {
        if (entry && entry.expiresAt > now && entry.url) {
          this.cache.set(key, entry);
        }
      }
    } catch (_) { /* ignore corrupt cache */ }
  }

  _persistStable() {
    try {
      if (typeof localStorage === 'undefined') return;
      const out = {};
      for (const [key, entry] of this.cache.entries()) {
        if (entry?.stable) out[key] = entry;
      }
      localStorage.setItem(this.PERSIST_KEY, JSON.stringify(out));
    } catch (_) { /* quota / disabled — non-fatal */ }
  }

  /**
   * Get a signed URL for a given object key.
   * If cached and valid, returns immediately.
   * Otherwise, batches the request with others and fetches them together.
   */
  /**
   * Synchronously return cached URL if available immediately, or key if direct URL.
   */
  getSyncUrl(rawKey) {
    if (!rawKey || typeof rawKey !== 'string') return null;
    let key = rawKey;

    if (key.startsWith('data:') || key.startsWith('blob:')) {
      return key;
    }

    // Full external URL not on our backend — return as-is
    if ((key.startsWith('http://') || key.startsWith('https://')) && !key.includes('/api/media/')) {
      return key;
    }

    // Paths starting with / that are NOT /api/media/ (e.g. local dev assets) return as-is
    if (key.startsWith('/') && !key.includes('/api/media/')) {
      return key;
    }

    if (key.includes('/api/media/')) {
      const match = key.match(/\/api\/media\/(.+)$/);
      if (match) {
        key = match[1].split('?')[0];
      }
    }

    key = key.replace(/^\/+/, '');

    // A storage key is always "<folder>/<filename>". Anything else cannot resolve
    // to an object, and requesting /api/media/<value> for it just produces a 400
    // on every render — which is exactly what happened when a community was saved
    // with its initial letter ("H") in avatarKey. Returning null lets the caller
    // fall back to initials instead of firing a request that cannot succeed.
    if (!/^[a-zA-Z0-9_-]+\/[a-zA-Z0-9._-]+$/.test(key)) {
      return null;
    }

    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > Date.now() + this.EXPIRY_BUFFER) {
      return cached.url;
    }

    // For derived thumbnail variants not yet confirmed in cache, return null so callers use the original full URL
    if (/_thumb\.[a-z0-9]+$/i.test(key)) {
      return null;
    }

    return getMediaUrl(rawKey);
  }

  async getUrl(rawKey) {
    if (!rawKey) return null;
    let key = rawKey;

    // Direct return for data or blob URLs
    if (key.startsWith('data:') || key.startsWith('blob:')) {
      return key;
    }

    // Direct return for external URLs (not pointing to our backend media endpoint)
    if ((key.startsWith('http://') || key.startsWith('https://')) && !key.includes('/api/media/')) {
      return key;
    }

    // Extract object key if it includes /api/media/
    if (key.includes('/api/media/')) {
      const match = key.match(/\/api\/media\/(.+)$/);
      if (match) {
        key = match[1].split('?')[0]; // remove query params if any
      }
    }

    // Clean leading slashes if any
    key = key.replace(/^\/+/, '');

    // Same guard as getMediaUrl: only "<folder>/<filename>" can resolve to a
    // stored object, so anything else is rejected here rather than turned into a
    // request that is certain to 400.
    if (!/^[a-zA-Z0-9_-]+\/[a-zA-Z0-9._-]+$/.test(key)) {
      return null;
    }


    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > Date.now() + this.EXPIRY_BUFFER) {
      return cached.url;
    }

    if (this.pendingRequests.has(key)) {
      return this.pendingRequests.get(key);
    }

    const promise = new Promise((resolve, reject) => {
      this.batchQueue.add(key);
      this.resolvers.push({ resolve, reject, key });
      
      if (!this.batchTimeout) {
        this.batchTimeout = setTimeout(() => this.processBatch(), 50); // 50ms batching window
      }
    });

    this.pendingRequests.set(key, promise);
    return promise;
  }

  async processBatch() {
    const keysToFetch = Array.from(this.batchQueue);
    const resolversToProcess = [...this.resolvers];
    
    this.batchQueue.clear();
    this.resolvers = [];
    this.batchTimeout = null;

    if (keysToFetch.length === 0) return;

    try {
      const expiresIn = 3600; // 1 hour
      // Call backend bulk endpoint
      const response = await apiClient.post('/api/media/signed-urls', {
        keys: keysToFetch,
        expiresIn
      });

      const now = Date.now();
      const expiresAt = now + (expiresIn * 1000);
      let persistedAny = false;

      resolversToProcess.forEach(({ resolve, key }) => {
        const url = response?.[key];
        if (url) {
          // Immutable public URLs get a long TTL and survive reloads; signed URLs
          // keep the short server TTL and stay in memory only.
          const stable = this._isStableUrl(url);
          this.cache.set(key, {
            url,
            expiresAt: stable ? now + this.STABLE_TTL : expiresAt,
            stable,
          });
          if (stable) persistedAny = true;
          resolve(url);
        } else {
          // For derived thumbnail keys with no server URL, resolve to null so callers fallback to full image
          if (/_thumb\.[a-z0-9]+$/i.test(key)) {
            resolve(null);
          } else {
            // Use absolute backend URL so avatars work on Vercel (frontend-only deployments)
            resolve(getMediaUrl(key));
          }
        }
        this.pendingRequests.delete(key);
      });
      if (persistedAny) this._persistStable();
    } catch (error) {
      console.warn('Bulk signed URL fetch fallback triggered:', error?.message || error);
      resolversToProcess.forEach(({ resolve, key }) => {
        if (/_thumb\.[a-z0-9]+$/i.test(key)) {
          resolve(null);
        } else {
          resolve(getMediaUrl(key));
        }
        this.pendingRequests.delete(key);
      });
    }
  }

  /**
   * Invalidate a cached URL (e.g., if it fails to load, meaning it expired early).
   */
  invalidate(key) {
    if (key) {
      // If full url is passed, extract key
      let cleanKey = key;
      const match = cleanKey.match(/\/api\/media\/(.+)$/);
      if (match) {
        cleanKey = match[1].split('?')[0];
      }
      // Also check if it's a full supabase URL to extract key
      if (cleanKey.includes('/object/sign/')) {
        const parts = cleanKey.split('/object/sign/');
        if (parts.length > 1) {
          cleanKey = parts[1].split('?')[0].split('/').slice(1).join('/'); // remove bucket name
        }
      }
      // Also check if it's an R2 public URL
      if (cleanKey.includes('.r2.dev/')) {
        const parts = cleanKey.split('.r2.dev/');
        if (parts.length > 1) {
          cleanKey = parts[1].split('?')[0];
        }
      }
      cleanKey = cleanKey.replace(/^\/+/, '');

      this.cache.delete(cleanKey);
      this.cache.delete(key);
      this.pendingRequests.delete(cleanKey);
      this.pendingRequests.delete(key);
      this._persistStable();
    }
  }

  clear() {
    this.cache.clear();
    this.pendingRequests.clear();
  }
}

export const mediaCache = new MediaCacheManager();
