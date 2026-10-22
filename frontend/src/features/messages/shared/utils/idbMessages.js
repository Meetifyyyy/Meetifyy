import { compareMessages } from './cacheUtils';
import { idbEpoch, bumpIdbEpoch } from '@shared/lib/idb';

/**
 * IndexedDB wrapper for message caching.
 */

const DB_NAME = 'meetifyy_messages';
const DB_VERSION = 1;

const STORES = {
  MESSAGES: 'messages',
  SYNC_META: 'sync_metadata',
};

let _db = null;

/**
 * The clear generation, shared with the other local caches.
 *
 * The chat paths that mirror messages to disk write AFTER a network await (a
 * history page, an upload, a send ACK), and signing out does not abort a
 * request already in flight. Without a generation check, account A's page
 * landing a moment after A's logout cleared the store wrote A's DMs back.
 *
 * Shared with `shared/lib/idb.js` rather than kept here: sign-out reaches this
 * module through a lazy import, so a counter of its own was bumped only once
 * that import resolved, leaving a gap. `idbClearAll()` bumps the shared one
 * synchronously, the moment sign-out starts.
 *
 * A caller captures `idbMessagesEpoch()` BEFORE it starts the request and hands
 * it to the write, which is dropped if a clear happened in between. Reads check
 * on their own, so a hydration in flight during a clear returns nothing.
 */
export const idbMessagesEpoch = idbEpoch;

const isStale = (epoch) => epoch !== undefined && epoch !== idbEpoch();

/** Resolves when the transaction has committed, rejects if it failed or aborted. */
function committed(tx) {
  return new Promise((res, rej) => {
    tx.oncomplete = res;
    tx.onerror = () => rej(tx.error);
    tx.onabort = () => rej(tx.error);
  });
}

function openMessagesDB() {
  if (_db) return Promise.resolve(_db);
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORES.MESSAGES)) {
        const store = db.createObjectStore(STORES.MESSAGES, { keyPath: 'id' });
        // Indexed for quick conversation loading and sorting
        store.createIndex('conversationId', 'conversationId', { unique: false });
        store.createIndex('createdAt', 'createdAt', { unique: false });
        store.createIndex('conv_created', ['conversationId', 'createdAt'], { unique: false });
      }
      if (!db.objectStoreNames.contains(STORES.SYNC_META)) {
        db.createObjectStore(STORES.SYNC_META, { keyPath: 'conversationId' });
      }
    };
    request.onsuccess = (e) => {
      _db = e.target.result;
      resolve(_db);
    };
    request.onerror = () => reject(request.error);
  });
}

export async function migrateHistoricalFailedMessages() {
  try {
    const db = await openMessagesDB();
    const tx = db.transaction([STORES.MESSAGES], 'readwrite');
    const store = tx.objectStore(STORES.MESSAGES);
    const getAllReq = store.getAll();
    getAllReq.onsuccess = () => {
      const items = getAllReq.result || [];
      const now = Date.now();
      for (const item of items) {
        if (!item) continue;
        const isFailed = item.status === 'failed' || item.status === 'FAILED' || item.isFailed || item.deliveryStatus === 'failed';
        const sendTime = new Date(item.createdAt || item.storedAt || item.sendingAt || now).getTime();
        const isStaleSending = item.status === 'sending' && !isNaN(sendTime) && (now - sendTime > 5000);
        const hasBlobUrl = (typeof item.mediaUrl === 'string' && item.mediaUrl.startsWith('blob:')) ||
          (item.payload && typeof item.payload.mediaUrl === 'string' && item.payload.mediaUrl.startsWith('blob:'));

        if (isFailed || isStaleSending || hasBlobUrl) {
          const updated = {
            ...item,
            status: (isFailed || isStaleSending) ? 'failed' : item.status,
            isFailed: false,
            deliveryStatus: (isFailed || isStaleSending) ? 'failed' : item.deliveryStatus,
            retryCount: 0,
            pendingRetry: false,
          };
          if (typeof updated.mediaUrl === 'string' && updated.mediaUrl.startsWith('blob:')) {
            updated.mediaUrl = null;
          }
          if (updated.payload) {
            updated.payload = { ...updated.payload };
            if (typeof updated.payload.mediaUrl === 'string' && updated.payload.mediaUrl.startsWith('blob:')) {
              updated.payload.mediaUrl = null;
            }
            if (typeof updated.payload.thumbnailUrl === 'string' && updated.payload.thumbnailUrl.startsWith('blob:')) {
              updated.payload.thumbnailUrl = null;
            }
            if (typeof updated.payload.localPreviewUrl === 'string' && updated.payload.localPreviewUrl.startsWith('blob:')) {
              updated.payload.localPreviewUrl = null;
            }
          }
          delete updated.retryAt;
          delete updated.nextRetry;
          store.put(updated);
        }
      }
    };
  } catch (e) {
    console.warn('Historical failed messages migration error:', e);
  }
}

