import { cloneElement } from 'react';
import styles from './NavIcon.module.css';

/**
 * One navigation icon rendered as two stacked layers -- the outline variant and
 * the solid variant -- with the active one faded in.
 *
 * Both navigations previously did `{isActive ? <Solid /> : <Outline />}`, which
 * unmounts one icon and mounts the other. That swap is instantaneous by
 * construction: there is no shared element left on screen for a transition to
 * run against, so the active state snapped. Keeping both layers mounted and
 * animating opacity/scale between them is what makes the fill read as a smooth
 * change rather than a flicker, and it stays correct on every route change
 * because it is driven purely by the `active` prop.
 *
 * Takes already-rendered elements, so callers keep using the exact icon
 * components they already import -- this adds no icons and swaps none. The
 * layer classes are cloned onto the icons themselves rather than onto wrapper
 * elements, so each <svg> stays a direct child of the stack and the existing
 * `> svg` sizing rules in both navigations keep applying untouched.
 *
 * `className` lets the caller's own stylesheet address the stack (both nav
 * stylesheets size their icons through it).
 */
export default function NavIcon({ outline, solid, active, className = '' }) {
  const layer = (icon, isShown) =>
    cloneElement(icon, {
      className: [styles.layer, isShown ? styles.shown : styles.hidden, icon.props.className]
        .filter(Boolean)
        .join(' '),
    });

  return (
    <span className={`${styles.navIcon} ${className}`.trim()} aria-hidden="true">
      {layer(outline, !active)}
      {layer(solid, active)}
    </span>
  );
}
