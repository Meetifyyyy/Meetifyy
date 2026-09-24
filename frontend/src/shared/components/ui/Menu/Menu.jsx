import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { IS_MOBILE_BUILD } from '@config';
import useMenuPosition from './useMenuPosition';
import styles from './Menu.module.css';

/**
 * The app's dropdown / context menu. One implementation, every menu.
 *
 * WHAT IT REPLACES
 * Every action menu used to bring its own: the post and comment menus rendered
 * a global `.dropdown` class with inline styles, the crew card and chat
 * details each had their own `.dropdownMenu`/`.dropdownItem` pair, the header
 * had a third, and the three context menus shared a positioning helper that
 * lived inside one of them. They disagreed on padding, radius, shadow, hover,
 * whether they were portalled, and whether they handled the viewport edge at
 * all.
 *
 * WHY A PORTAL, ALWAYS
 * A menu rendered inside its trigger is clipped by any ancestor with
 * `overflow: hidden` and stacked by any ancestor with a z-index — both of
 * which are everywhere in a feed of cards and a scrolling sidebar. Portalling
 * to <body> and positioning in viewport coordinates is what makes one
 * component work in all of those places instead of needing a variant per
 * container.
 *
 * ANCHOR OR POINT
 * `anchorRef` hangs the menu off a trigger (the ⋯ button). `point` places it
 * at a press location (long-press, right-click). Exactly one is given; both go
 * through the same clamping and flipping.
 *
 * A REF, not an element: the trigger's node is null on the render that first
 * opens the menu, so passing `ref.current` would hand over a stale null and the
 * menu would place itself against nothing exactly once — on the open.
 *
 * MOBILE MOTION ONLY
 * The open/close animation is gated on `IS_MOBILE_BUILD`, the build-time
 * literal the API origin and pull-to-refresh already use, so the website's
 * menus appear the way they always have and the installed app gets the motion.
 * Vite replaces it with a constant, so the class is not even in the web bundle.
 */
export default function Menu({
  open,
  onClose,
  anchorRef = null,
  point = null,
  align = 'end',
  size = 'md',
  ariaLabel = 'Menu',
  children,
}) {
  const menuRef = useRef(null);

  // The item count changes the height, and the height changes the placement.
  const sizeSignal = Array.isArray(children) ? children.length : 1;
  const coords = useMenuPosition({ open, menuRef, anchorRef, point, align, deps: sizeSignal });

  /*
   * Dismissal: outside press, Escape, and the Android back button.
   *
   * `pointerdown` rather than `click`, so the menu closes on the press that
   * begins an interaction elsewhere rather than on the release — a click
   * listener lets the underlying control receive a press while the menu is
   * still up, which on touch reads as the menu swallowing the first tap.
   *
   * `capture: true` because a trigger that calls `stopPropagation` — and most
   * of them do, to stop the card underneath handling the same click — would
   * otherwise prevent the document from ever hearing about it.
   */
  useEffect(() => {
    if (!open) return undefined;

    const onPointerDown = (e) => {
      if (menuRef.current?.contains(e.target)) return;
      if (anchorRef?.current?.contains?.(e.target)) return; // let the trigger toggle
      onClose?.();
    };
    const onKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose?.();
      }
    };
    const onPopState = () => onClose?.();

    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('popstate', onPopState);

    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('popstate', onPopState);
    };
  }, [open, onClose, anchorRef]);

  if (!open) return null;

  return createPortal(
    <div
      ref={menuRef}
      role="menu"
      aria-label={ariaLabel}
      className={[
        styles.menu,
        styles[size],
        // Drives `transform-origin` so the menu grows out of the corner it is
        // anchored to rather than from its own middle.
        align === 'start' ? styles.start : '',
        // Motion in the app only; the website keeps the appearance it had.
        IS_MOBILE_BUILD ? styles.animated : '',
        coords.ready ? styles.ready : '',
      ]
        .filter(Boolean)
        .join(' ')}
      style={{ left: coords.x, top: coords.y }}
      /*
       * Stops a press inside the menu reaching the card, row or stage
       * underneath it. Every call site used to do this by hand on every single
       * item; doing it once here is most of why the call sites get shorter.
       */
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {children}
    </div>,
    document.body,
  );
}

/**
 * One row of a menu.
 *
 * Closing is the component's job, not the caller's: every old implementation
 * had to remember `setShowMenu(false)` inside each handler, and the ones that
 * forgot left the menu open over whatever the action had just done.
 *
 * @param {object} props
 * @param {React.ComponentType} [props.icon] a glyph from `@shared/components/icons`
 * @param {'default'|'danger'} [props.tone]
 */
export function MenuItem({
  icon: Icon,
  children,
  onSelect,
  onClose,
  tone = 'default',
  disabled = false,
  ...rest
}) {
  const handle = useCallback(
    (e) => {
      e.stopPropagation();
      if (disabled) return;
      onSelect?.(e);
      onClose?.();
    },
    [disabled, onSelect, onClose],
  );

  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={handle}
      className={`${styles.item} ${tone === 'danger' ? styles.danger : ''}`}
      {...rest}
    >
      {Icon ? <Icon size={18} className={styles.itemIcon} aria-hidden="true" /> : null}
      <span className={styles.itemLabel}>{children}</span>
    </button>
  );
}

/** A hairline between groups of items. */
export function MenuSeparator() {
  return <div className={styles.separator} role="separator" />;
}

/**
 * Open/close state, the trigger's ref, and the props to spread on each.
 *
 * Bundled because every call site needs the same three things, and wiring them
 * by hand is where the old implementations diverged — some closed on Escape,
 * some did not; some stopped propagation on the trigger, some did not.
 *
 *   const menu = useMenu();
 *   <button {...menu.triggerProps}><MoreHorizontal /></button>
 *   <Menu {...menu.menuProps}>
 *     <MenuItem icon={Trash2} tone="danger" onSelect={remove} onClose={menu.close}>
 *       Delete
 *     </MenuItem>
 *   </Menu>
 */
export function useMenu() {
  const triggerRef = useRef(null);
  const [open, setOpen] = useState(false);

  const close = useCallback(() => setOpen(false), []);
  const toggle = useCallback((e) => {
    e?.stopPropagation?.();
    setOpen((v) => !v);
  }, []);

  return useMemo(
    () => ({
      open,
      close,
      toggle,
      triggerRef,
      triggerProps: {
        ref: triggerRef,
        onClick: toggle,
        'aria-haspopup': 'menu',
        'aria-expanded': open,
      },
      // The ref object itself, so the menu reads the node when it places
      // itself rather than whatever it was on the render that opened it.
      menuProps: { open, onClose: close, anchorRef: triggerRef },
    }),
    [open, close, toggle],
  );
}
