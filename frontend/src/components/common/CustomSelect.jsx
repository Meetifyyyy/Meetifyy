import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import styles from './CustomSelect.module.css';

export default function CustomSelect({ value, options, onChange, style, placeholder }) {
  const [isOpen, setIsOpen] = useState(false);
  const [dropdownStyle, setDropdownStyle] = useState({});
  const containerRef = useRef(null);
  const dropdownRef = useRef(null);

  // find current label
  const currentOption = options.find(opt => String(opt.value) === String(value));
  const currentLabel = currentOption ? currentOption.label : (value || placeholder || '');

  const toggleOpen = () => {
    if (!isOpen && containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom;
      const isTop = spaceBelow < 220; // open upward if not enough space
      
      setDropdownStyle({
        position: 'fixed',
        top: isTop ? 'auto' : `${rect.bottom + 4}px`,
        bottom: isTop ? `${window.innerHeight - rect.top + 4}px` : 'auto',
        left: `${rect.left}px`,
        width: `${rect.width}px`,
        zIndex: 9999
      });
    }
    setIsOpen(!isOpen);
  };

  useEffect(() => {
    const handleClickOutside = (e) => {
      // Check if click is outside both the trigger and the portal dropdown
      if (
        containerRef.current && 
        !containerRef.current.contains(e.target) &&
        (!dropdownRef.current || !dropdownRef.current.contains(e.target))
      ) {
        setIsOpen(false);
      }
    };

    const handleScroll = (e) => {
      // if scrolling inside the dropdown itself, do nothing
      if (dropdownRef.current && dropdownRef.current.contains(e.target)) return;
      setIsOpen(false); // close dropdown on any external scroll
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      window.addEventListener('scroll', handleScroll, true); // capture phase
      window.addEventListener('resize', handleScroll);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      window.removeEventListener('scroll', handleScroll, true);
      window.removeEventListener('resize', handleScroll);
    };
  }, [isOpen]);

  return (
    <div className={styles.container} ref={containerRef} style={style}>
      <div 
        className={`${styles.trigger} ${isOpen ? styles.open : ''}`} 
        onClick={toggleOpen}
      >
        <span className={styles.label}>{currentLabel}</span>
        <svg 
          className={styles.icon} 
          viewBox="0 0 24 24" 
          fill="none" 
          stroke="currentColor" 
          strokeWidth="2" 
          strokeLinecap="round" 
          strokeLinejoin="round"
        >
          <polyline points="6 9 12 15 18 9"></polyline>
        </svg>
      </div>
      
      {isOpen && createPortal(
        <div className={styles.dropdown} style={dropdownStyle} ref={dropdownRef}>
          {options.map((opt) => (
            <div 
              key={opt.value}
              className={`${styles.option} ${value === opt.value ? styles.selected : ''} ${opt.disabled ? styles.disabled : ''}`}
              onClick={() => {
                if (!opt.disabled) {
                  onChange({ target: { value: opt.value } });
                  setIsOpen(false);
                }
              }}
            >
              {opt.label}
            </div>
          ))}
        </div>,
        document.body
      )}
    </div>
  );
}
