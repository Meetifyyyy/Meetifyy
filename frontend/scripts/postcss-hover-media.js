/**
 * PostCSS plugin to automatically wrap all unscoped `:hover` selectors
 * in `@media (hover: hover) and (pointer: fine)` queries.
 *
 * This ensures hover effects only apply on devices that support true pointer hover (desktop/mouse)
 * and eliminates sticky hover states on mobile and touch devices.
 */
export function postcssHoverMedia(opts = {}) {
  const mediaQuery = opts.mediaQuery || '(hover: hover) and (pointer: fine)';

  return {
    postcssPlugin: 'postcss-hover-media',
    Once(root, { AtRule }) {
      const isInsideHoverMedia = (node) => {
        let parent = node.parent;
        while (parent) {
          if (parent.type === 'atrule' && parent.name === 'media' && (parent.params.includes('hover') || parent.params.includes('pointer'))) {
            return true;
          }
          parent = parent.parent;
        }
        return false;
      };

      const rulesToProcess = [];
      root.walkRules((rule) => {
        if (!rule.selector || !rule.selector.includes(':hover')) return;
        // Skip keyframes rules
        if (rule.parent && rule.parent.type === 'atrule' && rule.parent.name && rule.parent.name.includes('keyframes')) return;
        // Skip rules already inside hover / pointer media queries
        if (isInsideHoverMedia(rule)) return;

        rulesToProcess.push(rule);
      });

      for (const rule of rulesToProcess) {
        const selectors = rule.selectors;
        const hoverSelectors = [];
        const nonHoverSelectors = [];

        for (const sel of selectors) {
          if (sel.includes(':hover')) {
            hoverSelectors.push(sel);
          } else {
            nonHoverSelectors.push(sel);
          }
        }

        if (nonHoverSelectors.length > 0) {
          // Rule contains mixed selectors (e.g. `.btn:hover, .btn.active` or `.btn:hover, .btn:active`)
          // Preserve non-hover selectors top-level and move hover selectors to media query
          rule.selectors = nonHoverSelectors;
          const hoverRule = rule.clone({ selectors: hoverSelectors });
          const media = new AtRule({
            name: 'media',
            params: mediaQuery,
            nodes: [hoverRule]
          });
          rule.after(media);
        } else {
          // Pure hover rule - wrap completely in media query
          const media = new AtRule({
            name: 'media',
            params: mediaQuery,
            nodes: [rule.clone()]
          });
          rule.replaceWith(media);
        }
      }
    }
  };
}

postcssHoverMedia.postcss = true;
export default postcssHoverMedia;
