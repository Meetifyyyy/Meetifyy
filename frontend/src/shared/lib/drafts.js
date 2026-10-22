/**
 * Persistent text drafts: a half-typed chat message, post or comment survives
 * leaving the screen, switching chats and the app being killed, and is waiting
 * when the person returns to the same composer.
 *
 * localStorage rather than IndexedDB on purpose. A composer has to restore in
 * its FIRST render, with no empty-then-filled flash, and only localStorage can
 * be read synchronously. Drafts are small and bounded (below), which is the
 * case it is good at.
 *
 * Layout: one key per draft, `meetifyy_draft:v1:<userId>:<scope>`, holding
 * `{ text, savedAt, mentions? }`. The user id is part of the key so a shared
 * browser never shows one account's draft to another; with nobody signed in
 * every function here is a no-op. `clearAllDrafts` (sign-out) removes the lot,
 * whoever it belonged to.
 *
 * Bounds, so drafts cannot grow without limit:
 *   - at most MAX_DRAFTS_PER_USER; saving past it evicts the oldest by `savedAt`
 *   - each text is cut to the composer's own limit (`maxLength`)
 *   - an entry older than DRAFT_TTL_MS is ignored and removed when read
 *
 * Text only. Media attachments, poll options and reply targets are not saved:
 * they are object URLs or UI state that would not mean the same thing after a
 * restart. Mentions ARE saved, but only the plain `{ userId, username, start,
 * end }` records the editor already produces, and `readDraft` re-validates each
 * against the text before handing it back, so a restored mention always lines
 * up with the characters it points at.
 *
 * Every storage access is guarded: private mode, a full quota or a blocked
 * storage must make drafts silently stop working, never break typing.
 */

import { IS_MOBILE_BUILD } from '@config';

export const DRAFT_PREFIX = 'meetifyy_draft:';
const VERSION_PREFIX = `${DRAFT_PREFIX}v1:`;

export const MAX_DRAFTS_PER_USER = 50;
/** A week. A draft older than that is stale context, not something to resurrect. */
// A week on the installed app, a day on the website: a browser is more often
// shared, and a draft left by someone who closed the tab without signing out
// stays readable there until it expires (sign-out wipes them either way).
export const DRAFT_TTL_MS = (IS_MOBILE_BUILD ? 7 : 1) * 24 * 60 * 60 * 1000;
/** Ceiling when a caller names no limit of its own (the longest composer is a chat message). */
const DEFAULT_MAX_LENGTH = 5000;
const MAX_MENTIONS = 50;

function storage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    // Accessing the property itself throws when storage is blocked.
    return null;
  }
}

/** The signed-in user's id, read the way the rest of the app reads it. */
function currentUserId(store) {
  try {
    if (store.getItem('loggedIn') !== 'true') return null;
    const id = JSON.parse(store.getItem('currentUser') || 'null')?.id;
    return id == null || id === '' ? null : String(id);
  } catch {
    return null;
  }
}

function userPrefix(userId) {
  return `${VERSION_PREFIX}${userId}:`;
}

function allKeys(store, prefix) {
  const keys = [];
  for (let i = 0; i < store.length; i += 1) {
    const key = store.key(i);
    if (key && key.startsWith(prefix)) keys.push(key);
  }
  return keys;
}

function parseEntry(raw) {
  try {
    const entry = JSON.parse(raw);
    if (!entry || typeof entry.text !== 'string') return null;
    if (typeof entry.savedAt !== 'number' || !Number.isFinite(entry.savedAt)) return null;
    return entry;
  } catch {
    return null;
  }
}

function isExpired(entry, now) {
  return now - entry.savedAt > DRAFT_TTL_MS;
}

/** Cuts to `max` UTF-16 units without leaving half an emoji at the end. */
function clampText(text, max) {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const last = cut.charCodeAt(cut.length - 1);
  return last >= 0xd800 && last <= 0xdbff ? cut.slice(0, -1) : cut;
}

/** Keeps only mention records that still point at their own `@username` in `text`. */
function validMentions(mentions, text) {
  if (!Array.isArray(mentions)) return [];
  const out = [];
  for (const m of mentions) {
    if (out.length >= MAX_MENTIONS) break;
    if (!m || typeof m.username !== 'string' || m.userId == null) continue;
    if (!Number.isInteger(m.start) || !Number.isInteger(m.end)) continue;
    if (m.start < 0 || m.end > text.length || m.start >= m.end) continue;
    if (text.slice(m.start, m.end) !== `@${m.username}`) continue;
    out.push({ userId: m.userId, username: m.username, start: m.start, end: m.end });
  }
  return out;
}

