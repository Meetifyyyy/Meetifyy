import { compareMessages, getMsgTimestamp } from './cacheUtils';
import { idbEpoch, bumpIdbEpoch } from '@shared/lib/idb';

/**
 * IndexedDB wrapper for message caching.
 */

const DB_NAME = 'meetifyy_messages';
// 2 added `outbox`. An upgrade only creates missing stores.
const DB_VERSION = 2;

const STORES = {
  MESSAGES: 'messages',
  SYNC_META: 'sync_metadata',
  // Sends not yet confirmed by the server, keyed by clientId (see outbox.js).
  OUTBOX: 'outbox',
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

/** How long a blocked upgrade is waited for before the open gives up. */
const OPEN_BLOCKED_TIMEOUT_MS = 3000;
let _opening = null;

function openMessagesDB() {
  if (_db) return Promise.resolve(_db);
  if (_opening) return _opening;
  _opening = new Promise((resolve, reject) => {
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
      if (!db.objectStoreNames.contains(STORES.OUTBOX)) {
        db.createObjectStore(STORES.OUTBOX, { keyPath: 'clientId' });
      }
    };
    // An older tab holding the previous version blocks the upgrade: give up
    // after a while so callers see a cache miss rather than hang; the next
    // call retries.
    let blockedTimer = null;
    request.onblocked = () => {
      if (blockedTimer) return;
      blockedTimer = setTimeout(() => reject(new Error('IndexedDB open blocked')), OPEN_BLOCKED_TIMEOUT_MS);
    };
    request.onsuccess = (e) => {
      if (blockedTimer) clearTimeout(blockedTimer);
      const db = e.target.result;
      // A newer tab wants to upgrade: release it and reopen on next use.
      db.onversionchange = () => {
        db.close();
        if (_db === db) _db = null;
      };
      _db = db;
      resolve(db);
    };
    request.onerror = () => {
      if (blockedTimer) clearTimeout(blockedTimer);
      reject(request.error);
    };
  }).finally(() => {
    _opening = null;
  });
  return _opening;
}

let historicalMigrationDone = false;

export async function migrateHistoricalFailedMessages() {
  // Once per page load: it reads every stored message, and used to do so on
  // every chat opened.
  if (historicalMigrationDone) return;
  historicalMigrationDone = true;
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
        // A queued send (in the outbox) is still being delivered, not stale.
        const isStaleSending = item.status === 'sending' && !item.queued && !isNaN(sendTime) && (now - sendTime > 5000);
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
      // A queued send (in the outbox) is still being delivered, not stale.
      const isStaleSending = isTempMsg && cleanMsg.status === 'sending' && !cleanMsg.queued && !isNaN(sendTime) && (Date.now() - sendTime > 5000);

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
    const tx = db.transaction([STORES.MESSAGES, STORES.SYNC_META, STORES.OUTBOX], 'readwrite');
    tx.objectStore(STORES.MESSAGES).clear();
    tx.objectStore(STORES.SYNC_META).clear();
    // Unsent messages too: they would otherwise be sent later as whoever
    // signs in next, which is exactly what the old localStorage queue did.
    tx.objectStore(STORES.OUTBOX).clear();
    await committed(tx);
  } catch {
    // silent
  }
}

// ── Outbox ───────────────────────────────────────────────────────────────────

/**
 * Stores or replaces an outbox entry. Dropped if the cache was cleared since
 * `epoch` was captured, so a send that started as the previous account is
 * never queued under the next one.
 */
export async function idbOutboxPut(entry, epoch) {
  if (isStale(epoch)) return false;
  try {
    const db = await openMessagesDB();
    if (isStale(epoch)) return false;
    const tx = db.transaction(STORES.OUTBOX, 'readwrite');
    tx.objectStore(STORES.OUTBOX).put(entry);
    await committed(tx);
    return true;
  } catch {
    // Full or unavailable storage: the caller must not count on a retry.
    return false;
  }
}

export async function idbOutboxDelete(clientId) {
  if (!clientId) return;
  try {
    const db = await openMessagesDB();
    const tx = db.transaction(STORES.OUTBOX, 'readwrite');
    tx.objectStore(STORES.OUTBOX).delete(clientId);
    await committed(tx);
  } catch {
    // silent
  }
}

