/**
 * State for the notification island. Framework-free so its lifecycle can be
 * tested without rendering, and so producers (socket handlers) can call it
 * from anywhere.
 *
 * The island shows up to MAX_VISIBLE notifications at once as rows, newest on
 * top. Anything beyond that waits in a FIFO queue; when a visible row leaves,
 * the oldest waiting one slides in at the top. Because the queue is FIFO and
 * a queued item is always newer than every visible one, "newest on top" holds
 * for the whole lifecycle: rows never reorder, they only enter at the top and
 * leave from wherever they are.
 *
 * Each visible row has its own time on screen; a queued one has none until it
 * is shown.
 *
 * Grouping: items with the same `groupKey` (e.g. one conversation) never
 * stack. A new one updates the existing row (or queued item) in place, bumps
 * its count and restarts its time.
 *
 * Holds: while something is interacting with the rows (a finger is down, a
 * row is being swiped as a separate card) the visible set is frozen: nothing
 * is promoted from the queue, so no row moves under the finger. Updates in
 * place still apply. A hold never blocks an empty island from showing.
 *
 * When the last row's time runs out and nothing is waiting, the island is
 * marked `closing` with that row still in it, so it can collapse showing real
 * content; the island calls islandFinish() once it has gone.
 */

export const ISLAND_DURATIONS = {
  normal: 3500,
  message: 4500,
  important: 6000,
};

export const MAX_VISIBLE = 3;
// A flood (reconnect replay, a busy group) must not keep the island up for
// minutes. Past this, the oldest waiting notification is dropped; it is still
// in the notifications list, the island is only the instant surface.
export const MAX_QUEUED = 12;
const SEEN_LIMIT = 100;
const MIN_RESUME_MS = 1200;

let items = [];
let queue = [];
let closing = false;
let shown = false; // island has finished expanding; clocks may run
let seenIds = [];
let snapshot = { items, closing };
const listeners = new Set();
const timers = new Map(); // key -> { handle, remaining, startedAt }
const pauseReasons = new Set();
const holdReasons = new Set();
let nextSeq = 1;

function emit() {
  snapshot = { items, closing };
  listeners.forEach((l) => l());
}

function stopTimer(key) {
  const t = timers.get(key);
  if (t?.handle) {
    clearTimeout(t.handle);
    t.handle = null;
    t.remaining = Math.max(0, t.remaining - (Date.now() - t.startedAt));
  }
}

function dropTimer(key) {
  const t = timers.get(key);
  if (t?.handle) clearTimeout(t.handle);
  timers.delete(key);
}

function startTimer(item) {
  if (item.sticky || !shown || closing || pauseReasons.size > 0) return;
  const t = timers.get(item.key);
  if (!t || t.handle) return;
  t.startedAt = Date.now();
  t.handle = setTimeout(() => {
    t.handle = null;
    remove(item.key);
  }, t.remaining);
}

function startAll() {
  items.forEach(startTimer);
}

function rememberId(id) {
  if (!id) return;
  seenIds.push(id);
  if (seenIds.length > SEEN_LIMIT) seenIds = seenIds.slice(-SEEN_LIMIT);
}

/**
 * Move waiting items into free rows, oldest first, each entering at the top.
 * Returns whether anything moved.
 */
function promote() {
  let moved = false;
  while (
    items.length < MAX_VISIBLE
    && queue.length > 0
    && (holdReasons.size === 0 || items.length === 0)
  ) {
    const next = queue[0];
    queue = queue.slice(1);
    timers.set(next.key, { handle: null, remaining: next.duration, startedAt: 0 });
    items = [next, ...items];
    startTimer(next);
    moved = true;
  }
  return moved;
}

/** Remove one item; the last visible row is kept and the island marked closing. */
function remove(key) {
  if (queue.some((i) => i.key === key)) {
    queue = queue.filter((i) => i.key !== key);
    return;
  }
  if (!items.some((i) => i.key === key)) return;
  if (items.length === 1 && queue.length === 0) {
    if (closing) return;
    items.forEach((i) => stopTimer(i.key));
    closing = true;
  } else {
    dropTimer(key);
    items = items.filter((i) => i.key !== key);
    promote();
  }
  emit();
}

function removeMany(keys) {
  // Queued ones first, so removing the visible ones cannot promote an item
  // that is itself about to be removed.
  const queued = new Set(queue.filter((i) => keys.includes(i.key)).map((i) => i.key));
  if (queued.size) queue = queue.filter((i) => !queued.has(i.key));
  keys.filter((k) => !queued.has(k)).forEach(remove);
  if (queued.size) emit();
}