/** Removes the oldest of this user's drafts until there is room for one more. */
function makeRoom(store, prefix, exceptKey, now) {
  const entries = [];
  for (const key of allKeys(store, prefix)) {
    if (key === exceptKey) continue;
    const entry = parseEntry(store.getItem(key));
    if (!entry || isExpired(entry, now)) {
      store.removeItem(key);
    } else {
      entries.push({ key, savedAt: entry.savedAt });
    }
  }
  if (entries.length < MAX_DRAFTS_PER_USER) return;
  entries.sort((a, b) => a.savedAt - b.savedAt);
  const excess = entries.length - (MAX_DRAFTS_PER_USER - 1);
  for (let i = 0; i < excess; i += 1) store.removeItem(entries[i].key);
}

/**
 * The saved draft for `scope`, or null: `{ text, mentions }`.
 * An expired or corrupt entry is removed on the way past.
 */
export function readDraft(scope) {
  try {
    const store = storage();
    if (!store || !scope) return null;
    const userId = currentUserId(store);
    if (!userId) return null;

    const key = `${userPrefix(userId)}${scope}`;
    const raw = store.getItem(key);
    if (raw == null) return null;

    const entry = parseEntry(raw);
    if (!entry || isExpired(entry, Date.now()) || !entry.text.trim()) {
      store.removeItem(key);
      return null;
    }
    return { text: entry.text, mentions: validMentions(entry.mentions, entry.text) };
  } catch {
    return null;
  }
}

/**
 * Saves `text` as the draft for `scope`. Empty or whitespace-only text deletes
 * the draft instead, so clearing the box leaves nothing behind. Synchronous;
 * callers debounce typing themselves (see useComposerDraft).
 *
 * @param {string}  scope
 * @param {string}  text
 * @param {object}  [options]
 * @param {number}  [options.maxLength] The composer's own limit; longer text is cut.
 * @param {Array}   [options.mentions]  The editor's `{ userId, username, start, end }` records.
 * @param {string}  [options.owner]     The account that typed it (`draftOwner()`
 *   when it was typed). If a different account is signed in by the time the
 *   save runs, nothing is stored: a composer flushing on unmount during an
 *   account switch must not leave one person's text in the other's drafts.
 * @returns {boolean} whether a draft is stored afterwards.
 */
export function saveDraft(scope, text, options = {}) {
  try {
    const store = storage();
    if (!store || !scope) return false;
    const userId = currentUserId(store);
    if (!userId) return false;
    if (options.owner !== undefined && options.owner !== userId) return false;

    const prefix = userPrefix(userId);
    const key = `${prefix}${scope}`;

    if (typeof text !== 'string' || !text.trim()) {
      store.removeItem(key);
      return false;
    }

    const now = Date.now();
    const body = clampText(text, options.maxLength ?? DEFAULT_MAX_LENGTH);
    const entry = { text: body, savedAt: now };
    const mentions = validMentions(options.mentions, body);
    if (mentions.length > 0) entry.mentions = mentions;

    // Only a NEW key can push the count over the cap; rewriting an existing
    // draft never needs an eviction.
    if (store.getItem(key) == null) makeRoom(store, prefix, key, now);
    store.setItem(key, JSON.stringify(entry));
    return true;
  } catch {
    // Quota exceeded or storage unavailable: no draft, but typing goes on.
    return false;
  }
}

/** Deletes the draft for `scope`. */
export function clearDraft(scope) {
  try {
    const store = storage();
    if (!store || !scope) return;
    const userId = currentUserId(store);
    if (!userId) return;
    store.removeItem(`${userPrefix(userId)}${scope}`);
  } catch {
    // Nothing to clean up if storage is unavailable.
  }
}

/**
 * Deletes every draft of every user. Called at sign-out: a draft is private
 * writing, and it must not outlive the session that wrote it on a shared device.
 */
export function clearAllDrafts() {
  try {
    const store = storage();
    if (!store) return;
    for (const key of allKeys(store, DRAFT_PREFIX)) store.removeItem(key);
  } catch {
    // Nothing to clean up if storage is unavailable.
  }
}

/** The account drafts are currently saved for, or null. Capture it when text is typed. */
export function draftOwner() {
  try {
    const store = storage();
    return store ? currentUserId(store) : null;
  } catch {
    return null;
  }
}
