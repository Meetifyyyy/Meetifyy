import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Calendar, ChevronLeft, ChevronRight } from 'lucide-react';
import styles from './CustomDatePicker.module.css';

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

const DAYS_OF_WEEK = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

/**
 * Custom DatePicker component styled cleanly for Meetifyy's theme.
 * Replaces native <input type="date"> popovers.
 */
export default function CustomDatePicker({
  value = '',
  onChange,
  min = '',
  max = '',
  placeholder = 'mm/dd/yyyy',
  disabled = false,
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [popoverStyle, setPopoverStyle] = useState({});

  // Parse current value (YYYY-MM-DD) or fallback to today for calendar view
  const parsedDate = value ? new Date(value + 'T00:00:00') : null;
  const initialYear = parsedDate && !isNaN(parsedDate) ? parsedDate.getFullYear() : new Date().getFullYear();
  const initialMonth = parsedDate && !isNaN(parsedDate) ? parsedDate.getMonth() : new Date().getMonth();

  const [viewYear, setViewYear] = useState(initialYear);
  const [viewMonth, setViewMonth] = useState(initialMonth);

  const containerRef = useRef(null);
  const popoverRef = useRef(null);

  // Synchronize view state when value changes externally
  useEffect(() => {
    if (value) {
      const d = new Date(value + 'T00:00:00');
      if (!isNaN(d)) {
        setViewYear(d.getFullYear());
        setViewMonth(d.getMonth());
      }
    }
  }, [value]);

  const toggleOpen = () => {
    if (disabled) return;

    if (!isOpen && containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      const popoverWidth = 230;
      const popoverHeight = 250;
      const vh = window.visualViewport?.height || window.innerHeight;
      const spaceBelow = vh - rect.bottom;

      let top = rect.bottom + 6;
      if (spaceBelow < popoverHeight && rect.top > spaceBelow) {
        top = rect.top - popoverHeight - 6;
      }

      top = Math.max(12, Math.min(top, vh - popoverHeight - 12));
      const left = Math.max(12, Math.min(rect.left, window.innerWidth - popoverWidth - 12));

      setPopoverStyle({
        position: 'fixed',
        top: `${top}px`,
        left: `${left}px`,
        width: `${popoverWidth}px`,
        zIndex: 99999999,
      });
    }
    setIsOpen(!isOpen);
  };

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target) &&
        (!popoverRef.current || !popoverRef.current.contains(e.target))
      ) {
        setIsOpen(false);
      }
    };

    const handleScroll = (e) => {
      if (popoverRef.current && (popoverRef.current === e.target || popoverRef.current.contains(e.target))) return;
      setIsOpen(false);
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      window.addEventListener('scroll', handleScroll, true);
      window.addEventListener('resize', handleScroll);
      window.visualViewport?.addEventListener('resize', handleScroll);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      window.removeEventListener('scroll', handleScroll, true);
      window.removeEventListener('resize', handleScroll);
      window.visualViewport?.removeEventListener('resize', handleScroll);
    };
  }, [isOpen]);

  const handlePrevMonth = () => {
    if (viewMonth === 0) {
      setViewMonth(11);
      setViewYear((y) => y - 1);
    } else {
      setViewMonth((m) => m - 1);
    }
  };

  const handleNextMonth = () => {
    if (viewMonth === 11) {
      setViewMonth(0);
      setViewYear((y) => y + 1);
    } else {
      setViewMonth((m) => m + 1);
    }
  };

  const handleSelectDay = (year, month, day) => {
    const mm = String(month + 1).padStart(2, '0');
    const dd = String(day).padStart(2, '0');
    const dateStr = `${year}-${mm}-${dd}`;
    onChange?.(dateStr);
    setIsOpen(false);
  };

  const handleToday = () => {
    const today = new Date();
    handleSelectDay(today.getFullYear(), today.getMonth(), today.getDate());
  };

  const handleClear = () => {
    onChange?.('');
    setIsOpen(false);
  };

  // Format label for display input box
  const formatDisplay = (val) => {
    if (!val) return '';
    const d = new Date(val + 'T00:00:00');
    if (isNaN(d)) return val;
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${mm}/${dd}/${d.getFullYear()}`;
  };

  // Generate calendar days
  const firstDayOfWeek = new Date(viewYear, viewMonth, 1).getDay(); // 0 = Sun
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const daysInPrevMonth = new Date(viewYear, viewMonth, 0).getDate();

  const daysArray = [];

  // Prev month padding
  for (let i = firstDayOfWeek - 1; i >= 0; i--) {
    daysArray.push({
      day: daysInPrevMonth - i,
      month: viewMonth - 1,
      year: viewMonth === 0 ? viewYear - 1 : viewYear,
      isCurrentMonth: false,
    });
  }

  // Current month days
  for (let d = 1; d <= daysInMonth; d++) {
    daysArray.push({
      day: d,
      month: viewMonth,
      year: viewYear,
      isCurrentMonth: true,
    });
  }

  // Next month padding to complete 35 or 42 cells grid
  const remainingCells = 42 - daysArray.length;
  const nextPaddingCount = remainingCells >= 7 ? remainingCells - 7 : remainingCells;
  for (let d = 1; d <= nextPaddingCount; d++) {
    daysArray.push({
      day: d,
      month: viewMonth + 1,
      year: viewMonth === 11 ? viewYear + 1 : viewYear,
      isCurrentMonth: false,
    });
  }

  const todayStr = new Date().toISOString().split('T')[0];

  return (
    <div className={styles.container} ref={containerRef}>
      <div
        className={`${styles.trigger} ${isOpen ? styles.open : ''}`}
        onClick={toggleOpen}
      >
        <span className={value ? '' : styles.placeholder}>
          {value ? formatDisplay(value) : placeholder}
        </span>
        <Calendar className={styles.calendarIcon} />
      </div>

      {isOpen &&
        createPortal(
          <div
            className={styles.popover}
            style={popoverStyle}
            ref={popoverRef}
            onWheel={(e) => e.stopPropagation()}
            onTouchMove={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className={styles.header}>
              <button
                type="button"
                className={styles.navBtn}
                onClick={handlePrevMonth}
                aria-label="Previous Month"
              >
                <ChevronLeft size={18} />
              </button>

              <span className={styles.monthLabel}>
                {MONTH_NAMES[viewMonth]} {viewYear}
              </span>

              <button
                type="button"
                className={styles.navBtn}
                onClick={handleNextMonth}
                aria-label="Next Month"
              >
                <ChevronRight size={18} />
              </button>
            </div>

            {/* Days of Week */}
            <div className={styles.weekDays}>
              {DAYS_OF_WEEK.map((wd) => (
                <div key={wd} className={styles.weekDay}>
                  {wd}
                </div>
              ))}
            </div>

            {/* Days Grid */}
            <div className={styles.daysGrid}>
              {daysArray.map(({ day, month, year, isCurrentMonth }, idx) => {
                const mm = String((month + 12) % 12 + 1).padStart(2, '0');
                const dd = String(day).padStart(2, '0');
                const cellDateStr = `${year}-${mm}-${dd}`;

                const isSelected = value === cellDateStr;
                const isToday = todayStr === cellDateStr;
                const isDisabled = (min && cellDateStr < min) || (max && cellDateStr > max);

                return (
                  <button
                    key={`${year}-${month}-${day}-${idx}`}
                    type="button"
                    className={`
                      ${styles.dayCell}
                      ${!isCurrentMonth ? styles.otherMonth : ''}
                      ${isToday ? styles.todayCell : ''}
                      ${isSelected ? styles.selectedCell : ''}
                      ${isDisabled ? styles.disabledCell : ''}
                    `}
                    disabled={isDisabled}
                    onClick={() => handleSelectDay(year, month, day)}
                  >
                    {day}
                  </button>
                );
              })}
            </div>

            {/* Footer */}
            <div className={styles.footer}>
              <button
                type="button"
                className={`${styles.actionBtn} ${styles.clearBtn}`}
                onClick={handleClear}
              >
                Clear
              </button>
              <button
                type="button"
                className={styles.actionBtn}
                onClick={handleToday}
              >
                Today
              </button>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}