/** Show a notification (or merge it into its conversation's row). Returns its key. */
export function islandNotify(input) {
  if (!input || !input.content) return null;
  if (input.id && seenIds.includes(input.id)) return null;
  rememberId(input.id);

  const wasClosing = closing;
  closing = false;

  if (input.groupKey) {
    const existing = items.find((i) => i.groupKey === input.groupKey);
    if (existing) {
      const merged = {
        ...existing,
        content: input.content,
        onOpen: input.onOpen || existing.onOpen,
        count: existing.count + 1,
        revision: existing.revision + 1,
      };
      items = items.map((i) => (i.key === existing.key ? merged : i));
      dropTimer(merged.key);
      timers.set(merged.key, { handle: null, remaining: merged.duration, startedAt: 0 });
      if (wasClosing) startAll();
      else startTimer(merged);
      emit();
      return merged.key;
    }
    const waiting = queue.find((i) => i.groupKey === input.groupKey);
    if (waiting) {
      queue = queue.map((i) => (i.key === waiting.key ? {
        ...waiting,
        content: input.content,
        onOpen: input.onOpen || waiting.onOpen,
        count: waiting.count + 1,
        revision: waiting.revision + 1,
      } : i));
      return waiting.key;
    }
  }

  if (wasClosing) {
    // The row that was closing has had its time; the new one replaces it
    // rather than bringing it back.
    items.forEach((i) => dropTimer(i.key));
    items = [];
  }

  const priority = input.priority || 'normal';
  const item = {
    key: `island-${nextSeq++}`,
    id: input.id || null,
    groupKey: input.groupKey || null,
    priority,
    sticky: Boolean(input.sticky),
    duration: input.duration || ISLAND_DURATIONS[priority] || ISLAND_DURATIONS.normal,
    relevantPath: input.relevantPath || null,
    content: input.content,
    onOpen: input.onOpen || null,
    count: 1,
    revision: 0,
  };
  queue = [...queue, item];
  if (queue.length > MAX_QUEUED) queue = queue.slice(queue.length - MAX_QUEUED);
  const moved = promote();
  if (wasClosing) startAll();
  if (moved || wasClosing) emit();
  return item.key;
}

/** Island reports it has finished expanding: clocks start. */
export function islandMarkShown() {
  if (shown) return;
  shown = true;
  startAll();
}

/** Close one row (or waiting item) by key or group key. */
export function islandDismiss(keyOrGroup) {
  const match = [...items, ...queue]
    .filter((i) => i.key === keyOrGroup || i.groupKey === keyOrGroup)
    .map((i) => i.key);
  if (match.length) removeMany(match);
}

/** Drop every row the given route makes irrelevant (e.g. the chat it opens). */
export function islandDismissForPath(pathname) {
  if (!pathname) return;
  const match = [...items, ...queue]
    .filter((i) => i.relevantPath && pathname.startsWith(i.relevantPath))
    .map((i) => i.key);
  if (match.length) removeMany(match);
}

/** Remove a row with no collapse (it was swiped away). */
export function islandDismissNow(key) {
  if (queue.some((i) => i.key === key)) {
    queue = queue.filter((i) => i.key !== key);
    return;
  }
  if (!items.some((i) => i.key === key)) return;
  dropTimer(key);
  items = items.filter((i) => i.key !== key);
  if (items.length === 0) {
    // The island has gone; whatever comes next drops in afresh, and its
    // clock waits for that.
    closing = false;
    shown = false;
  }
  promote();
  emit();
}

/** Island finished collapsing and leaving. */
export function islandFinish() {
  if (!closing) return;
  items.forEach((i) => dropTimer(i.key));
  items = [];
  closing = false;
  shown = false;
  // Pauses and holds tied to the island (hover, press, a swipe) end with it;
  // the app being in the background does not.
  pauseReasons.forEach((r) => { if (r !== 'hidden') pauseReasons.delete(r); });
  holdReasons.clear();
  promote();
  emit();
}

export function islandPause(reason) {
  if (pauseReasons.has(reason)) return;
  pauseReasons.add(reason);
  items.forEach((i) => stopTimer(i.key));
}

export function islandResume(reason) {
  if (!pauseReasons.delete(reason) || pauseReasons.size > 0) return;
  timers.forEach((t) => { t.remaining = Math.max(t.remaining, MIN_RESUME_MS); });
  startAll();
}

/** Freeze the visible set (nothing promoted) while the rows are being handled. */
export function islandHold(reason) {
  holdReasons.add(reason);
}

export function islandRelease(reason) {
  if (!holdReasons.delete(reason) || holdReasons.size > 0) return;
  if (promote()) emit();
}

export function islandSubscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function islandSnapshot() {
  return snapshot;
}

/** How many notifications are waiting for a row. */
export function islandQueuedCount() {
  return queue.length;
}

/** Tests only. */
export function __resetIsland() {
  timers.forEach((t) => { if (t.handle) clearTimeout(t.handle); });
  timers.clear();
  items = [];
  queue = [];
  closing = false;
  shown = false;
  seenIds = [];
  pauseReasons.clear();
  holdReasons.clear();
  snapshot = { items, closing };
  listeners.clear();
}

// The app being backgrounded is a pause like any other: a notification that
// arrived just before the user switched away should still be there to read.
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') islandPause('hidden');
    else islandResume('hidden');
  });
}
