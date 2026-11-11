/**
 * The pictures of the Home posts the app keeps for offline (feedSnapshot.js):
 * author avatars, post images and video thumbnails, exactly as they were drawn
 * when the post was viewed. Never the videos themselves: a video's thumbnail
 * and its details are kept, the file is not downloaded.
 *
 * Bytes live in Cache Storage under a `meetifyy-images…` name, so the sign-out
 * teardown (AuthContext) and "Clear cached data" (shared/lib/clearCachedData)
 * already delete them with the rest of the account's images. Only URLs still
 * used by a kept post stay: everything else is dropped on each update, so the
 * store never grows past what 15 posts showed.
 *
 * Offline, `resolve(url)` hands back a blob: URL of the stored copy, prepared
 * when the device goes offline (and at a launch that starts offline), so the
 * swap is synchronous at render time.
 */
import { isOnline, subscribeOnline } from '@shared/lib/networkStatus';
import { getAccessToken, getBackendUrl, getNativeSessionId } from '@shared/api/apiClient';

const CACHE_NAME = 'meetifyy-images-feed-v1';
/** A picture is a few hundred KB at most; anything far larger is not one. */
const MAX_BYTES = 4 * 1024 * 1024;

const hasCaches = () => typeof caches !== 'undefined';

/** URL -> blob: URL of the stored copy, filled only while offline. */
const offlineUrls = new Map();
/** The same copies by URL path (see resolveOfflineMedia). */
const offlinePaths = new Map();

/** Stored URLs worth swapping for: http(s) pictures only. */
export function isStorableUrl(url) {
  return typeof url === 'string' && /^https?:\/\//.test(url) && !/\.(mp4|webm|mov|m4v)(\?|#|$)/i.test(url);
}

/**
 * GROUPS. Besides Home's viewed posts, any part of a screen marked
 * `data-offline-keep="<group>"` (the Home communities box, the joined
 * communities, the own profile, the Campus page, the conversation list and the
 * kept chats) has the pictures it actually loads recorded under that group,
 * newest first, up to the group's limit. The store holds the union of all
 * groups and nothing else.
 */
export const MEDIA_GROUPS_KEY = 'meetifyy_offline_media_v1';
const GROUP_LIMITS = {
  communities: 120,
  profile: 12,
  campus: 120,
  conversations: 40,
  chats: 200,
};
const DEFAULT_GROUP_LIMIT = 40;

function readGroups() {
  try {
    const g = JSON.parse(localStorage.getItem(MEDIA_GROUPS_KEY) || '{}');
    return g && typeof g === 'object' ? g : {};
  } catch {
    return {};
  }
}

function writeGroups(groups) {
  try { localStorage.setItem(MEDIA_GROUPS_KEY, JSON.stringify(groups)); } catch { /* quota */ }
}

let syncTimer = 0;
/** Stores the union of every group, at idle time, at most once per few seconds. */
function scheduleSync() {
  if (syncTimer) return;
  syncTimer = setTimeout(() => {
    syncTimer = 0;
    const groups = readGroups();
    void keepAll(new Set(Object.values(groups).flat()));
  }, 3000);
}

/** Replaces one group's URLs (Home's viewed posts: an exact set). */
export function keepMediaGroup(group, urls) {
  const groups = readGroups();
  groups[group] = [...new Set([...urls].filter(isStorableUrl))];
  writeGroups(groups);
  scheduleSync();
}

/** Adds one picture to a group, newest first, within the group's limit. */
function noteMedia(group, url) {
  if (!isStorableUrl(url) || !group) return;
  const groups = readGroups();
  const list = (groups[group] || []).filter((u) => u !== url);
  list.unshift(url);
  groups[group] = list.slice(0, GROUP_LIMITS[group] ?? DEFAULT_GROUP_LIMIT);
  writeGroups(groups);
  scheduleSync();
}

/** Home's viewed posts (feedSnapshot.js). */
export function keepFeedMedia(urls) {
  keepMediaGroup('feed', urls);
}

/**
 * Keeps exactly `urls`: stores the ones not stored yet, deletes the rest.
 * Never throws.
 */
