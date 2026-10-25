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

/**
 * Whether a handle seems to contain part of the person's real name, username
 * or email — something a classmate could trace back to them.
 *
 * Advisory only: it drives a warning, never a refusal, so it leans towards
 * saying nothing. Name pieces of four or more letters count anywhere in the
 * handle ("priya" in "priya_writes"); three-letter ones only as a whole piece
 * of it ("sam.owl", not "samosa"); a run of three or more digits counts when
 * the same run is in the email or username (a roll number, a birth year).
 * Accents and case are ignored. Only the local part of an email is used —
 * the domain is the college's and says nothing about the person.
 *
 * `identity` is `{ names, emails }`, both arrays of strings; empty or missing
 * values are ignored.
 */
export function looksIdentifying(handle, identity) {
  const h = fold(typeof handle === 'string' ? handle : '');
  if (h.length < HANDLE_MIN) return false;
  const hLetters = h.replace(/[^a-z]/g, '');
  const hPieces = new Set(h.split(/[^a-z]+/).filter(Boolean));
  const hDigits = h.match(/\d{3,}/g) ?? [];

  const words = new Set();
  const digitRuns = [];
  const addFrom = (text) => {
    const folded = fold(text);
    for (const w of folded.split(/[^a-z]+/)) {
      if (w.length >= 3 && !COMMON_PIECES.has(w)) words.add(w);
    }
    digitRuns.push(...(folded.match(/\d{3,}/g) ?? []));
  };
  const { names = [], emails = [] } = identity ?? {};
  for (const name of names) {
    if (typeof name !== 'string' || !name.trim()) continue;
    addFrom(name);
    // "Priya Sharma" also as "priyasharma", the way people join names.
    const joined = fold(name).replace(/[^a-z]/g, '');
    if (joined.length >= 4) words.add(joined);
  }
  for (const email of emails) {
    if (typeof email !== 'string') continue;
    const local = email.split('@')[0] ?? '';
    if (local) addFrom(local);
  }

  for (const w of words) {
    if (w.length >= 4 ? hLetters.includes(w) : hPieces.has(w)) return true;
  }
  return hDigits.some((run) => digitRuns.some((d) => d.includes(run)));
}

/** Lower-cased, accents removed: "Zoë" and "zoe" are the same name. */
function fold(text) {
  return String(text).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

/**
 * Pieces of names and email addresses that identify nobody, so a handle that
 * shares one is not flagged ("student" in s.priya.student@…).
 */
const COMMON_PIECES = new Set([
  'the', 'and', 'mail', 'email', 'info', 'contact', 'student', 'students',
  'user', 'official', 'college', 'univ', 'university', 'campus', 'admin',
  'office', 'dept', 'hello', 'test', 'kumar', 'kumari', 'devi', 'singh',
]);

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
