import { createHash } from 'crypto';
import { countChars } from '../common/validation/text-length.util';

export const HANDLE_MIN = 3;
export const HANDLE_MAX = 20;
export const CONFESSION_MIN_CHARS = 10;
export const CONFESSION_MAX_CHARS = 1000;
/** Distinct reporters after which a confession is hidden pending review. */
export const CONFESSION_AUTO_HIDE_REPORTERS = 5;
/** Same content by the same profile inside this window is a duplicate. */
export const DUPLICATE_WINDOW_MS = 24 * 60 * 60 * 1000;

const HANDLE_PATTERN = /^[A-Za-z][A-Za-z0-9_.]{2,19}$/;

export const RESERVED_HANDLES: ReadonlySet<string> = new Set([
  'admin',
  'administrator',
  'moderator',
  'mod',
  'meetifyy',
  'support',
  'staff',
  'official',
  'system',
  'anonymous',
  'null',
  'undefined',
  'root',
  'help',
  'team',
]);

export type HandleProblem = 'invalid' | 'reserved';

/** Lower-cased form used for uniqueness and comparisons. */
export function handleKey(handle: string): string {
  return handle.toLowerCase();
}

/**
 * Checks a handle against the format and reserved-word rules. `ownUsername`
 * is the caller's real username: a handle equal to it (case-insensitively)
 * would de-anonymise them, so it is treated as reserved.
 */
export function checkHandle(
  handle: string,
  ownUsername: string | null,
): HandleProblem | null {
  if (handle.length < HANDLE_MIN || handle.length > HANDLE_MAX) {
    return 'invalid';
  }
  if (!HANDLE_PATTERN.test(handle)) return 'invalid';
  if (/[._]{2}/.test(handle)) return 'invalid';
  if (/[._]$/.test(handle)) return 'invalid';
  const key = handleKey(handle);
  if (RESERVED_HANDLES.has(key)) return 'reserved';
  if (ownUsername && key === ownUsername.toLowerCase()) return 'reserved';
  return null;
}

/**
 * Plain-text normalisation: no control characters (newlines aside), tabs as
 * spaces, CRLF folded to LF, at most one blank line in a row, trimmed.
 *
 * Angle brackets are NOT stripped. A confession is stored and served as plain
 * text and every client renders it as text, so markup is inert; and the
 * shared `stripTags` treats a lone "<" as the start of a tag running to the
 * end of the string, which silently cut "I <3 this place" down to "I ".
 */
export function normaliseConfession(raw: string): string {
  return dropControls(raw.replace(/\r\n?/g, '\n').replace(/\t/g, ' '))
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** C0 (except LF), DEL, C1, zero-width and bidi format controls. */
function isDroppedControl(cp: number): boolean {
  if (cp === 0x0a) return false;
  return (
    cp <= 0x1f ||
    (cp >= 0x7f && cp <= 0x9f) ||
    // ZWNJ/ZWJ (200C/200D) are kept: emoji sequences and some scripts need them.
    cp === 0x200b ||
    cp === 0x200e ||
    cp === 0x200f ||
    (cp >= 0x202a && cp <= 0x202e) ||
    (cp >= 0x2066 && cp <= 0x2069) ||
    cp === 0xfeff
  );
}

function dropControls(text: string): string {
  let out = '';
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0;
    if (!isDroppedControl(cp)) out += ch;
  }
  return out;
}

/** True when normalised content is within the allowed length. */
export function confessionLengthOk(content: string): boolean {
  const n = countChars(content);
  return n >= CONFESSION_MIN_CHARS && n <= CONFESSION_MAX_CHARS;
}

/** sha256 of the content, case- and whitespace-insensitive. */
export function confessionHash(content: string): string {
  const canonical = content.toLowerCase().replace(/\s+/g, ' ').trim();
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}