/** Every outbox entry belonging to `userId`, oldest first; null if the store could not be read. */
export async function idbOutboxAll(userId) {
  if (!userId) return [];
  const epoch = idbEpoch();
  try {
    const db = await openMessagesDB();
    const tx = db.transaction(STORES.OUTBOX, 'readonly');
    const request = tx.objectStore(STORES.OUTBOX).getAll();
    const all = await new Promise((res, rej) => {
      request.onsuccess = () => res(request.result || []);
      request.onerror = () => rej(request.error);
    });
    if (epoch !== idbEpoch()) return [];
    return all
      .filter((e) => e && e.userId === userId)
      .sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));
  } catch {
    // null, not []: "could not read" must not look like "nothing pending",
    // or ordering and the outbox's retry silently stop for the session.
    return null;
  }
}

// ── Bounding the cache ───────────────────────────────────────────────────────

/** Newest messages kept per conversation: a few screens of history, not all of it. */
export const MAX_MESSAGES_PER_CONVERSATION = 300;
/** Conversations kept; the least recently active are dropped first. */
export const MAX_CACHED_CONVERSATIONS = 60;
/** Ceiling across every conversation, whatever the two limits above allow. */
export const MAX_CACHED_MESSAGES = 5000;
/**
 * A row still 'sending' or 'failed' is kept this long even with no outbox entry
 * (a failed send leaves the outbox after OUTBOX_FAILED_KEEP_MS), so a row
 * stuck in that state cannot pin itself to the cache forever.
 */
const UNCONFIRMED_KEEP_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Whether a cached row stands for a send that is not finished, and so must
 * never be trimmed or cleared: dropping it would lose a message the person
 * wrote and the app has promised to deliver (or let them retry).
 *
 * The outbox is the authority: a row it names, by any of the ids the row has
 * carried (a send is keyed by its clientId, then re-keyed by the server's id).
 * `queued` and a recent 'sending'/'failed' status cover the window before the
 * outbox write lands (a media send uploads first) and a failure that outlived it.
 */
function isUnsentRow(row, outboxIds, now) {
  if (!row) return false;
  if (outboxIds.has(row.id) || outboxIds.has(row.clientId) || outboxIds.has(row.tempId)) return true;
  if (row.queued === true) return true;
  const status = row.status;
  // A message that failed is kept for as long as the user has not dealt with
  // it: deleting it would make "Not delivered" vanish, as if it had been sent.
  // There are few, and they still count toward the per-chat cap.
  if (status === 'failed' || status === 'FAILED') return true;
  // A "sending" row with no outbox entry is stuck, not pending; after a week
  // it may go.
  if (status === 'sending') {
    const at = getMsgTimestamp(row);
    return !at || now - at < UNCONFIRMED_KEEP_MS;
  }
  return false;
}

/** Resolves with `visit` called for every row of a store, in key order. */
function forEachRow(store, visit) {
  return new Promise((resolve) => {
    const request = store.openCursor();
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return resolve();
      visit(cursor.value, cursor.primaryKey);
      cursor.continue();
    };
    request.onerror = () => resolve();
  });
}

/** The ids of every outbox entry, of any account: none of them may be touched. */
async function readOutboxIds(outboxStore) {
  const ids = new Set();
  await forEachRow(outboxStore, (entry, key) => {
    ids.add(key);
    if (entry?.clientId) ids.add(entry.clientId);
  });
  return ids;
}

/**
 * Chooses which rows to delete. Pure: takes slim `{ key, conversationId, at,
 * unsent }` records and returns the keys to remove plus the conversations that
 * ended up with nothing.
 */
function planTrim(rows, { perConversation, maxConversations, maxTotal }) {
  const byConversation = new Map();
  for (const row of rows) {
    const list = byConversation.get(row.conversationId);
    if (list) list.push(row);
    else byConversation.set(row.conversationId, [row]);
  }

  // Newest first inside a conversation; conversations by their newest message.
  const conversations = [...byConversation.entries()].map(([id, list]) => {
    list.sort((a, b) => b.at - a.at);
    return { id, list, lastActive: list[0].at };
  });
  conversations.sort((a, b) => b.lastActive - a.lastActive);

  const remove = new Set();
  const kept = [];
  conversations.forEach(({ list }, rank) => {
    const dropWhole = rank >= maxConversations;
    let n = 0;
    for (const row of list) {
      // Unsent rows count towards the cap but are never removed.
      if (row.unsent) { kept.push(row); n += 1; continue; }
      if (dropWhole || n >= perConversation) remove.add(row.key);
      else { kept.push(row); n += 1; }
    }
  });

  // Whatever the two limits left, held to the overall ceiling: oldest first.
  if (kept.length > maxTotal) {
    const evictable = kept.filter((r) => !r.unsent).sort((a, b) => a.at - b.at);
    evictable.slice(0, Math.min(evictable.length, kept.length - maxTotal)).forEach((r) => remove.add(r.key));
  }

  const emptied = conversations
    .filter(({ list }) => list.every((r) => remove.has(r.key)))
    .map(({ id }) => id);
  return { remove, emptied };
}

