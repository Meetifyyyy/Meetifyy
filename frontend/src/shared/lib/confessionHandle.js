/**
 * Anonymous Confessions handle rules — the client's copy.
 *
 * These mirror the server's and exist only to give instant feedback while
 * someone types; the server checks everything again (and is the only one that
 * knows about uniqueness and the caller's own username) on create.
 */

export const HANDLE_MIN = 3;
export const HANDLE_MAX = 20;

const SHAPE = /^[A-Za-z][A-Za-z0-9_.]*$/;

/** Words no one may hide behind, compared case-insensitively. */
const RESERVED = new Set([
  'admin', 'administrator', 'moderator', 'mod', 'meetifyy', 'support', 'staff',
  'official', 'system', 'anonymous', 'null', 'undefined', 'root', 'help', 'team',
]);

/**
 * `{ ok: true }` or `{ ok: false, reason }`, reason one of:
 * 'short' | 'long' | 'start' | 'chars' | 'repeat' | 'end' | 'reserved'.
 */
export function validateHandle(raw) {
  const handle = typeof raw === 'string' ? raw.trim() : '';
  if (handle.length < HANDLE_MIN) return { ok: false, reason: 'short' };
  if (handle.length > HANDLE_MAX) return { ok: false, reason: 'long' };
  if (!/^[A-Za-z]/.test(handle)) return { ok: false, reason: 'start' };
  if (!SHAPE.test(handle)) return { ok: false, reason: 'chars' };
  if (/[._]{2}/.test(handle)) return { ok: false, reason: 'repeat' };
  if (/[._]$/.test(handle)) return { ok: false, reason: 'end' };
  if (RESERVED.has(handle.toLowerCase())) return { ok: false, reason: 'reserved' };
  return { ok: true, reason: null };
}

const MESSAGES = {
  short: `At least ${HANDLE_MIN} characters.`,
  long: `At most ${HANDLE_MAX} characters.`,
  start: 'Start with a letter.',
  chars: 'Letters, numbers, dots and underscores only.',
  repeat: 'No two dots or underscores in a row.',
  end: 'Can’t end with a dot or underscore.',
  reserved: 'That name is reserved. Try another.',
  server: 'That name isn’t allowed. Try another.',
};

export function handleProblem(reason) {
  return MESSAGES[reason] ?? MESSAGES.server;
}

const ADJECTIVES = [
  'quiet', 'velvet', 'midnight', 'paper', 'lunar', 'amber', 'hollow', 'silent',
  'golden', 'misty', 'restless', 'wandering', 'neon', 'secret', 'gentle', 'cosmic',
];
const NOUNS = [
  'fox', 'comet', 'moth', 'owl', 'echo', 'tide', 'lantern', 'raven',
  'pebble', 'sparrow', 'ember', 'orbit', 'willow', 'koi', 'cloud', 'otter',
];

/** A uniform index below `n`, from the platform CSPRNG. */
function pick(n) {
  const buf = new Uint32Array(1);
  globalThis.crypto.getRandomValues(buf);
  return buf[0] % n;
}

/**
 * A few ready-made names to tap instead of typing. Not secrets — the CSPRNG is
 * only used because the codebase keeps `Math.random` out of anything id-like.
 */
export function suggestHandles(count = 3) {
  const out = new Set();
  let guard = 0;
  while (out.size < count && guard++ < 50) {
    const sep = pick(2) === 0 ? '.' : '_';
    const handle = `${ADJECTIVES[pick(ADJECTIVES.length)]}${sep}${NOUNS[pick(NOUNS.length)]}${10 + pick(90)}`;
    if (validateHandle(handle).ok) out.add(handle);
  }
  return [...out];
}
