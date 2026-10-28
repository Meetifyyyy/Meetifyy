/**
 * The app's one outbox, wired to the socket, the query cache and the message
 * store. The rules live in outbox.js; this file only supplies the effects.
 */
import { useGlobalSocketStore } from '@stores/useGlobalSocketStore';
import { messagesApi, dmApi, groupApi } from '@shared/api/apiClient';
import { isOnline, subscribeOnline } from '@shared/lib/networkStatus';
import { createOutbox } from './outbox';
import {
  idbDeleteMessage,
  idbOutboxAll,
  idbOutboxDelete,
  idbOutboxPut,
  idbPatchMessage,
  idbSaveMessages,
} from './idbMessages';
import { idbEpoch } from '@shared/lib/idb';
import { appendMessageToCache, updateMessageInCache } from './cacheUtils';
import { sendFailureReason } from './sendFailure';

// The queue this replaced kept unsent messages in localStorage with no owner.
// Installations that still hold one may hold another account's messages, so
// it is deleted, never replayed.
try {
  localStorage.removeItem('meetifyy_pending_messages');
} catch {
  // Storage unavailable: there is nothing to remove either.
}

/**
 * An unanswered socket send is given this long before the REST route is tried.
 * Short, because REST is safe to try next: the server matches the clientId, so
 * a send that did land over the socket is returned, not duplicated.
 */
const SEND_ACK_TIMEOUT_MS = 5_000;

/**
 * After a socket send went unanswered, the socket is treated as half-open
 * (connected on paper, carrying nothing: a network switch, a sleeping radio)
 * for this long, and sends go straight to REST. Otherwise each queued message
 * would wait out its own ack timeout, one after the other.
 */
const SOCKET_DISTRUST_MS = 60_000;
let lastAckTimeoutAt = 0;

/** A fresh socket connection: it has proven itself, so trust it again. */
export function noteSocketConnected() {
  lastAckTimeoutAt = 0;
}

const socketDistrusted = () => lastAckTimeoutAt > 0 && Date.now() - lastAckTimeoutAt < SOCKET_DISTRUST_MS;

let boundQueryClient = null;
let wakeInstalled = false;

/**
 * Sends what is due now, ignoring any backoff: the connection changed, so a
 * wait that was for the old one is over. Safe to call as often as you like.
 */
export function wakeOutbox() {
  return outbox.flush({ now: true });
}

/** Flushes when connectivity returns or the app is brought back. Installed once. */
function installWakeListeners() {
  if (wakeInstalled) return;
  wakeInstalled = true;
  // Only the socket's `connect` flushed before, so a device that came back
  // online with the socket still reconnecting (or a REST-only path) waited for
  // the backoff timer, up to five minutes.
  subscribeOnline((online) => {
    if (online) void wakeOutbox();
  });
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && isOnline()) void wakeOutbox();
    });
  }
}

/**
 * Gives the outbox the cache it updates. Called once the app has a QueryClient,
 * at startup, so a message delivered over REST while the socket is down still
 * updates its bubble. Also starts listening for the network coming back.
 */
