import PropTypes from 'prop-types';
import styles from './HeaderScrollEdge.module.css';

/**
 * Rounds the line where scrolling content passes under the sticky header.
 *
 * Purely decorative and inert — see the stylesheet for what it draws and why it
 * is an overlay rather than a clip. Render it as the FIRST child of the column
 * whose content scrolls under the header, and outside any ancestor with
 * `overflow: hidden`: that would both clip it and re-anchor its `position:
 * sticky` to that ancestor instead of the viewport.
 *
 * `gap` is the flex/grid gap of the parent, which the element cancels along
 * with its own height so it never occupies layout space.
 */
export default function HeaderScrollEdge({ gap = '0px' }) {
  return (
    <div
      className={styles.edge}
      style={{ '--edge-gap': gap }}
      aria-hidden="true"
      // Marks this as a zero-height decorative overlay rather than page content.
      // `.centre--sheet > *` on mobile stretches the sheet's children to 100dvh;
      // without this the edge was stretched too, and on the post route that
      // pushed the post a full screen down — see global.css.
      data-sheet-overlay=""
    />
  );
}

HeaderScrollEdge.propTypes = {
  gap: PropTypes.string,
};
