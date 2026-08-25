import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Clock } from '@shared/components/icons';
import styles from './CustomTimePicker.module.css';

const HOURS = ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12'];
const MINUTES = ['00', '15', '30', '45'];

export const EMPTY_TIME = { hour12: null, minute: null, ampm: null };

/**
 * Parse 'HH:MM' into the three columns, or nulls when there is no value.
 *
 * The empty case used to fall back to 10:00 AM, which the columns then
 * rendered with `selectedItem` — so a picker the user had never touched
 * opened with an hour, a minute and a meridiem all highlighted as if they had
 * chosen them. The field itself was empty (`--:-- --`), so the picker was
 * contradicting the input right next to it. Nulls match nothing, so nothing is
 * highlighted until the user actually picks.
 */
export function parseTime(val) {
  if (!val) return EMPTY_TIME;
  const [hStr, mStr] = String(val).split(':');
  let h = parseInt(hStr, 10);
  const m = mStr || '00';
  if (isNaN(h)) return EMPTY_TIME;

  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12;
  if (h === 0) h = 12;
  const hour12 = String(h).padStart(2, '0');

  const minNum = parseInt(m, 10);
  let minute = '00';
  if (minNum >= 7 && minNum < 22) minute = '15';
  else if (minNum >= 22 && minNum < 37) minute = '30';
  else if (minNum >= 37 && minNum < 52) minute = '45';

  return { hour12, minute, ampm };
}

/**
 * Custom TimePicker component styled cleanly for Meetifyy's theme.
 * Expects value in 'HH:MM' (24-hour) or converts to 12-hour format cleanly.
 */
export default function CustomTimePicker({
  value = '',
  onChange,
  placeholder = '--:-- --',
  disabled = false,
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [popoverStyle, setPopoverStyle] = useState({});

  const containerRef = useRef(null);
  const popoverRef = useRef(null);
  const hoursColRef = useRef(null);
  const minsColRef = useRef(null);

  const parsed = parseTime(value);

  /**
   * Parts chosen in this session but not yet a complete time.
   *
   * A time needs an hour and a meridiem before it means anything, and the
   * three columns are picked one at a time. Holding the partial choice here
   * lets each column highlight what the user actually tapped while the form
   * value stays empty — so validation still blocks submit, and the caller
   * never receives a time assembled out of defaults nobody selected.
   */
  const [draft, setDraft] = useState(EMPTY_TIME);

  // An externally-set value (editing an existing event, a reset) is the truth;
  // the draft follows it rather than lingering from a previous open.
  useEffect(() => {
    setDraft(parseTime(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const formatted = value ? parsed : draft;

  // Convert 12-hr to 24-hr string 'HH:MM'
  const to24HourStr = (h12, min, ampm) => {
    let h = parseInt(h12, 10);
    if (ampm === 'PM' && h < 12) h += 12;
    if (ampm === 'AM' && h === 12) h = 0;
    const hh = String(h).padStart(2, '0');
    return `${hh}:${min}`;
  };

  const displayString = value ? `${formatted.hour12}:${formatted.minute} ${formatted.ampm}` : '';

  const toggleOpen = () => {
    if (disabled) return;

    if (!isOpen && containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      const popoverWidth = 200;
      const popoverHeight = 190;
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

      setTimeout(() => {
        const selH = hoursColRef.current?.querySelector(`.${styles.selectedItem}`);
        selH?.scrollIntoView({ block: 'nearest' });
        const selM = minsColRef.current?.querySelector(`.${styles.selectedItem}`);
        selM?.scrollIntoView({ block: 'nearest' });
      }, 30);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      window.removeEventListener('scroll', handleScroll, true);
      window.removeEventListener('resize', handleScroll);
      window.visualViewport?.removeEventListener('resize', handleScroll);
    };
  }, [isOpen]);

  /**
   * Record one column's choice, and emit only once the time is real.
   *
   * "Real" means the user has chosen an hour AND a meridiem — 7 without
   * AM/PM is two different times. The minute defaults to :00 at that point,
   * which is the one part with an unambiguous default and the value three of
   * the four options round to anyway.
   */
  const handleSelect = (next) => {
    const merged = { ...formatted, ...next };
    setDraft(merged);

    if (merged.hour12 && merged.ampm) {
      onChange?.(to24HourStr(merged.hour12, merged.minute || '00', merged.ampm));
    }
  };

  const handleClear = () => {
    setDraft(EMPTY_TIME);
    onChange?.('');
    setIsOpen(false);
  };

  return (
    <div className={styles.container} ref={containerRef}>
      <div
        className={`${styles.trigger} ${isOpen ? styles.open : ''}`}
        onClick={toggleOpen}
      >
        <span className={displayString ? '' : styles.placeholder}>
          {displayString || placeholder}
        </span>
        <Clock className={styles.clockIcon} />
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
            <div className={styles.title}>Select Time</div>

            <div className={styles.pickerGrid}>
              {/* Hours Column */}
              <div className={styles.column} ref={hoursColRef}>
                {HOURS.map((h) => (
                  <button
                    key={h}
                    type="button"
                    className={`${styles.colItem} ${formatted.hour12 === h ? styles.selectedItem : ''}`}
                    onClick={() => handleSelect({ hour12: h })}
                  >
                    {h}
                  </button>
                ))}
              </div>

              <span className={styles.colon}>:</span>

              {/* Minutes Column */}
              <div className={styles.column} ref={minsColRef}>
                {MINUTES.map((m) => (
                  <button
                    key={m}
                    type="button"
                    className={`${styles.colItem} ${formatted.minute === m ? styles.selectedItem : ''}`}
                    onClick={() => handleSelect({ minute: m })}
                  >
                    {m}
                  </button>
                ))}
              </div>

              {/* AM/PM Column */}
              <div className={`${styles.column} ${styles.ampmCol}`}>
                {['AM', 'PM'].map((ap) => (
                  <button
                    key={ap}
                    type="button"
                    className={`${styles.colItem} ${formatted.ampm === ap ? styles.selectedItem : ''}`}
                    onClick={() => handleSelect({ ampm: ap })}
                  >
                    {ap}
                  </button>
                ))}
              </div>
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
                onClick={() => setIsOpen(false)}
              >
                Done
              </button>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}