/**
 * Bounds the message cache: the newest `perConversation` messages of each
 * conversation, at most `maxConversations` conversations (the least recently
 * active go first), at most `maxTotal` messages overall. Run once at startup
 * from the storage maintenance pass, not when a chat opens.
 *
 * Rows that are still unsent (see `isUnsentRow`) are never removed, nor is the
 * outbox touched. It is all one transaction, so the outbox it consults cannot
 * change between the read and the delete, and a sign-out that lands meanwhile
 * (a new epoch) makes it stand down. Returns how many messages were removed.
 */
export async function trimMessageCache({
  perConversation = MAX_MESSAGES_PER_CONVERSATION,
  maxConversations = MAX_CACHED_CONVERSATIONS,
  maxTotal = MAX_CACHED_MESSAGES,
} = {}) {
  const epoch = idbEpoch();
  try {
    const db = await openMessagesDB();
    if (isStale(epoch)) return 0;
    const tx = db.transaction([STORES.MESSAGES, STORES.SYNC_META, STORES.OUTBOX], 'readwrite');
    const messages = tx.objectStore(STORES.MESSAGES);
    const now = Date.now();

    const outboxIds = await readOutboxIds(tx.objectStore(STORES.OUTBOX));
    const rows = [];
    await forEachRow(messages, (row, key) => {
      rows.push({
        key,
        conversationId: row?.conversationId,
        at: getMsgTimestamp(row),
        unsent: isUnsentRow(row, outboxIds, now),
      });
    });

    let removed = 0;
    if (!isStale(epoch)) {
      const { remove, emptied } = planTrim(rows, { perConversation, maxConversations, maxTotal });
      remove.forEach((key) => messages.delete(key));
      // Its cursor described history that is no longer here.
      emptied.forEach((conversationId) => tx.objectStore(STORES.SYNC_META).delete(conversationId));
      removed = remove.size;
    }
    await committed(tx);
    return removed;
  } catch (err) {
    console.warn('Cache trim failed', err);
    return 0;
  }
}

/**
 * Empties the message cache and its sync metadata for "free up space", leaving
 * signed-in state and everything unsent alone: the outbox store is not opened
 * for writing, and any row it names (or that is still sending/failed) stays so
 * the chat keeps showing it. Unlike `idbClearMessages` this does not start a new
 * clear generation, because the outbox abandons work started under an old one.
 * Resolves true if it committed.
 */
export async function idbClearMessageCache() {
  try {
    const db = await openMessagesDB();
    const tx = db.transaction([STORES.MESSAGES, STORES.SYNC_META, STORES.OUTBOX], 'readwrite');
    const messages = tx.objectStore(STORES.MESSAGES);
    const now = Date.now();

    const outboxIds = await readOutboxIds(tx.objectStore(STORES.OUTBOX));
    const doomed = [];
    await forEachRow(messages, (row, key) => {
      if (!isUnsentRow(row, outboxIds, now)) doomed.push(key);
    });
    doomed.forEach((key) => messages.delete(key));
    // Cursors for history that is gone; the next open refetches from the top.
    tx.objectStore(STORES.SYNC_META).clear();
    await committed(tx);
    return true;
  } catch {
    return false;
  }
}

/**
 * @param {object | ((stored: object | null) => object | null)} patch - a function
 *   is given the stored row (null when there is none) and returns the patch, or
 *   null to leave the row alone.
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

    const resolved = typeof patch === 'function' ? patch(existingRecord) : patch;
    // A function patch that declined: nothing to write.
    if (!resolved) {
      await committed(tx);
      return;
    }

    const updated = sanitizeMessageForStorage({
      ...(existingRecord || {}),
      ...resolved,
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