export function bindOutbox(queryClient) {
  boundQueryClient = queryClient;
  installWakeListeners();
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

/**
 * The REST endpoint family for a chat type. Entries record the type of the chat
 * screen that made them; one without it (written before it was recorded) was
 * always a regular `messages` chat.
 */
export function restApiForChatType(chatType) {
  switch (chatType) {
    case 'dm': return dmApi;
    case 'group': return groupApi;
    default: return messagesApi;
  }
}

function sendOverRest(entry) {
  // Started inside the promise: a throw while picking the route or building the
  // request is then a failed send, not an exception in a socket callback that
  // nobody would see (and a send that never settles).
  return Promise.resolve()
    .then(() => restApiForChatType(entry.chatType).sendMessage(entry.conversationId, entry.payload))
    .then(
      // An empty answer is not a confirmation: treated as a transient failure.
      (res) => (res ? { ok: true, message: res } : { ok: false, failure: null }),
      // Carries `status` for classifySendFailure: a 4xx refusal is final, a
      // network error or a 5xx is retried.
      (err) => ({ ok: false, failure: err }),
    );
}

/**
 * The outbox's one send: over the socket with an ack timeout, and over REST
 * when there is no socket or it did not answer, so a message still goes out
 * while the socket is down. With no network at all nothing is attempted
 * (`offline`), so it counts as no failed attempt. A socket ack that says no
 * (a refusal, a rate limit) is the server's answer and is not retried over REST.
 */
export function sendOutboxEntry(entry) {
  const socket = useGlobalSocketStore.getState().socket;
  if (!socket?.connected || socketDistrusted()) {
    if (!isOnline()) return Promise.resolve({ ok: false, offline: true });
    return sendOverRest(entry);
  }
  return new Promise((resolve) => {
    socket.timeout(SEND_ACK_TIMEOUT_MS).emit('message:send', entry.payload, (err, res) => {
      if (err) {
        // No ack in time (or the socket dropped): try REST, once, and go
        // REST-first for a while so the messages behind this one do not each
        // wait out the same dead socket.
        lastAckTimeoutAt = Date.now();
        if (!isOnline()) resolve({ ok: false, offline: true });
        else sendOverRest(entry).then(resolve);
      } else if (res?.status === 'ok') {
        lastAckTimeoutAt = 0;
        resolve({ ok: true, message: res.message });
      }
      else resolve({ ok: false, failure: res });
    });
  });
}

/**
 * Shows a message the outbox delivered. Patches the chat's cache when it is
 * loaded and the stored row either way: a chat not opened this session has
 * no cache entry, and its stored copy must not stay "sending".
 *
 * `epoch` is the local-cache generation the send ran under; disk writes carry
 * it so a sign-out in between drops them.
 */
function markSent(entry, serverMsg, epoch) {
  const qc = boundQueryClient;
  const sent = entry.payload || {};
  let patched = false;
  let blobToRelease = null;
  if (qc) {
    // The same confirmed shape goes to both cached copies of the chat, so the
    // other copy never keeps a revoked `blob:` preview or the temporary id.
    const confirm = (existing) => {
      const status = existing?.status === 'read' || existing?.status === 'seen' ? existing.status : 'sent';
      const existingPayload = existing?.payload || {};
      const serverPayload = serverMsg?.payload || {};
      const local = existingPayload.localPreviewUrl;
      if (typeof local === 'string' && local.startsWith('blob:')) blobToRelease = local;
      // Locally known media metadata (what the upload produced, kept in the
      // entry's payload) survives a server answer that omits it. Server values
      // win when present; a local preview is dropped for the confirmed URL.
      const mergedPayload = {
        ...existingPayload,
        ...serverPayload,
        thumbnailUrl: serverPayload.thumbnailUrl || serverMsg?.thumbnailUrl || sent.thumbnailUrl || existingPayload.thumbnailUrl,
        width: serverPayload.width || sent.width || existingPayload.width,
        height: serverPayload.height || sent.height || existingPayload.height,
        duration: serverPayload.duration || sent.duration || existingPayload.duration,
        localPreviewUrl: undefined,
      };
      return {
        ...existing,
        ...(serverMsg || {}),
        id: serverMsg?.id || existing?.id || entry.clientId,
        clientId: entry.clientId,
        tempId: entry.clientId,
        status,
        queued: false,
        isOptimistic: false,
        // An upload that was in progress is finished: the entry only exists
        // once it has real server URLs.
        uploadStatus: existing?.uploadStatus ? 'done' : existing?.uploadStatus,
        mediaUrl: serverMsg?.mediaUrl || sent.mediaUrl || existing?.mediaUrl,
        payload: mergedPayload,
      };
    };
    updateMessageInCache(qc, entry.conversationId, entry.clientId, (existing) => {
      patched = true;
      const updated = confirm(existing);
      idbPatchMessage(entry.conversationId, updated.id, updated, epoch).catch(() => {});
      return updated;
    });
    // The chat is also cached under another id (public vs internal).
    if (entry.mirrorConversationId && entry.mirrorConversationId !== entry.conversationId) {
      updateMessageInCache(qc, entry.mirrorConversationId, entry.clientId, confirm);
    }
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
  // The bubble no longer references the local blob (cleared above), so it can go.
  if (blobToRelease) {
    try { URL.revokeObjectURL(blobToRelease); } catch { /* already revoked */ }
  }
  if (!patched) {
    if (serverMsg?.id) {
      // Replace the optimistic copy with the server's message. Re-keying the
      // optimistic row onto the server id instead overwrote a server copy that
      // history had already stored with the stale optimistic fields.
      const confirmed = {
        ...serverMsg,
        clientId: entry.clientId,
        tempId: entry.clientId,
        status: 'sent',
        queued: false,
        isOptimistic: false,
      };
      idbDeleteMessage(entry.clientId)
        .then(() => idbSaveMessages(entry.conversationId, [confirmed], epoch))
        .catch(() => {});
    } else {
      idbPatchMessage(entry.conversationId, entry.clientId, {
        clientId: entry.clientId, status: 'sent', queued: false, isOptimistic: false,
      }, epoch).catch(() => {});
    }
  }
}

/** The statuses a message only reaches once the server has it. */
const isConfirmedStatus = (status) =>
  status === 'sent' || status === 'delivered' || status === 'read' || status === 'seen';

/**
 * Shows "Not sent", with why (sendFailure.js), unless the message has
 * meanwhile been confirmed (the server's echo, or an earlier attempt that did
 * land): a delivered message must never be flipped back to failed, in the
 * cache or on disk.
 *
 * A refusal because the sender is no longer in the group is also news about
 * the group: the chat's own copy of the membership is refetched, so the
 * composer closes even if the removal event never reached this device.
 */
function markFailed(entry, epoch, failure) {
  const qc = boundQueryClient;
  const failReason = sendFailureReason(failure);
  const patch = { status: 'failed', queued: false, failReason };
  const unlessConfirmed = (existing) => (isConfirmedStatus(existing?.status) ? {} : patch);
  if (qc) {
    updateMessageInCache(qc, entry.conversationId, entry.clientId, unlessConfirmed);
    if (entry.mirrorConversationId && entry.mirrorConversationId !== entry.conversationId) {
      updateMessageInCache(qc, entry.mirrorConversationId, entry.clientId, unlessConfirmed);
    }
    if (failReason === 'not-member') {
      qc.invalidateQueries({ queryKey: ['conversations'] });
      [entry.conversationId, entry.mirrorConversationId].filter(Boolean).forEach((id) => {
        qc.invalidateQueries({ queryKey: ['messages', id], exact: true });
      });
    }
  }
  idbPatchMessage(
    entry.conversationId,
    entry.clientId,
    (stored) => (isConfirmedStatus(stored?.status) ? null : patch),
    epoch,
  ).catch(() => {});
}

export const outbox = createOutbox({
  store: { put: idbOutboxPut, delete: idbOutboxDelete, all: idbOutboxAll },
  send: sendOutboxEntry,
  onSent: markSent,
  onFailed: markFailed,
  getUserId: currentUserId,
  // The local caches' clear generation, bumped synchronously at sign-out.
  getGeneration: idbEpoch,
});

export { currentUserId as outboxUserId };
