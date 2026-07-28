import { apiClient } from '../api/apiClient';

class MediaCacheManager {
  constructor() {
    this.cache = new Map(); // key -> { url, expiresAt }
    this.pendingRequests = new Map(); // key -> Promise
    this.batchQueue = new Set();
    this.batchTimeout = null;
    this.resolvers = []; // Array of { resolve, reject, keys }
    this.EXPIRY_BUFFER = 60 * 1000; // 1 minute buffer before actual expiry
  }

  /**
   * Get a signed URL for a given object key.
   * If cached and valid, returns immediately.
   * Otherwise, batches the request with others and fetches them together.
   */
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

      resolversToProcess.forEach(({ resolve, key }) => {
        const url = response?.[key];
        if (url) {
          this.cache.set(key, { url, expiresAt });
          resolve(url);
        } else {
          resolve(`/api/media/${key}`); // Graceful fallback
        }
        this.pendingRequests.delete(key);
      });
    } catch (error) {
      console.warn('Bulk signed URL fetch fallback triggered:', error?.message || error);
      resolversToProcess.forEach(({ resolve, key }) => {
        const fallbackUrl = `/api/media/${key}`;
        resolve(fallbackUrl);
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
      const match = key.match(/\/api\/media\/(.+)$/);
      if (match) {
        key = match[1].split('?')[0];
      }
      // Also check if it's a full supabase URL to extract key
      if (key.includes('/object/sign/')) {
        const parts = key.split('/object/sign/');
        if (parts.length > 1) {
          key = parts[1].split('?')[0].split('/').slice(1).join('/'); // remove bucket name
        }
      }
      this.cache.delete(key);
      this.pendingRequests.delete(key);
    }
  }

  clear() {
    this.cache.clear();
    this.pendingRequests.clear();
  }
}

export const mediaCache = new MediaCacheManager();
