import React, { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown } from './icons';
import './Dropdown.css';

/** Native option/value/change contracts with one shared, accessible popup UI. */
export type DropdownProps = Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'multiple' | 'size'> & { menuClassName?: string };
type Option = { value: string; label: string; disabled: boolean };

export function Dropdown({ children, className = '', menuClassName = '', style, id, value, defaultValue, disabled, onInvalid, ...props }: DropdownProps) {
  const generatedId = useId();
  const controlId = id || `dropdown-${generatedId}`;
  const listId = `${controlId}-list`;
  const rootRef = useRef<HTMLDivElement>(null);
  const nativeRef = useRef<HTMLSelectElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef({ text: '', time: 0 });
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<Option[]>([]);
  const [nativeValue, setNativeValue] = useState(String(defaultValue ?? ''));
  const [active, setActive] = useState(-1);
  const [position, setPosition] = useState<React.CSSProperties>({});
  const selectedValue = value === undefined ? nativeValue : String(value);
  const selected = options.find((option) => option.value === selectedValue);

  // Read the native options so callers retain their existing mapped JSX options.
  useLayoutEffect(() => {
    const select = nativeRef.current;
    if (!select) return;
    const next = Array.from(select.options, (option) => ({
      value: option.value,
      label: option.label,
      disabled: option.disabled || (option.parentElement instanceof HTMLOptGroupElement && option.parentElement.disabled),
    }));
    setOptions(next);
    if (!next.some((option) => !option.disabled)) setOpen(false);
    setActive((current) => next[current] && !next[current].disabled ? current : next.findIndex((option) => !option.disabled));
    if (value === undefined) setNativeValue(select.value);
  }, [children, value]);

  useLayoutEffect(() => {
    if (!open || disabled) return;
    const update = () => {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) return;
      if (rect.bottom <= 0 || rect.top >= window.innerHeight) { setOpen(false); return; }
      const viewport = document.documentElement.clientWidth || window.innerWidth;
      const width = Math.min(rect.width, viewport - 16);
      const below = window.innerHeight - rect.bottom - 14;
      const above = rect.top - 14;
      const upward = below < 180 && above > below;
      setPosition({
        width,
        left: Math.max(8, Math.min(rect.left, viewport - width - 8)),
        top: upward ? undefined : rect.bottom + 6,
        bottom: upward ? window.innerHeight - rect.top + 6 : undefined,
        maxHeight: Math.max(40, Math.min(280, upward ? above : below)),
      });
    };
    update();
    const outside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node) && !menuRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onScroll = (event: Event) => {
      if (!menuRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', outside, true);
    window.addEventListener('resize', update);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      document.removeEventListener('pointerdown', outside, true);
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [open, disabled]);

  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);
  useEffect(() => {
    const menu = menuRef.current;
    const option = menu?.querySelector<HTMLElement>(`[data-index="${active}"]`);
    if (!open || !menu || !option) return;
    // Scroll only the popup: scrollIntoView can also move the app's viewport.
    const top = option.offsetTop;
    const bottom = top + option.offsetHeight;
    if (top < menu.scrollTop) menu.scrollTop = top;
    else if (bottom > menu.scrollTop + menu.clientHeight) menu.scrollTop = bottom - menu.clientHeight;
  }, [active, open]);

  const openMenu = (fromEnd = false) => {
    if (disabled || !options.some((option) => !option.disabled)) return;
    const selectedIndex = options.findIndex((option) => option.value === selectedValue && !option.disabled);
    const first = options.findIndex((option) => !option.disabled);
    const last = options.map((option) => option.disabled).lastIndexOf(false);
    setActive(selectedIndex >= 0 ? selectedIndex : fromEnd ? last : first);
    searchRef.current = { text: '', time: 0 };
    setOpen(true);
  };

  const choose = (index: number) => {
    const option = options[index];
    const select = nativeRef.current;
    if (!option || option.disabled || !select || disabled) return;
    if (select.value !== option.value) {
      // Dispatch a real select change: callers receive their original event type.
      select.value = option.value;
      setNativeValue(option.value);
      select.dispatchEvent(new Event('change', { bubbles: true }));
    }
    setOpen(false);
    triggerRef.current?.focus({ preventScroll: true });
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'Tab') { setOpen(false); return; }
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setOpen(false); return; }
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      if (!open) {
        openMenu(event.key === 'ArrowUp' || event.key === 'End');
        if (event.key === 'Home') setActive(options.findIndex((option) => !option.disabled));
        if (event.key === 'End') setActive(options.map((option) => option.disabled).lastIndexOf(false));
        return;
      }
      const available = options.flatMap((option, index) => option.disabled ? [] : [index]);
      const current = available.indexOf(active);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? available.length - 1
        : (current + (event.key === 'ArrowDown' ? 1 : -1) + available.length) % available.length;
      setActive(available[next] ?? -1);
      return;
    }
    if (event.key === 'Enter' || (event.key === ' ' && (!searchRef.current.text || Date.now() - searchRef.current.time > 600))) {
      event.preventDefault();
      if (open) choose(active); else openMenu();
      return;
    }
    if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      const now = Date.now();
      const text = (now - searchRef.current.time > 600 ? '' : searchRef.current.text) + event.key.toLowerCase();
      searchRef.current = { text, time: now };
      const repeated = text.split('').every((character) => character === text[0]);
      const prefix = repeated ? text[0] : text;
      const start = repeated ? active + 1 : 0;
      const match = options.findIndex((_, offset) => {
        const option = options[(start + offset) % options.length];
        return !option.disabled && option.label.toLowerCase().startsWith(prefix);
      });
      if (match >= 0) { setActive((start + match) % options.length); setOpen(true); }
    }
  };

  return (
    <div ref={rootRef} className={`admin-dropdown ${className.replace(/\binput-control\b/g, '').trim()}`} style={style}>
      <select
        {...props}
        id={`${controlId}-native`}
        ref={nativeRef}
        className="admin-dropdown-native"
        aria-hidden="true"
        tabIndex={-1}
        onFocus={(event) => { props.onFocus?.(event); triggerRef.current?.focus({ preventScroll: true }); }}
        onClick={(event) => { props.onClick?.(event); event.preventDefault(); triggerRef.current?.focus({ preventScroll: true }); }}
        value={value}
        defaultValue={defaultValue}
        disabled={disabled}
        onInvalid={(event) => { onInvalid?.(event); if (!event.defaultPrevented) { event.preventDefault(); triggerRef.current?.focus({ preventScroll: true }); } }}
      >{children}</select>
      <button
        ref={triggerRef}
        id={controlId}
        type="button"
        title={selected?.label}
        role="combobox"
        className="admin-dropdown-trigger"
        disabled={disabled}
        aria-label={props['aria-label']}
        aria-labelledby={props['aria-labelledby']}
        aria-describedby={props['aria-describedby']}
        aria-invalid={props['aria-invalid']}
        aria-required={props.required}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open && active >= 0 ? `${listId}-${active}` : undefined}
        onClick={() => open ? setOpen(false) : openMenu()}
        onKeyDown={onKeyDown}
        onBlur={() => setOpen(false)}
      >
        <span className="admin-dropdown-value">{selected?.label || '\u00a0'}</span>
        <ChevronDown size={16} aria-hidden="true" />
      </button>
      {open && !disabled && createPortal(
        <div ref={menuRef} id={listId} role="listbox" aria-label={props['aria-label']} aria-labelledby={props['aria-labelledby']} className={`admin-dropdown-menu ${menuClassName}`} style={position}>
          {options.map((option, index) => (
            <div key={`${option.value}-${index}`} id={`${listId}-${index}`} role="option" aria-selected={option.value === selectedValue} aria-disabled={option.disabled || undefined} data-index={index}
              className={`admin-dropdown-option${index === active ? ' is-highlighted' : ''}`}
              onPointerDown={(event) => event.preventDefault()}
              onPointerMove={() => { if (!option.disabled) setActive(index); }}
              onClick={() => choose(index)}>
              <span>{option.label}</span>
              {option.value === selectedValue && <Check size={15} aria-hidden="true" />}
            </div>
          ))}
        </div>,
        rootRef.current?.closest('[role="dialog"]') || document.body,
      )}
    </div>
  );
}