async function keepAll(urls) {
  if (!hasCaches()) return;
  try {
    const wanted = new Set([...urls].filter(isStorableUrl));
    const cache = await caches.open(CACHE_NAME);
    const stored = new Set((await cache.keys()).map((req) => req.url));
    await Promise.all([...stored].filter((u) => !wanted.has(u)).map((u) => cache.delete(u)));
    if (!isOnline()) return;
    for (const url of wanted) {
      if (stored.has(url)) continue;
      // Stored from a local copy when it drew; there is nothing to download.
      if (url.startsWith(LOCAL_COPY_ORIGIN)) continue;
      try {
        // The API's own media URLs (`/api/media/…`) answer only the signed-in
        // app: they carry its bearer token and session id, as the transport
        // sends them. Public hosts (R2, DiceBear) get a plain request.
        const res = await fetch(url, { mode: 'cors', credentials: 'omit', headers: authHeadersFor(url) });
        if (!res.ok) continue;
        const type = res.headers.get('content-type') || '';
        if (type && !type.startsWith('image/')) continue; // a video, or an error page
        const length = Number(res.headers.get('content-length') || 0);
        if (length > MAX_BYTES) continue;
        await cache.put(url, res);
      } catch {
        // Unreachable right now: tried again on the next update.
      }
    }
  } catch {
    // Storage full or unavailable: the posts still show, their pictures load
    // from the network as usual.
  }
}

/** Bearer and session headers for a URL on the API's own origin, else none. */
function authHeadersFor(url) {
  try {
    const target = new URL(url);
    const api = new URL(getBackendUrl());
    if (target.origin !== api.origin) return undefined;
    const token = getAccessToken();
    const sessionId = getNativeSessionId();
    const headers = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    if (sessionId) headers['x-session-id'] = sessionId;
    return headers;
  } catch {
    return undefined;
  }
}

/** Stand-in URL for a picture stored by media key rather than by address. */
const LOCAL_COPY_ORIGIN = 'https://offline-copy.meetifyy.invalid/';

async function storeLocalCopy(group, blobUrl, key) {
  if (!hasCaches()) return;
  try {
    const url = LOCAL_COPY_ORIGIN + String(key).replace(/^\/+/, '');
    const res = await fetch(blobUrl);
    const blob = await res.blob();
    if (!blob.type.startsWith('image/') || blob.size > MAX_BYTES) return;
    const cache = await caches.open(CACHE_NAME);
    await cache.put(url, new Response(blob, { headers: { 'content-type': blob.type } }));
    noteMedia(group, url);
  } catch {
    // The preview is gone already: it is stored the next time it draws.
  }
}

/** Builds the offline lookup from what is stored. */
async function prepareOffline() {
  if (!hasCaches()) return;
  try {
    const cache = await caches.open(CACHE_NAME);
    for (const req of await cache.keys()) {
      if (offlineUrls.has(req.url)) continue;
      const res = await cache.match(req);
      if (!res) continue;
      const blobUrl = URL.createObjectURL(await res.blob());
      offlineUrls.set(req.url, blobUrl);
      offlinePaths.set(pathOf(req.url), blobUrl);
    }
  } catch {
    // Nothing to swap: pictures show their own placeholders.
  }
}


/** A URL's path without its query: a signed URL's signature changes each time. */
const pathOf = (url) => {
  try { return new URL(url).pathname.replace(/^\/+/, ''); } catch { return String(url).replace(/^\/+/, ''); }
};

/**
 * The stored copy of `url` while offline, else null (load `url` itself).
 * Matched exactly, then by path (a chat photo is re-signed with a new query
 * each time), then as a raw media key (offline, nothing gets signed at all).
 */
export function resolveOfflineMedia(url) {
  if (!offlineUrls.size || isOnline()) return null;
  return offlineUrls.get(url) || offlinePaths.get(pathOf(url)) || null;
}

/** Follows connectivity: ready the copies when offline, free them online. */
export function installOfflineFeedMedia() {
  // Every picture that loads inside a marked region is recorded for its group
  // (load events do not bubble; captured at the document).
  document.addEventListener('load', (e) => {
    const img = e.target;
    if (!(img instanceof HTMLImageElement) || !isOnline()) return;
    const region = img.closest('[data-offline-keep]');
    if (!region) return;
    const group = region.getAttribute('data-offline-keep');
    const src = img.currentSrc || img.src;
    // A picture drawn from a local copy (a photo you just sent shows its own
    // preview): stored now, from that copy, under its media key, which is
    // what the offline lookup matches (resolveOfflineMedia).
    const key = img.getAttribute('data-offline-key');
    if (src.startsWith('blob:') && key) {
      void storeLocalCopy(group, src, key);
      return;
    }
    noteMedia(group, src);
  }, true);
  if (!isOnline()) void prepareOffline();
  // Back online the copies are not released: a picture still showing one
  // (most screens do not redraw on reconnect) would turn into a broken image.
  // `resolveOfflineMedia` simply stops handing them out while online; they
  // are refreshed from the store the next time the device goes offline.
  subscribeOnline((online) => {
    if (!online) void prepareOffline();
  });
}
