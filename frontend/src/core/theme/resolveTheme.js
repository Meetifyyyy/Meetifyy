/**
 * Which theme the app starts in.
 *
 * THE RULE
 * An explicit choice wins. Failing that, follow the device. The app used to
 * return `'light'` when nothing was stored, so a phone in dark mode opened a
 * white app and stayed there.
 *
 * WHY A SEPARATE FLAG AND NOT JUST "IS ANYTHING STORED"
 * `localStorage.theme` is written on every theme change INCLUDING the ones this
 * function causes — `ThemeContext` persists whatever it settles on, so the
 * stored value is present from the first render whether or not anyone chose it.
 * Treating its presence as consent would mean the device preference is followed
 * exactly once and then frozen forever, which is worse than not following it at
 * all because it looks like it works.
 *
 * `theme_preference_set` is written only by `toggleTheme`, so it means what its
 * name says. It already existed and was never read; this is the reader.
 *
 * KEPT IN `core/` AND PURE
 * It is duplicated, in miniature, by a blocking inline script in `index.html`
 * and `index.mobile.html` — those run before any bundle exists and cannot
 * import this. That duplication is the reason this is written down as one rule
 * with tests: the boot snippet decides the first frame, this decides everything
 * after, and if they disagree the user sees a flash.
 */

/**
 * @param {object} args
 * @param {string|null} [args.stored]        `localStorage.theme`
 * @param {boolean} [args.preferenceSet]     did the user actually choose?
 * @param {boolean} [args.prefersDark]       does the device ask for dark?
 * @returns {'light' | 'dark'}
 */
export function resolveInitialTheme({ stored, preferenceSet, prefersDark } = {}) {
  if (preferenceSet && (stored === 'light' || stored === 'dark')) return stored;
  return prefersDark ? 'dark' : 'light';
}

/**
 * Whether a system theme change should move the app.
 *
 * Only while the user has not chosen for themselves. Someone who picked light
 * on a dark phone means it, and having the OS quietly overrule them at sunset
 * is the bug this prevents.
 */
export function shouldFollowSystem({ preferenceSet } = {}) {
  return !preferenceSet;
}

export default resolveInitialTheme;
