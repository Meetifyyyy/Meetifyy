/**
 * The build settings that must not differ between the web and mobile targets.
 *
 * Two Vite configs exist so the web bundle can carry the PWA and the SEO
 * prerender while the native bundle carries neither — but a few things are not
 * a difference between clients, they are a difference that would be a bug.
 * An import alias that resolves in one target and not the other, or a CSS
 * transform applied to one, produces a failure that only appears on one
 * platform and looks like a platform problem rather than a config drift.
 *
 * So: anything here is shared by construction. Anything a target genuinely
 * needs to decide for itself stays in that target's own config, where the
 * decision is visible.
 *
 * NOTE ON FILE NAMES. `vite.config.js` is the WEB config and keeps that name
 * rather than becoming `vite.web.config.js`. Vite, Vitest and Vercel all
 * resolve `vite.config.js` by default, so renaming it would mean threading
 * `--config` through the dev server, the test runner and the deploy — churn for
 * symmetry. The mobile target is the one that opts in, which is also the
 * accurate description of the situation.
 */
import path from 'path';
import { postcssHoverMedia } from './scripts/postcss-hover-media.js';

/**
 * Import aliases, shared because a module must mean the same thing everywhere.
 *
 * `@core` and `@platform` come first because their direction is the one that
 * matters: client code may import them, and they may not import client code
 * back. That rule is enforced in eslint.config.js, not here — an alias grants
 * access, it cannot withhold it.
 *
 * @param {string} root absolute path to the frontend package
 */
export const sharedAliases = (root) => ({
  '@core': path.resolve(root, 'src/core'),
  '@platform': path.resolve(root, 'src/platform'),

  '@config': path.resolve(root, 'src/config'),
  '@stores': path.resolve(root, 'src/shared/stores'),
  '@shared': path.resolve(root, 'src/shared'),
  '@layout': path.resolve(root, 'src/layout'),
  '@features': path.resolve(root, 'src/features'),
  '@styles': path.resolve(root, 'src/styles'),
  '@constants': path.resolve(root, 'src/constants'),
  '@assets': path.resolve(root, 'src/assets'),
});

/**
 * `:hover` is wrapped in a capability query so a tap on a touch device does not
 * leave the hover state stuck on the element it landed on. That is a property
 * of the stylesheets, not of the target, so both get it.
 */
export const sharedCss = {
  postcss: {
    plugins: [postcssHoverMedia({ mediaQuery: '(hover: hover) and (pointer: fine)' })],
  },
};

/**
 * Two warnings Rollup emits that are noise here, silenced identically in both
 * targets so a real warning stands out in either build log.
 */
export function sharedOnWarn(warning, warn) {
  if (
    warning.message?.includes('externalized for browser compatibility') ||
    warning.code === 'MODULE_LEVEL_DIRECTIVE'
  ) {
    return;
  }
  warn(warning);
}
