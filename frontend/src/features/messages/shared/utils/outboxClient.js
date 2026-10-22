/**
 * The app's one outbox, wired to the socket, the query cache and the message
 * store. The rules live in outbox.js; this file only supplies the effects.
 */
import { useGlobalSocketStore } from '@stores/useGlobalSocketStore';
import { createOutbox } from './outbox';
import { idbOutboxAll, idbOutboxDelete, idbOutboxPut, idbPatchMessage } from './idbMessages';
import { idbEpoch } from '@shared/lib/idb';
import { appendMessageToCache, updateMessageInCache } from './cacheUtils';

// The queue this replaced kept unsent messages in localStorage with no owner.
// Installations that still hold one may hold another account's messages, so
// it is deleted, never replayed.
try {
  localStorage.removeItem('meetifyy_pending_messages');
} catch {
  // Storage unavailable: there is nothing to remove either.
}

/** An unanswered send counts as a failed attempt, not a wait that never ends. */
const SEND_ACK_TIMEOUT_MS = 10_000;

let boundQueryClient = null;

/** Gives the outbox the cache it updates. Called once the app has a QueryClient. */
export function bindOutbox(queryClient) {
  boundQueryClient = queryClient;
}

/** The signed-in account this device holds, or null. */
function currentUserId() {
  try {
    if (localStorage.getItem('loggedIn') !== 'true') return null;
    return JSON.parse(localStorage.getItem('currentUser') || 'null')?.id ?? null;
  } catch {
    return null;
  }
}

function sendOverSocket(entry) {
  const socket = useGlobalSocketStore.getState().socket;
  if (!socket?.connected) return Promise.resolve({ ok: false, offline: true });
  return new Promise((resolve) => {
    socket.timeout(SEND_ACK_TIMEOUT_MS).emit('message:send', entry.payload, (err, res) => {
      if (err) resolve({ ok: false, failure: null });
      else if (res?.status === 'ok') resolve({ ok: true, message: res.message });
      else resolve({ ok: false, failure: res });
    });
  });
}

/**
 * Shows a message the outbox delivered. Patches the chat's cache when it is
 * loaded and the stored row either way: a chat not opened this session has
 * no cache entry, and its stored copy must not stay "sending".
 */
function markSent(entry, serverMsg) {
  const qc = boundQueryClient;
  let patched = false;
  if (qc) {
    updateMessageInCache(qc, entry.conversationId, entry.clientId, (existing) => {
      patched = true;
      const status = existing?.status === 'read' || existing?.status === 'seen' ? existing.status : 'sent';
      const updated = {
        ...existing,
        ...(serverMsg || {}),
        id: serverMsg?.id || existing?.id || entry.clientId,
        clientId: entry.clientId,
        tempId: entry.clientId,
        status,
        queued: false,
        isOptimistic: false,
        payload: { ...(existing?.payload || {}), ...(serverMsg?.payload || {}) },
      };
      idbPatchMessage(entry.conversationId, updated.id, updated).catch(() => {});
      return updated;
    });
    // The chat is loaded but has no copy (restored after a restart and then
    // replaced by a page, say). The server echo skips the sending socket, so
    // without this the delivered message would not appear until a refetch.
    if (!patched && serverMsg && qc.getQueryData(['messages', entry.conversationId])?.pages?.length) {
      appendMessageToCache(qc, entry.conversationId, {
        ...serverMsg,
        clientId: entry.clientId,
        tempId: entry.clientId,
        status: 'sent',
        queued: false,
        isOptimistic: false,
      });
    }
    qc.invalidateQueries({ queryKey: ['conversations'] });
  }
  if (!patched) {
    // With the server's id, so the stored row is re-keyed rather than left
    // under the temporary one beside the copy history will store next.
    const patch = { clientId: entry.clientId, status: 'sent', queued: false, isOptimistic: false };
    if (serverMsg?.id) patch.id = serverMsg.id;
    idbPatchMessage(entry.conversationId, entry.clientId, patch).catch(() => {});
  }
}

function markFailed(entry) {
  const qc = boundQueryClient;
  const patch = { status: 'failed', queued: false };
  if (qc) updateMessageInCache(qc, entry.conversationId, entry.clientId, patch);
  idbPatchMessage(entry.conversationId, entry.clientId, patch).catch(() => {});
}

export const outbox = createOutbox({
  store: { put: idbOutboxPut, delete: idbOutboxDelete, all: idbOutboxAll },
  send: sendOverSocket,
  onSent: markSent,
  onFailed: markFailed,
  getUserId: currentUserId,
  // The local caches' clear generation, bumped synchronously at sign-out.
  getGeneration: idbEpoch,
});

export { currentUserId as outboxUserId };