/**
 * Strips decrypted fields and transient blob URLs before storing.
 */
function sanitizeMessageForStorage(msg) {
  const safeMsg = { ...msg };
  const isExplicitUnsent = safeMsg.state === 'UNSENT' || safeMsg.isUnsent === true || safeMsg.text === 'This message was unsent';
  const isResetting = safeMsg.status === 'sending' || safeMsg.state === 'SENT' || (typeof safeMsg.text === 'string' && safeMsg.text !== 'This message was unsent' && safeMsg.text !== '');

  const isUnsent = isExplicitUnsent && !isResetting;

  if (isUnsent) {
    safeMsg.state = 'UNSENT';
    safeMsg.isUnsent = true;
    safeMsg.text = 'This message was unsent';
    safeMsg.payload = { text: 'This message was unsent' };
    safeMsg.mediaUrl = null;
    safeMsg.mediaType = null;
    safeMsg.inviteData = null;
    safeMsg.replyTo = null;
    return safeMsg;
  } else if (isResetting && (safeMsg.state === 'UNSENT' || safeMsg.isUnsent)) {
    safeMsg.state = 'SENT';
    safeMsg.isUnsent = false;
  }

  // Strip transient blob: URLs before storing to disk (blob URLs expire when window/session closes)
  if (typeof safeMsg.mediaUrl === 'string' && safeMsg.mediaUrl.startsWith('blob:')) {
    safeMsg.mediaUrl = null;
  }
  if (safeMsg.payload) {
    safeMsg.payload = { ...safeMsg.payload };
    if (typeof safeMsg.payload.mediaUrl === 'string' && safeMsg.payload.mediaUrl.startsWith('blob:')) {
      safeMsg.payload.mediaUrl = null;
    }
    if (typeof safeMsg.payload.thumbnailUrl === 'string' && safeMsg.payload.thumbnailUrl.startsWith('blob:')) {
      safeMsg.payload.thumbnailUrl = null;
    }
    if (typeof safeMsg.payload.localPreviewUrl === 'string' && safeMsg.payload.localPreviewUrl.startsWith('blob:')) {
      safeMsg.payload.localPreviewUrl = null;
    }
  }
  if (Array.isArray(safeMsg.media)) {
    safeMsg.media = safeMsg.media.map((m) => {
      if (typeof m === 'string' && m.startsWith('blob:')) return null;
      if (m && typeof m === 'object' && typeof m.url === 'string' && m.url.startsWith('blob:')) {
        return { ...m, url: null };
      }
      return m;
    }).filter(Boolean);
  }

  return safeMsg;
}

/**
 * Bulk save/update messages for a conversation.
 * Expected to receive raw or lightly mutated messages.
 * @param {number} [epoch] - `idbMessagesEpoch()` captured before the request
 *   these messages came from. The write is dropped if the cache was cleared since.
 */
export async function idbSaveMessages(conversationId, messages, epoch) {
  if (!messages || !messages.length) return;
  if (isStale(epoch)) return;
  try {
    const db = await openMessagesDB();
    // Re-checked after the open: it is the only await before the write.
    if (isStale(epoch)) return;
    const tx = db.transaction(STORES.MESSAGES, 'readwrite');
    const store = tx.objectStore(STORES.MESSAGES);
    
    for (const msg of messages) {
      // Use tempId if real id doesn't exist (optimistic UI)
      const id = msg.id || msg.tempId;
      if (!id) continue;

      const tempKey = msg.clientId || msg.tempId;
      if (tempKey && tempKey !== id) {
        try {
          store.delete(tempKey);
        } catch (_) {}
      }
      
      const safeMsg = sanitizeMessageForStorage({
        ...msg,
        id,
        conversationId, // force uniform structure
        storedAt: Date.now(),
      });
      store.put(safeMsg);
    }
    
    await committed(tx);
  } catch (err) {
    console.warn('IDB Save failed:', err);
  }
}

/**
 * Retrieve messages for a conversation (accepts single ID or candidate aliases array),
 * sorted strictly by compareMessages ascending.
 */
