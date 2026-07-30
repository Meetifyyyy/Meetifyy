// Retry offline queue deprecated - failed messages remain strictly local to sender
const OFFLINE_QUEUE_KEY = 'meetifyy_pending_messages';

// Clear legacy queue from localStorage if present
try {
  if (typeof localStorage !== 'undefined') {
    localStorage.removeItem(OFFLINE_QUEUE_KEY);
  }
} catch (e) {}

export function getPendingQueue() {
  return [];
}

export function queuePendingMessage() {
  // No-op: automatic background resending removed
}

export function removePendingMessage() {
  // No-op
}

export async function flushPendingQueue() {
  // No-op: automatic background resending removed
}
