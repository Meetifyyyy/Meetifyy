import { useState, useEffect, useRef, useCallback } from 'react';
import { readDraft, saveDraft, clearDraft, draftOwner } from '@shared/lib/drafts';

/** How long typing must pause before the draft is written. */
const SAVE_DELAY_MS = 400;

// Composers occasionally hold a bare string (see ChatInputArea's emoji
// fallback); the draft only cares about the text either way.
const textOf = (value) => (typeof value === 'string' ? value : value?.text ?? '');
const mentionsOf = (value) => (typeof value === 'string' ? [] : value?.mentions ?? []);

function restore(scope) {
  const draft = scope ? readDraft(scope) : null;
  return draft ?? { text: '', mentions: [] };
}

/**
 * The `{ text, mentions }` state of a composer, kept as a persistent draft.
 *
 * Drop-in for `useState({ text: '', mentions: [] })`:
 *   - the first render already holds the saved draft (a synchronous read, so
 *     there is no empty-then-filled flash);
 *   - when `scope` changes (another chat, another post) the previous scope's
 *     text is saved and the new scope's draft is swapped in during the same
 *     render, so text typed in one composer can never appear in another;
 *   - typing is saved after a short pause, and at once when the page is hidden
 *     or the component unmounts, which is the last chance before the app is
 *     killed in the background;
 *   - emptying the composer (a send, a publish, Clear) deletes the draft
 *     immediately rather than after the pause, so a message that has just gone
 *     out is never resurrected by a quick restart.
 *
 * A falsy `scope` turns persistence off for that composer.
 *
 * @param {string|null|undefined} scope     e.g. `chat:<conversationId>`
 * @param {object} [options]
 * @param {number} [options.maxLength]      the composer's own character limit
 * @returns {[{text: string, mentions: Array}, Function]} the value and its setter
 */
export function useComposerDraft(scope, { maxLength } = {}) {
  const [value, setValue] = useState(() => restore(scope));
  const [loadedScope, setLoadedScope] = useState(scope);

  // Adjusting state while rendering (not in an effect) is what keeps the old
  // scope's text from ever being painted under the new one.
  if (scope !== loadedScope) {
    setLoadedScope(scope);
    setValue(restore(scope));
  }

  // The last text this hook has already dealt with for `scope`: either restored
  // from storage or handed to the writer. Comparing against it stops a restore
  // from being written straight back with a fresh timestamp.
  const handledRef = useRef({ scope, text: textOf(value) });
  const pendingRef = useRef(null);
  const timerRef = useRef(null);

  const flush = useCallback(() => {
    clearTimeout(timerRef.current);
    timerRef.current = null;
    const pending = pendingRef.current;
    if (!pending) return;
    pendingRef.current = null;
    saveDraft(pending.scope, pending.text, {
      maxLength: pending.maxLength,
      mentions: pending.mentions,
      owner: pending.owner,
    });
  }, []);

  useEffect(() => {
    const text = textOf(value);
    if (handledRef.current.scope !== scope) {
      // Moved to another composer: write out what was typed in the last one,
      // then treat the restored value as already stored.
      flush();
      handledRef.current = { scope, text };
      return;
    }
    if (text === handledRef.current.text) return;
    handledRef.current.text = text;
    if (!scope) return;

    if (!text.trim()) {
      pendingRef.current = null;
      clearTimeout(timerRef.current);
      timerRef.current = null;
      clearDraft(scope);
      return;
    }
    pendingRef.current = { scope, text, mentions: mentionsOf(value), maxLength, owner: draftOwner() };
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(flush, SAVE_DELAY_MS);
  }, [scope, value, maxLength, flush]);

  // Backgrounding is the last reliable moment before Android may kill the
  // process; `pagehide` covers a tab closing or a reload on the web.
  useEffect(() => {
    const onHidden = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    document.addEventListener('visibilitychange', onHidden);
    window.addEventListener('pagehide', flush);
    return () => {
      document.removeEventListener('visibilitychange', onHidden);
      window.removeEventListener('pagehide', flush);
      flush();
    };
  }, [flush]);

  return [value, setValue];
}