export async function idbGetMessages(conversationId) {
  const epoch = idbEpoch();
  try {
    const db = await openMessagesDB();
    const tx = db.transaction(STORES.MESSAGES, 'readonly');
    const store = tx.objectStore(STORES.MESSAGES);
    const index = store.index('conversationId');
    
    const candidateIds = Array.isArray(conversationId)
      ? conversationId.filter(Boolean)
      : [conversationId].filter(Boolean);

    const fetches = candidateIds.map(cid => {
      return new Promise((res) => {
        const request = index.getAll(IDBKeyRange.only(cid));
        request.onsuccess = () => res(request.result || []);
        request.onerror = () => res([]);
      });
    });

    const resultsArray = await Promise.all(fetches);
    // Cleared while the read was in flight: whatever came back belongs to the
    // account that just signed out.
    if (epoch !== idbEpoch()) return [];
    const combined = resultsArray.flat();

    // Deduplicate by permanent message ID or client/temp ID
    const seen = new Set();
    const deduped = [];
    for (const msg of combined) {
      if (!msg) continue;
      const key = msg.id || msg.clientId || msg.tempId;
      if (key && !seen.has(key)) {
        seen.add(key);
        deduped.push(msg);
      }
    }

    // Sanitize and reconcile unsent, dead blob: URLs & historical failed states for messages stored in IDB
    const sanitized = deduped.map((msg) => {
      let cleanMsg = { ...msg };

      // Strip dead blob: URLs that cannot be loaded across sessions
      if (typeof cleanMsg.mediaUrl === 'string' && cleanMsg.mediaUrl.startsWith('blob:')) {
        cleanMsg.mediaUrl = null;
      }
      if (cleanMsg.payload) {
        cleanMsg.payload = { ...cleanMsg.payload };
        if (typeof cleanMsg.payload.mediaUrl === 'string' && cleanMsg.payload.mediaUrl.startsWith('blob:')) {
          cleanMsg.payload.mediaUrl = null;
        }
        if (typeof cleanMsg.payload.thumbnailUrl === 'string' && cleanMsg.payload.thumbnailUrl.startsWith('blob:')) {
          cleanMsg.payload.thumbnailUrl = null;
        }
        if (typeof cleanMsg.payload.localPreviewUrl === 'string' && cleanMsg.payload.localPreviewUrl.startsWith('blob:')) {
          cleanMsg.payload.localPreviewUrl = null;
        }
      }
      if (Array.isArray(cleanMsg.media)) {
        cleanMsg.media = cleanMsg.media.map((m) => {
          if (typeof m === 'string' && m.startsWith('blob:')) return null;
          if (m && typeof m === 'object' && typeof m.url === 'string' && m.url.startsWith('blob:')) {
            return { ...m, url: null };
          }
          return m;
        }).filter(Boolean);
      }

      const isUnsent = cleanMsg.state === 'UNSENT' || cleanMsg.isUnsent || cleanMsg.text === 'This message was unsent' || cleanMsg.payload?.text === 'This message was unsent';
      if (isUnsent) {
        return {
          ...cleanMsg,
          state: 'UNSENT',
          isUnsent: true,
          text: 'This message was unsent',
          payload: { text: 'This message was unsent' },
          mediaUrl: null,
          mediaType: null,
          inviteData: null,
          replyTo: null,
        };
      }

      // Reconcile all historical and active failed/stale-sending messages to normalized status: 'failed'
      const isTempMsg = !cleanMsg.id || String(cleanMsg.id).startsWith('temp_') || String(cleanMsg.id).startsWith('c_temp_');
      const isFailedState = cleanMsg.status === 'failed' || cleanMsg.status === 'FAILED' || cleanMsg.isFailed || cleanMsg.deliveryStatus === 'failed';
      const sendTime = new Date(cleanMsg.createdAt || cleanMsg.storedAt || cleanMsg.sendingAt || Date.now()).getTime();
      const isStaleSending = isTempMsg && cleanMsg.status === 'sending' && !isNaN(sendTime) && (Date.now() - sendTime > 5000);

      if (isFailedState || isStaleSending) {
        cleanMsg = {
          ...cleanMsg,
          status: 'failed',
          isFailed: false,
          deliveryStatus: 'failed',
          retryCount: 0,
        };
        delete cleanMsg.retryAt;
        delete cleanMsg.nextRetry;
        return cleanMsg;
      }

      return cleanMsg;
    });

    // Deterministic sort using unified compareMessages
    return sanitized.sort(compareMessages);
  } catch (err) {
    console.warn('IDB Get failed:', err);
    return [];
  }
}

/**
 * Update sync metadata (e.g., nextCursor, lastSyncedAt)
 */
export async function idbSaveSyncMeta(conversationId, meta, epoch) {
  if (isStale(epoch)) return;
  try {
    const db = await openMessagesDB();
    if (isStale(epoch)) return;
    const tx = db.transaction(STORES.SYNC_META, 'readwrite');
    tx.objectStore(STORES.SYNC_META).put({
      conversationId,
      ...meta,
      updatedAt: Date.now(),
    });
    await committed(tx);
  } catch (err) {
    console.warn('IDB SyncMeta Save failed:', err);
  }
}

export async function idbGetSyncMeta(conversationId) {
  const epoch = idbEpoch();
  try {
    const db = await openMessagesDB();
    const tx = db.transaction(STORES.SYNC_META, 'readonly');
    const request = tx.objectStore(STORES.SYNC_META).get(conversationId);
    const meta = await new Promise((res, rej) => {
      request.onsuccess = () => res(request.result);
      request.onerror = () => rej(request.error);
    });
    return epoch !== idbEpoch() ? null : meta;
  } catch (err) {
    return null;
  }
}

