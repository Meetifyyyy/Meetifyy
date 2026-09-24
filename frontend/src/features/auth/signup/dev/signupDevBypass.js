/**
 * TEMPORARY — local signup-flow bypass for reviewing the step UI.
 *
 * On only when BOTH hold:
 *   1. `import.meta.env.DEV` — true under `vite` (the dev server) and false in
 *      every `vite build`. Vite replaces it with a literal, so in a production
 *      bundle this whole expression is `false` and the switcher and the guard
 *      bypass are removed as dead code, not merely hidden.
 *   2. Not under Vitest (MODE 'test'), so the tests exercise the real guards.
 *   3. The page is served from this machine (localhost / 127.0.0.1 / ::1), so
 *      a dev server exposed on the LAN or through a tunnel does not offer it.
 *
 * What it does: skips the "you haven't filled in step N-1" redirects in
 * SignupContext and shows a floating step switcher. It does not fake any
 * backend call — submitting a step still hits the real (dev) API.
 *
 * Delete this folder and its two call sites when the review is done.
 */
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

export const SIGNUP_DEV_BYPASS =
  import.meta.env.DEV &&
  // Vitest also runs with DEV=true on "localhost"; the guard tests must see
  // the real guards.
  import.meta.env.MODE !== 'test' &&
  typeof window !== 'undefined' &&
  LOCAL_HOSTS.has(window.location.hostname);
