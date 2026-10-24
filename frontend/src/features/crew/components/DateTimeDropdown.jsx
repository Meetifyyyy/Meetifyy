import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Check } from '@shared/components/icons';
import styles from './DateTimeDropdown.module.css';

/**
 * A compact select for the Create Activity date & time dialog.
 *
 * It looks like the shared CustomSelect, but its list is portalled into
 * `container` (the dialog's overlay) rather than <body>: the dialog is always
 * dark (`data-theme="dark"` on the overlay), and a list portalled to <body>
 * took the app's theme instead — a white list over the dark dialog in the light
 * theme. Escape and an outside press close the list only, not the dialog.
 */
export default function DateTimeDropdown({ value, options, onChange, placeholder, ariaLabel, container }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);
  const triggerRef = useRef(null);
  const listRef = useRef(null);
  const listId = useId();
  const selected = options.find((o) => String(o.value) === String(value));

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;
    const r = triggerRef.current.getBoundingClientRect();
    const vh = window.innerHeight;
    const vw = window.innerWidth;
    const width = Math.max(r.width, 120);
    const below = vh - r.bottom;
    const up = below < 240 && r.top > below;
    setPos({
      left: Math.max(8, Math.min(r.left, vw - width - 8)),
      width,
      top: up ? undefined : r.bottom + 4,
      bottom: up ? vh - r.top + 4 : undefined,
      maxHeight: Math.min(260, (up ? r.top : below) - 12),
    });
  }, [open]);

  // Open on the chosen option, centred.
  useLayoutEffect(() => {
    if (!open || !pos || !listRef.current) return;
    const el = listRef.current.querySelector('[aria-selected="true"]')
      || listRef.current.querySelector('[aria-disabled="false"]');
    if (el) listRef.current.scrollTop = el.offsetTop - listRef.current.clientHeight / 2 + el.offsetHeight / 2;
  }, [open, pos]);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (listRef.current?.contains(e.target) || triggerRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); triggerRef.current?.focus(); }
    };
    const onResize = () => setOpen(false);
    document.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', onResize);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('resize', onResize);
    };
  }, [open]);

  const pick = (opt) => {
    if (opt.disabled) return;
    onChange(opt);
    setOpen(false);
    triggerRef.current?.focus();
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={`${styles.trigger} ${open ? styles.open : ''}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={ariaLabel}
        onClick={() => setOpen((v) => !v)}
      >
        <span className={`${styles.label} ${selected ? '' : styles.placeholder}`}>
          {selected ? selected.label : placeholder}
        </span>
        <ChevronDown size={14} className={`${styles.icon} ${open ? styles.iconOpen : ''}`} aria-hidden="true" />
      </button>
      {open && createPortal(
        <div
          ref={listRef}
          id={listId}
          role="listbox"
          aria-label={ariaLabel}
          className={styles.list}
          style={pos ? { ...pos } : { visibility: 'hidden' }}
          onClick={(e) => e.stopPropagation()}
        >
          {options.map((opt) => {
            const isSel = String(opt.value) === String(value);
            return (
              <div
                key={opt.value}
                role="option"
                aria-selected={isSel}
                aria-disabled={!!opt.disabled}
                className={`${styles.option} ${isSel ? styles.selected : ''} ${opt.disabled ? styles.disabled : ''}`}
                onClick={() => pick(opt)}
              >
                <span>{opt.label}</span>
                {isSel && <Check size={13} aria-hidden="true" className={styles.check} />}
              </div>
            );
          })}
        </div>,
        container || document.body,
      )}
    </>
  );
}
