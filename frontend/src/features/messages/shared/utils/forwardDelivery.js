/**
 * Delivering one message to several chats, safely retryable.
 *
 * Both forward entry points (the in-chat modal and the fullscreen media viewer)
 * looped over the selected recipients, recorded the failures and threw, leaving
 * the whole selection in place. A retry therefore re-sent to the recipients that
 * had already succeeded, and because every send minted a fresh client id the
 * backend (which de-duplicates on sender + conversation + clientMessageId)
 * could not recognise the repeat.
 *
 * The fix is a per-operation id: every recipient gets a client id derived from
 * (operation, recipient), so re-sending to someone who already got it is
 * recognised by the server instead of delivering twice, and the thrown error
 * says exactly which recipients still need it so the UI can narrow the selection.
 */

// Backend limit for clientMessageId is 128 characters (message-limits.ts).
const MAX_CLIENT_ID_LENGTH = 128;

/** A new id for one logical "forward this to these people" action. */
export function newForwardOperationId() {
  const rand =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  return rand.replace(/-/g, '').slice(0, 24);
}

/** Stable client id for one recipient within one forward operation. */
export function forwardClientId(operationId, recipientId) {
  return `fwd_${operationId}_${recipientId}`.slice(0, MAX_CLIENT_ID_LENGTH);
}

export class ForwardPartialError extends Error {
  constructor(failedIds, total) {
    super(`forward failed for ${failedIds.length} of ${total} recipient(s)`);
    this.name = 'ForwardPartialError';
    this.failedIds = failedIds;
    this.total = total;
    this.sentCount = total - failedIds.length;
  }
}

/**
 * Attempt every recipient even after one fails.
 *
 * @param {object} args
 * @param {string[]} args.targetIds       recipient ids
 * @param {string}   args.operationId     from newForwardOperationId(); keep it for retries
 * @param {(id: string, clientId: string) => Promise<unknown>} args.send
 * @throws {ForwardPartialError} when at least one recipient failed
 */
export async function forwardToTargets({ targetIds, operationId, send }) {
  const ids = Array.isArray(targetIds) ? targetIds : [];
  const failed = [];
  for (const id of ids) {
    try {
      await send(id, forwardClientId(operationId, id));
    } catch {
      failed.push(id);
    }
  }
  if (failed.length > 0) throw new ForwardPartialError(failed, ids.length);
}
