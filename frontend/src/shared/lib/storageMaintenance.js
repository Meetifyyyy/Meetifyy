/**
 * Once-per-launch housekeeping for what this app keeps on the device.
 *
 * Every local store was bounded only by a TTL that was checked when an entry
 * was read, so entries nobody read again stayed forever, and the message cache
 * was trimmed each time a chat opened. This is one pass that runs once, when
 * the browser is idle after launch, so it never competes with the first paint
 * or with a tap:
 *
 *   1. the IndexedDB cache: expired entries out, each store held to its cap;
 *   2. the message cache: per conversation, per conversation count and overall
 *      limits (unsent rows are never removed);
 *   3. draft photos older than their 30 minute lifetime.
 *
 * It never touches the outbox, auth state or text drafts, and every step
 * checks the clear generation, so a sign-out during the pass stops it.
 */
import { idbMaintainCache } from './idb';

/** Give up waiting for an idle moment after this long, so a busy launch still gets its pass. */
const IDLE_TIMEOUT_MS = 15_000;
/** Without requestIdleCallback (Safari), a short wait that lets the first screen settle. */
const FALLBACK_DELAY_MS = 5_000;

let scheduled = false;

async function step(name, run) {
  try {
    await run();
  } catch (err) {
    // Housekeeping: a failure here must never reach the person.
    console.warn(`[storage] ${name} maintenance failed:`, err);
  }
}

/** Runs the three steps one after another, so they never contend for IndexedDB. */
export async function runStorageMaintenance() {
  await step('cache', () => idbMaintainCache());
  // Lazily: the messaging and drafts code is not part of the launch bundle.
  await step('messages', async () => (await import('../../features/messages/shared/utils/idbMessages')).trimMessageCache());
  await step('drafts', async () => (await import('../utils/draftImageCache')).cleanupDraftImages());
}

/**
 * Schedules the pass for an idle moment, once per page load. Calling it again
 * does nothing. Returns whether this call scheduled it.
 */
export function scheduleStorageMaintenance() {
  if (scheduled) return false;
  scheduled = true;
  const run = () => { void runStorageMaintenance(); };
  if (typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function') {
    window.requestIdleCallback(run, { timeout: IDLE_TIMEOUT_MS });
  } else {
    setTimeout(run, FALLBACK_DELAY_MS);
  }
  return true;
}
