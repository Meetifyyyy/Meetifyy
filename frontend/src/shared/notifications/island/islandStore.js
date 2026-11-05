/**
 * State for the notification island. Framework-free so its lifecycle can be
 * tested without rendering, and so producers (socket handlers) can call it
 * from anywhere.
 *
 * The island shows up to MAX_VISIBLE notifications at once as rows, newest on
 * top. A new one slides in at the top; when that makes one too many, the
 * oldest slides out at the bottom. Each row has its own time on screen.
 *
 * Grouping: rows with the same `groupKey` (e.g. one conversation) never
 * stack. A new one updates the existing row in place, bumps its count and
 * restarts its time.
 *
 * When the last row's time runs out the island is marked `closing` with that
 * row still in it, so it can collapse showing real content; the island calls
 * islandFinish() once it has gone.
 */

export const ISLAND_DURATIONS = {
  normal: 3500,
  message: 4500,
  important: 6000,
};

export const MAX_VISIBLE = 3;
const SEEN_LIMIT = 100;
const MIN_RESUME_MS = 1200;

let items = [];
let closing = false;
let shown = false; // island has finished expanding; clocks may run
let seenIds = [];
let snapshot = { items, closing };
const listeners = new Set();
const timers = new Map(); // key -> { handle, remaining, startedAt }
const pauseReasons = new Set();
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

/** Remove one row; the last one is kept and the island marked closing. */
function remove(key) {
  if (!items.some((i) => i.key === key)) return;
  if (items.length === 1) {
    if (closing) return;
    items.forEach((i) => stopTimer(i.key));
    closing = true;
  } else {
    dropTimer(key);
    items = items.filter((i) => i.key !== key);
  }
  emit();
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
  timers.set(item.key, { handle: null, remaining: item.duration, startedAt: 0 });
  items = [item, ...items];
  while (items.length > MAX_VISIBLE) {
    const oldest = items[items.length - 1];
    dropTimer(oldest.key);
    items = items.slice(0, -1);
  }
  if (wasClosing) startAll();
  else startTimer(item);
  emit();
  return item.key;
}

/** Island reports it has finished expanding: clocks start. */
export function islandMarkShown() {
  if (shown) return;
  shown = true;
  startAll();
}

/** Close one row by key or group key. */
export function islandDismiss(keyOrGroup) {
  const match = items.filter((i) => i.key === keyOrGroup || i.groupKey === keyOrGroup);
  match.forEach((i) => remove(i.key));
}

/** Drop every row the given route makes irrelevant (e.g. the chat it opens). */
export function islandDismissForPath(pathname) {
  if (!pathname) return;
  items
    .filter((i) => i.relevantPath && pathname.startsWith(i.relevantPath))
    .forEach((i) => remove(i.key));
}

/** Remove a row with no collapse (it was swiped away). */
export function islandDismissNow(key) {
  if (!items.some((i) => i.key === key)) return;
  dropTimer(key);
  items = items.filter((i) => i.key !== key);
  if (items.length === 0) {
    closing = false;
    shown = false;
  }
  emit();
}

/** Island finished collapsing and leaving. */
export function islandFinish() {
  if (!closing) return;
  items.forEach((i) => dropTimer(i.key));
  items = [];
  closing = false;
  shown = false;
  // Pauses tied to the island (hover, press) end with it; the app being in
  // the background does not.
  pauseReasons.forEach((r) => { if (r !== 'hidden') pauseReasons.delete(r); });
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

export function islandSubscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function islandSnapshot() {
  return snapshot;
}

/** Tests only. */
export function __resetIsland() {
  timers.forEach((t) => { if (t.handle) clearTimeout(t.handle); });
  timers.clear();
  items = [];
  closing = false;
  shown = false;
  seenIds = [];
  pauseReasons.clear();
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
