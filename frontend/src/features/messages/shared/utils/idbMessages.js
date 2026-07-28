/**
 * Specialized IndexedDB wrapper for E2EE encrypted messages.
 * STRICTLY ENSURES no decrypted plaintext is ever persisted to disk.
 */

const DB_NAME = 'meetifyy_e2ee_messages';
const DB_VERSION = 1;

const STORES = {
  MESSAGES: 'messages',
  SYNC_META: 'sync_metadata',
};

let _db = null;

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

/**
 * Strips decrypted fields before storing.
 */
function sanitizeMessageForStorage(msg) {
  const safeMsg = { ...msg };
  // STRICT SECURITY INVARIANT: Strip decrypted text
  if (safeMsg.type === 'e2ee' || safeMsg.isE2EE) {
    delete safeMsg.decryptedText;
    delete safeMsg.text; // Ensure plaintext fallback is erased for E2EE
    if (safeMsg.payload) {
      delete safeMsg.payload.text;
    }
  }
  delete safeMsg.isDecrypting;
  delete safeMsg.decryptError;
  return safeMsg;
}

/**
 * Bulk save/update messages for a conversation.
 * Expected to receive raw or lightly mutated messages.
 */
export async function idbSaveMessages(conversationId, messages) {
  if (!messages || !messages.length) return;
  try {
    const db = await openMessagesDB();
    const tx = db.transaction(STORES.MESSAGES, 'readwrite');
    const store = tx.objectStore(STORES.MESSAGES);
    
    for (const msg of messages) {
      // Use tempId if real id doesn't exist (optimistic UI)
      const id = msg.id || msg.tempId;
      if (!id) continue;
      
      const safeMsg = sanitizeMessageForStorage({
        ...msg,
        id,
        conversationId, // force uniform structure
        storedAt: Date.now(),
      });
      store.put(safeMsg);
    }
    
    await new Promise((res, rej) => {
      tx.oncomplete = res;
      tx.onerror = () => rej(tx.error);
    });
  } catch (err) {
    console.warn('IDB Save failed:', err);
  }
}

/**
 * Retrieve messages for a conversation, sorted by createdAt ascending.
 * Fetches the entire conversation history available in cache.
 */
export async function idbGetMessages(conversationId) {
  try {
    const db = await openMessagesDB();
    const tx = db.transaction(STORES.MESSAGES, 'readonly');
    const store = tx.objectStore(STORES.MESSAGES);
    const index = store.index('conversationId');
    
    const request = index.getAll(IDBKeyRange.only(conversationId));
    
    const rawMessages = await new Promise((res, rej) => {
      request.onsuccess = () => res(request.result);
      request.onerror = () => rej(request.error);
    });
    
    // Sort ascending by createdAt
    return rawMessages.sort((a, b) => {
      const timeA = new Date(a.createdAt || 0).getTime();
      const timeB = new Date(b.createdAt || 0).getTime();
      return timeA - timeB;
    });
  } catch (err) {
    console.warn('IDB Get failed:', err);
    return [];
  }
}

/**
 * Update sync metadata (e.g., nextCursor, lastSyncedAt)
 */
export async function idbSaveSyncMeta(conversationId, meta) {
  try {
    const db = await openMessagesDB();
    const tx = db.transaction(STORES.SYNC_META, 'readwrite');
    tx.objectStore(STORES.SYNC_META).put({
      conversationId,
      ...meta,
      updatedAt: Date.now(),
    });
    await new Promise((res, rej) => {
      tx.oncomplete = res;
      tx.onerror = () => rej(tx.error);
    });
  } catch (err) {
    console.warn('IDB SyncMeta Save failed:', err);
  }
}

export async function idbGetSyncMeta(conversationId) {
  try {
    const db = await openMessagesDB();
    const tx = db.transaction(STORES.SYNC_META, 'readonly');
    const request = tx.objectStore(STORES.SYNC_META).get(conversationId);
    return await new Promise((res, rej) => {
      request.onsuccess = () => res(request.result);
      request.onerror = () => rej(request.error);
    });
  } catch (err) {
    return null;
  }
}

/**
 * Clear cache entirely (e.g. on logout)
 */
export async function idbClearE2EEMessages() {
  try {
    const db = await openMessagesDB();
    const tx = db.transaction([STORES.MESSAGES, STORES.SYNC_META], 'readwrite');
    tx.objectStore(STORES.MESSAGES).clear();
    tx.objectStore(STORES.SYNC_META).clear();
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
 * Patch an existing message in IDB without replacing the whole object.
 */
export async function idbPatchMessage(conversationId, messageId, patch) {
  if (!messageId) return;
  try {
    const db = await openMessagesDB();
    const tx = db.transaction(STORES.MESSAGES, 'readwrite');
    const store = tx.objectStore(STORES.MESSAGES);
    
    const request = store.get(messageId);
    request.onsuccess = () => {
      if (request.result) {
        const updated = sanitizeMessageForStorage({
          ...request.result,
          ...patch,
          storedAt: Date.now()
        });
        store.put(updated);
      }
    };
    
    await new Promise((res, rej) => {
      tx.oncomplete = res;
      tx.onerror = () => rej(tx.error);
    });
  } catch (err) {
    console.warn('IDB Patch failed:', err);
  }
}
