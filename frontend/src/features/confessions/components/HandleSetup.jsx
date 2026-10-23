import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useCreateConfessionProfile, useHandleAvailability } from '@shared/hooks/useConfessions';
import { HANDLE_MAX, handleProblem, suggestHandles, validateHandle } from '@shared/lib/confessionHandle';
import { showToast } from '@shared/utils/toast';
import styles from './HandleSetup.module.css';

/**
 * Choosing the anonymous name, straight after the deck.
 *
 * Availability is shown as you type (local rules instantly, the server's
 * answer after a short pause), but the server decides on submit: a name taken
 * in the gap, or one the server refuses for a reason only it can know (the
 * person's own username), comes back as an error and is shown in the same
 * place as the live feedback.
 */
export default function HandleSetup({ onCreated, onBack }) {
  const [handle, setHandle] = useState('');
  const [submitError, setSubmitError] = useState(null);
  const [suggestions, setSuggestions] = useState(() => suggestHandles(3));
  const availability = useHandleAvailability(handle);
  const create = useCreateConfessionProfile();
  const inputRef = useRef(null);
  const statusId = useId();
  const noteId = useId();

  useEffect(() => {
    // After the deck's exit has finished, so the keyboard does not open over it.
    const t = setTimeout(() => inputRef.current?.focus({ preventScroll: true }), 420);
    return () => clearTimeout(t);
  }, []);

  const onChange = useCallback((e) => {
    // No spaces or "@" — people paste "@name" and type "my name".
    setHandle(e.target.value.replace(/[\s@]/g, '').slice(0, HANDLE_MAX));
    setSubmitError(null);
  }, []);

  const canSubmit = availability.state === 'available' && !create.isPending;

  const onSubmit = useCallback(async (e) => {
    e.preventDefault();
    if (!validateHandle(handle).ok || create.isPending) return;
    setSubmitError(null);
    try {
      const data = await create.mutateAsync(handle.trim());
      onCreated?.(data?.profile ?? null);
    } catch (err) {
      const code = err?.code;
      if (code === 'handle_taken') setSubmitError('Someone just took that one. Try another.');
      else if (code === 'handle_invalid') setSubmitError('That name isn’t allowed. Try another.');
      else if (code === 'profile_exists') onCreated?.(null);
      else if (code === 'rate_limited') setSubmitError(err.message || 'Too many tries. Wait a moment.');
      else if (err?.name !== 'OfflineError') showToast(err?.message || 'Couldn’t save your name. Try again.', 'error');
    }
  }, [handle, create, onCreated]);

  const status = submitError
    ? { tone: 'bad', text: submitError }
    : statusFor(availability);

  return (
    <form className={styles.screen} onSubmit={onSubmit} noValidate>
      <div className={styles.inner}>
        <button type="button" className={styles.backLink} onClick={onBack}>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Back to the intro
        </button>

        <p className={styles.eyebrow}>Step 2 of 2 · Your anonymous name</p>
        <h2 className={styles.title}>
          Who will you
          <br />
          <span className={styles.titleAccent}>be here?</span>
        </h2>
        <p className={styles.lede}>
          This is the only name your campus will see on your confessions.
        </p>

        <label className={styles.field} data-state={submitError ? 'bad' : availability.state}>
          <span className={styles.at} aria-hidden="true">@</span>
          <input
            ref={inputRef}
            className={styles.input}
            value={handle}
            onChange={onChange}
            placeholder="your.secret.name"
            aria-label="Anonymous name"
            aria-describedby={`${statusId} ${noteId}`}
            aria-invalid={status.tone === 'bad' ? 'true' : undefined}
            autoComplete="off"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck="false"
            inputMode="text"
            enterKeyHint="go"
            maxLength={HANDLE_MAX}
          />
          <span className={styles.count} aria-hidden="true">{handle.length}/{HANDLE_MAX}</span>
        </label>

        <p id={statusId} className={styles.status} data-tone={status.tone} aria-live="polite">
          <span className={styles.statusDot} aria-hidden="true" />
          {status.text}
        </p>

        <div className={styles.suggest}>
          <span className={styles.suggestLabel}>Or take one</span>
          <div className={styles.chips}>
            {suggestions.map((s) => (
              <button
                key={s}
                type="button"
                className={styles.chip}
                onClick={() => { setHandle(s); setSubmitError(null); }}
              >
                @{s}
              </button>
            ))}
            <button
              type="button"
              className={styles.shuffle}
              onClick={() => setSuggestions(suggestHandles(3))}
              aria-label="Suggest other names"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M4 7h11l-3-3M20 17H9l3 3" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>
        </div>

        <div id={noteId} className={styles.note}>
          <svg className={styles.noteMark} viewBox="0 0 40 40" aria-hidden="true">
            <circle cx="20" cy="20" r="18" className={styles.noteFace} />
            <path d="M13 25c2.4 2.4 11.6 2.4 14 0" className={styles.noteMouth} />
            <rect x="10" y="14" width="20" height="6" rx="3" className={styles.noteEye} />
          </svg>
          <p>
            <strong>Separate from your Meetifyy profile.</strong> Other students never see your
            real name, photo or username here. Our moderators can link it to your account only
            to deal with reports. Your name can’t be changed later.
          </p>
        </div>
      </div>

      <div className={styles.footer}>
        <button type="submit" className={styles.submit} disabled={!canSubmit}>
          {create.isPending ? 'Saving…' : 'Enter Confessions'}
        </button>
      </div>
    </form>
  );
}

function statusFor({ state, reason }) {
  switch (state) {
    case 'empty':
      return { tone: 'idle', text: '3–20 letters, numbers, dots or underscores.' };
    case 'invalid':
      return { tone: 'bad', text: handleProblem(reason) };
    case 'reserved':
      return { tone: 'bad', text: 'That name can’t be used. Try another.' };
    case 'checking':
      return { tone: 'busy', text: 'Checking…' };
    case 'available':
      return { tone: 'good', text: 'It’s yours if you want it.' };
    case 'taken':
      return { tone: 'bad', text: 'Already taken. Try another.' };
    case 'limited':
      return { tone: 'bad', text: 'Checking too fast. Wait a few seconds and try again.' };
    default:
      return { tone: 'bad', text: 'Couldn’t check that name. Check your connection.' };
  }
}
