/**
 * Version comparison for the update gate.
 *
 * Lives in `core/` because it is pure arithmetic on strings, it is the part of
 * the gate most likely to be wrong in a way nobody notices, and it must behave
 * identically wherever the gate is run.
 *
 * WHY NOT A SEMVER LIBRARY
 * The only versions compared here are the ones this repo produces: Android's
 * `versionName` and iOS's `CFBundleShortVersionString`, both of which are
 * `MAJOR.MINOR.PATCH` of plain integers, because that is all either store
 * accepts. A full semver parser brings prerelease ordering, build metadata and
 * range syntax — none of which can appear here, all of which is surface area.
 *
 * WHAT MUST NEVER HAPPEN
 * An unparseable or missing version must never lock someone out. A gate that
 * fails closed on its own bad input turns a typo in an environment variable
 * into every user of the app being unable to open it, with no way to push a
 * fix to them — which is precisely the situation the gate exists to avoid.
 * Every function here fails open.
 */

/**
 * Splits a version into numbers. Returns null for anything it cannot read,
 * which every caller treats as "do not gate".
 *
 * @param {unknown} value
 * @returns {number[] | null}
 */
export function parseVersion(value) {
  if (typeof value !== 'string') return null;

  const trimmed = value.trim();
  if (!trimmed) return null;

  // A store version is digits and dots. Anything else — a `v` prefix, a
  // `-beta` suffix, a commit sha someone pasted in — is not something this
  // should guess at.
  if (!/^\d+(\.\d+)*$/.test(trimmed)) return null;

  const parts = trimmed.split('.').map((p) => Number.parseInt(p, 10));
  return parts.some((n) => !Number.isFinite(n)) ? null : parts;
}

/**
 * -1 / 0 / 1, or null when either side is unreadable.
 *
 * Missing segments count as zero, so `1.2` and `1.2.0` are the same version.
 * Android and iOS both allow a two-segment version and this repo has shipped
 * `1.0`, so treating them as different would gate a build against itself.
 *
 * @param {unknown} a
 * @param {unknown} b
 * @returns {-1 | 0 | 1 | null}
 */
export function compareVersions(a, b) {
  const left = parseVersion(a);
  const right = parseVersion(b);
  if (!left || !right) return null;

  const length = Math.max(left.length, right.length);
  for (let i = 0; i < length; i++) {
    const l = left[i] ?? 0;
    const r = right[i] ?? 0;
    if (l < r) return -1;
    if (l > r) return 1;
  }
  return 0;
}

/**
 * What the app should do about the version it is running.
 *
 * Three outcomes rather than a boolean, because "must update" and "could
 * update" are different conversations with the user: one is a wall, the other
 * is a dismissible nudge. Collapsing them is how a gate ends up forcing an
 * upgrade for every routine release.
 *
 * `'ok'` is returned for every uncertainty: no version in hand, an unreadable
 * threshold, a server that did not answer. See the note at the top.
 *
 * @param {object} args
 * @param {unknown} args.current    the running build's version
 * @param {unknown} args.minimum    below this, the app must not be used
 * @param {unknown} args.latest     below this, an update exists
 * @returns {'blocked' | 'outdated' | 'ok'}
 */
export function evaluateVersion({ current, minimum, latest }) {
  const belowMinimum = compareVersions(current, minimum);
  if (belowMinimum === -1) return 'blocked';

  const belowLatest = compareVersions(current, latest);
  if (belowLatest === -1) return 'outdated';

  return 'ok';
}

export default evaluateVersion;
