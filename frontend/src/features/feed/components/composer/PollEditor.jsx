import { useEffect, useRef, useState } from 'react';
import styles from './PollEditor.module.css';

/**
 * The poll editor inside the post composer.
 *
 * Options are stacked fields in the order they will be shown, each keyed by
 * its own id (they were keyed by place, so removing the second one moved the
 * third's field, focus and animation into its slot). A new option slides in
 * and takes focus; a removed one folds away before it leaves. Below them,
 * "Add option" while there is room, and one line that says what the poll
 * still needs before it can be posted.
 *
 * There is no "multiple answers" switch: every poll takes one vote a person,
 * which is all the server stores, so the switch used to change nothing.
 */

/** Below this many characters left, the counter shows; below the second, it warns. */
const COUNT_VISIBLE_AT = 30;
const COUNT_WARNING_AT = 10;
/** How long a removed option takes to fold away (matches the CSS). */
const LEAVE_MS = 180;

export default function PollEditor({
  options,
  maxOptions,
  maxLength,
  problem,
  onChange,
  onAdd,
  onRemove,
  onDiscard,
}) {
  const [leaving, setLeaving] = useState(() => new Set());
  const inputs = useRef(new Map());
  const focusNext = useRef(null);
  const timers = useRef([]);

  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  // A new option takes focus once it is in the DOM.
  useEffect(() => {
    if (focusNext.current == null) return;
    inputs.current.get(focusNext.current)?.focus();
    focusNext.current = null;
  }, [options]);

  const add = () => {
    const id = onAdd();
    if (id != null) focusNext.current = id;
  };

  const remove = (id) => {
    if (leaving.has(id)) return;
    setLeaving((prev) => new Set(prev).add(id));
    timers.current.push(setTimeout(() => {
      onRemove(id);
      setLeaving((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }, LEAVE_MS));
  };

  const remaining = options.length - leaving.size;
  const canRemove = remaining > 2;
  const canAdd = remaining < maxOptions;

  return (
    <div className={styles.editor}>
      <ol className={styles.options} aria-label="Poll options">
        {options.map((option, i) => {
          const left = maxLength - option.text.length;
          const showCount = left <= COUNT_VISIBLE_AT;
          const isLeaving = leaving.has(option.id);
          return (
            <li key={option.id} className={`${styles.optionWrap}${isLeaving ? ` ${styles.leaving}` : ''}`}>
              <div className={styles.optionClip}>
                <div className={styles.option}>
                  <input
                    ref={(el) => {
                      if (el) inputs.current.set(option.id, el);
                      else inputs.current.delete(option.id);
                    }}
                    className={styles.input}
                    type="text"
                    placeholder={`Option ${i + 1}`}
                    value={option.text}
                    maxLength={maxLength}
                    aria-label={`Option ${i + 1}`}
                    onChange={(e) => onChange(option.id, e.target.value.slice(0, maxLength))}
                    onKeyDown={(e) => {
                      // Enter on the last filled option adds the next one.
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        if (i === options.length - 1 && option.text.trim() && canAdd) add();
                        else inputs.current.get(options[i + 1]?.id)?.focus();
                      }
                    }}
                    disabled={isLeaving}
                  />
                  {showCount && (
                    <span
                      className={`${styles.count}${left === 0 ? ` ${styles.limit}` : left <= COUNT_WARNING_AT ? ` ${styles.warning}` : ''}`}
                      title={`${left} characters remaining (max ${maxLength})`}
                    >
                      {left}
                    </span>
                  )}
                  {canRemove && (
                    <button
                      type="button"
                      className={styles.remove}
                      onClick={() => remove(option.id)}
                      title="Remove option"
                      aria-label={`Remove option ${i + 1}`}
                      disabled={isLeaving}
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true">
                        <line x1="18" y1="6" x2="6" y2="18" />
                        <line x1="6" y1="6" x2="18" y2="18" />
                      </svg>
                    </button>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ol>

      {canAdd && (
        <button type="button" className={styles.add} onClick={add} title="Add option">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          Add option
        </button>
      )}

      <div className={styles.footer}>
        <span className={`${styles.hint}${problem ? ` ${styles.problem}` : ''}`} aria-live="polite">
          {problem || `Up to ${maxOptions} options · one vote each`}
        </span>
        <button type="button" className={styles.discard} onClick={onDiscard} title="Remove poll">
          Remove poll
        </button>
      </div>
    </div>
  );
}