/**
 * Drop every persisted message for one conversation (all of its id aliases).
 *
 * Deleting a conversation is per-user and permanent for that user, so the
 * offline mirror has to go with it — otherwise the next visit rehydrates the
 * very history that was just deleted.
 */
export async function idbDeleteConversationMessages(conversationId) {
  const candidateIds = (Array.isArray(conversationId) ? conversationId : [conversationId]).filter(Boolean);
  if (candidateIds.length === 0) return;
  try {
    const db = await openMessagesDB();
    const tx = db.transaction([STORES.MESSAGES, STORES.SYNC_META], 'readwrite');
    const store = tx.objectStore(STORES.MESSAGES);
    const index = store.index('conversationId');

    await Promise.all(candidateIds.map((cid) => new Promise((resolve) => {
      const request = index.openKeyCursor(IDBKeyRange.only(cid));
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return resolve();
        store.delete(cursor.primaryKey);
        cursor.continue();
      };
      request.onerror = () => resolve();
    })));

    const meta = tx.objectStore(STORES.SYNC_META);
    candidateIds.forEach((cid) => meta.delete(cid));
    await committed(tx);
  } catch {
    // silent
  }
}

/**
 * Clear cache entirely (e.g. on logout)
 */
export async function idbClearMessages() {
  // First, so a write or read already in flight is refused before the clear lands.
  bumpIdbEpoch();
  try {
    const db = await openMessagesDB();
    const tx = db.transaction([STORES.MESSAGES, STORES.SYNC_META], 'readwrite');
    tx.objectStore(STORES.MESSAGES).clear();
    tx.objectStore(STORES.SYNC_META).clear();
    await committed(tx);
  } catch {
    // silent
  }
}

/**
 * LRU Cache Trimming - keep only the latest 5000 messages total across all chats.
 * Can be expanded to trim by conversation.
 */
export async function trimMessageCache(maxMessages = 5000) {
  try {
    const db = await openMessagesDB();
    const tx = db.transaction(STORES.MESSAGES, 'readwrite');
    const store = tx.objectStore(STORES.MESSAGES);
    const index = store.index('createdAt');
    
    const countRequest = store.count();
    const totalCount = await new Promise((res) => {
      countRequest.onsuccess = () => res(countRequest.result);
      countRequest.onerror = () => res(0);
    });

    if (totalCount <= maxMessages) return;

    let toDelete = totalCount - maxMessages;
    const cursorReq = index.openCursor(); // Ascending (oldest first)
    
    cursorReq.onsuccess = (e) => {
      const cursor = e.target.result;
      if (cursor && toDelete > 0) {
        cursor.delete();
        toDelete--;
        cursor.continue();
      }
    };
  } catch (err) {
    console.warn('Cache trim failed', err);
  }
}

/**
 * @param {number} [epoch] - `idbMessagesEpoch()` captured before the request
 *   this patch came from. The patch is dropped if the cache was cleared since.
 */
export async function idbPatchMessage(conversationId, messageId, patch, epoch) {
  if (!messageId && !patch?.id && !patch?.clientId && !patch?.tempId) return;
  if (isStale(epoch)) return;
  try {
    const db = await openMessagesDB();
    if (isStale(epoch)) return;
    const tx = db.transaction(STORES.MESSAGES, 'readwrite');
    const store = tx.objectStore(STORES.MESSAGES);
    
    const keysToSearch = [messageId, patch?.clientId, patch?.tempId, patch?.id].filter(Boolean);
    let existingRecord = null;
    let foundKey = null;

    for (const key of keysToSearch) {
      const rec = await new Promise((res) => {
        const req = store.get(key);
        req.onsuccess = () => res(req.result);
        req.onerror = () => res(null);
      });
      if (rec) {
        existingRecord = rec;
        foundKey = key;
        break;
      }
    }

    const updated = sanitizeMessageForStorage({
      ...(existingRecord || {}),
      ...patch,
      storedAt: Date.now()
    });

    if (foundKey && updated.id && foundKey !== updated.id) {
      store.delete(foundKey);
    }

    if (updated.id) {
      store.put(updated);
    }
    
    await committed(tx);
  } catch (err) {
    console.warn('IDB Patch failed:', err);
  }
}

export async function idbDeleteMessage(messageId) {
  if (!messageId) return;
  try {
    const db = await openMessagesDB();
    const tx = db.transaction(STORES.MESSAGES, 'readwrite');
    const store = tx.objectStore(STORES.MESSAGES);
    store.delete(messageId);
    await committed(tx);
  } catch (err) {
    console.warn('IDB Delete failed:', err);
  }
}
