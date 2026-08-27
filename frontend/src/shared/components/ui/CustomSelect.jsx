import { useState, useRef, useEffect, useId, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Check } from '@shared/components/icons';
import styles from './CustomSelect.module.css';

/**
 * Standard accessible custom select dropdown for Meetifyy.
 * Matches Meetifyy's design system with keyboard navigation, portal popovers,
 * error states, and responsive positioning.
 */
export default function CustomSelect({
  id,
  name,
  value,
  options = [],
  onChange,
  placeholder = 'Select an option',
  disabled = false,
  error = false,
  required = false,
  className = '',
  triggerClassName = '',
  style,
  'aria-required': ariaRequired,
  'aria-invalid': ariaInvalid,
  'aria-describedby': ariaDescribedby,
  'aria-label': ariaLabel,
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const [dropdownStyle, setDropdownStyle] = useState({});
  const generatedId = useId();
  const selectId = id || generatedId;
  const listboxId = `${selectId}-listbox`;

  const containerRef = useRef(null);
  const triggerRef = useRef(null);
  const dropdownRef = useRef(null);

  const selectedOption = options.find((opt) => String(opt.value) === String(value));
  const isError = Boolean(error || ariaInvalid);

  const updatePosition = useCallback(() => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const vh = window.visualViewport?.height || window.innerHeight;
    const vw = window.visualViewport?.width || window.innerWidth;
    const spaceBelow = vh - rect.bottom;
    const isTop = spaceBelow < 240 && rect.top > 240;

    setDropdownStyle({
      position: 'fixed',
      top: isTop ? 'auto' : `${Math.round(rect.bottom + 4)}px`,
      bottom: isTop ? `${Math.round(vh - rect.top + 4)}px` : 'auto',
      left: `${Math.max(8, Math.min(rect.left, vw - rect.width - 8))}px`,
      width: `${Math.round(rect.width)}px`,
      zIndex: 99999,
    });
  }, []);

  const openDropdown = () => {
    if (disabled) return;
    updatePosition();
    setIsOpen(true);
    const selectedIdx = options.findIndex((opt) => String(opt.value) === String(value));
    setHighlightedIndex(selectedIdx >= 0 ? selectedIdx : 0);
  };

  const closeDropdown = () => {
    setIsOpen(false);
    setHighlightedIndex(-1);
  };

  const toggleDropdown = () => {
    if (isOpen) {
      closeDropdown();
    } else {
      openDropdown();
    }
  };

  const handleSelect = (opt) => {
    if (opt.disabled || disabled) return;
    if (onChange) {
      onChange({
        target: {
          name,
          value: opt.value,
        },
      });
    }
    closeDropdown();
    triggerRef.current?.focus();
  };

  // Outside click and window scroll/wheel/resize handlers
  useEffect(() => {
    if (!isOpen) return;

    const handleOutsideClick = (e) => {
      // If clicking inside the dropdown or on the trigger, let their own handlers work
      if (
        (containerRef.current && containerRef.current.contains(e.target)) ||
        (dropdownRef.current && dropdownRef.current.contains(e.target))
      ) {
        return;
      }
      closeDropdown();
    };

    const handleExternalScroll = (e) => {
      // If scrolling inside the dropdown list itself, allow normal scrolling through options
      if (dropdownRef.current && dropdownRef.current.contains(e.target)) {
        return;
      }
      // Instantly close if scrolling anywhere outside the dropdown
      closeDropdown();
    };

    const handleWheel = (e) => {
      if (dropdownRef.current && dropdownRef.current.contains(e.target)) {
        return;
      }
      closeDropdown();
    };

    document.addEventListener('mousedown', handleOutsideClick, true);
    document.addEventListener('touchstart', handleOutsideClick, true);
    window.addEventListener('scroll', handleExternalScroll, true);
    window.addEventListener('wheel', handleWheel, { capture: true, passive: true });
    window.addEventListener('resize', handleExternalScroll);
    window.visualViewport?.addEventListener('resize', handleExternalScroll);

    return () => {
      document.removeEventListener('mousedown', handleOutsideClick, true);
      document.removeEventListener('touchstart', handleOutsideClick, true);
      window.removeEventListener('scroll', handleExternalScroll, true);
      window.removeEventListener('wheel', handleWheel, true);
      window.removeEventListener('resize', handleExternalScroll);
      window.visualViewport?.removeEventListener('resize', handleExternalScroll);
    };
  }, [isOpen]);

  // Keyboard navigation
  const handleKeyDown = (e) => {
    if (disabled) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!isOpen) {
        openDropdown();
      } else {
        setHighlightedIndex((prev) => {
          let next = prev + 1;
          while (next < options.length && options[next]?.disabled) next++;
          return next < options.length ? next : prev;
        });
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (!isOpen) {
        openDropdown();
      } else {
        setHighlightedIndex((prev) => {
          let next = prev - 1;
          while (next >= 0 && options[next]?.disabled) next--;
          return next >= 0 ? next : prev;
        });
      }
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (!isOpen) {
        openDropdown();
      } else if (highlightedIndex >= 0 && options[highlightedIndex]) {
        handleSelect(options[highlightedIndex]);
      }
    } else if (e.key === 'Escape') {
      if (isOpen) {
        e.preventDefault();
        closeDropdown();
        triggerRef.current?.focus();
      }
    } else if (e.key === 'Tab') {
      if (isOpen) {
        closeDropdown();
      }
    }
  };

  // Scroll highlighted item into view
  useEffect(() => {
    if (isOpen && highlightedIndex >= 0 && dropdownRef.current) {
      const optionElements = dropdownRef.current.querySelectorAll(`.${styles.option}`);
      const targetElement = optionElements[highlightedIndex];
      if (targetElement) {
        targetElement.scrollIntoView({ block: 'nearest' });
      }
    }
  }, [highlightedIndex, isOpen]);

  return (
    <div
      ref={containerRef}
      className={`${styles.container} ${className}`}
      style={style}
    >
      <button
        ref={triggerRef}
        id={selectId}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-controls={listboxId}
        aria-required={required || ariaRequired}
        aria-invalid={isError}
        aria-describedby={ariaDescribedby}
        aria-label={ariaLabel}
        disabled={disabled}
        className={`${styles.trigger} ${isOpen ? styles.open : ''} ${isError ? styles.error : ''} ${triggerClassName}`}
        onClick={toggleDropdown}
        onKeyDown={handleKeyDown}
      >
        <span
          className={`${styles.label} ${!selectedOption ? styles.placeholder : ''}`}
          title={selectedOption ? selectedOption.label : placeholder}
        >
          {selectedOption ? selectedOption.label : placeholder}
        </span>
        <ChevronDown
          size={16}
          aria-hidden="true"
          className={`${styles.icon} ${isOpen ? styles.iconOpen : ''}`}
        />
      </button>

      {/* Hidden input for standard form submission compatibility */}
      {name && <input type="hidden" name={name} value={value || ''} />}

      {isOpen &&
        createPortal(
          <div
            ref={dropdownRef}
            id={listboxId}
            role="listbox"
            aria-labelledby={selectId}
            className={styles.dropdown}
            style={dropdownStyle}
          >
            {options.map((opt, index) => {
              const isSelected = String(value) === String(opt.value);
              const isHighlighted = highlightedIndex === index;

              return (
                <div
                  key={opt.value}
                  role="option"
                  aria-selected={isSelected}
                  aria-disabled={opt.disabled}
                  className={`${styles.option} ${isSelected ? styles.selected : ''} ${
                    isHighlighted ? styles.highlighted : ''
                  } ${opt.disabled ? styles.disabled : ''}`}
                  onClick={() => handleSelect(opt)}
                  onMouseEnter={() => !opt.disabled && setHighlightedIndex(index)}
                >
                  <span className={styles.optionText}>{opt.label}</span>
                  {isSelected && (
                    <Check
                      size={15}
                      aria-hidden="true"
                      className={styles.checkIcon}
                    />
                  )}
                </div>
              );
            })}
          </div>,
          document.body
        )}
    </div>
  );
}
