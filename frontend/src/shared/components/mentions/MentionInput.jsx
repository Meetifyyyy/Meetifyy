import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useMentionSuggestions } from '../../hooks/useMentionSuggestions';
import { filterLocalMentions } from './localMentions';
import MentionDropdown from './MentionDropdown';
import { visibleViewportBottom } from '@shared/utils/visibleViewport';
import { countChars, clampChars } from '@shared/utils/textLimit';
import { showToast } from '@shared/utils/toast';
import styles from './MentionInput.module.css';

function escapeHtml(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

/**
 * Text, as the editor's HTML: escaped, with line breaks as <br>.
 *
 * URLs stay exactly as typed. They used to be swapped for a non-editable chip
 * reading "[ example.com/… ]" the moment a space followed them, and the chip
 * serialised back as a SANITISED copy of the address (`www.x.com` was sent as
 * `https://www.x.com`, anything the sanitiser rejected was sent as nothing).
 * That was the "[ ]" in the composer: the text could not be edited, selected
 * or deleted character by character, and what was sent was not what was
 * typed. How a link looks once SENT is the message renderer's job (RichText).
 */
function textToEditorHtml(text) {
  return escapeHtml(text || '').replace(/\n/g, '<br>');
}


export default function MentionInput({
  value,
  onChange,
  placeholder = 'Write something...',
  singleLine = false,
  onSubmit,
  onKeyDown,
  onFocus,
  communityId = null,
  className = '',
  style = {},
  autoFocus = false,
  inputMode,
  inputRef,
  ariaDescribedBy,
  ariaInvalid,
  // 'search' (posts, comments): people found by a search per term.
  // 'local': `mentionCandidates`, filtered in memory (a group's members).
  // 'off': "@" is just a character (direct chats).
  mentionMode = 'search',
  mentionCandidates = null,
  // Hard limit, in characters as the server counts them. Typing stops at it,
  // a paste is cut to fit, and anything an input method commits past it is
  // trimmed. Without it the field accepted any length and only the counter
  // said it was too long.
  maxChars,
}) {
  const containerRef = useRef(null);
  const editorRef = useRef(null);
  const [mentionActive, setMentionActive] = useState(false);
  const [mentionQuery, setMentionQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [dropdownPos, setDropdownPos] = useState({ top: 30, left: 0, fixed: true });

  // Refs to track caret position when @ was typed
  const activeNodeRef = useRef(null);
  const atOffsetRef = useRef(0);
  const caretOffsetRef = useRef(0);
  const lastParsedTextRef = useRef(null);
  const savedRangeRef = useRef(null);
  // True between compositionstart and compositionend. The DOM must not be
  // touched while an input method is composing a word, or the IME loses it.
  const composingRef = useRef(false);

  const searched = useMentionSuggestions({
    query: mentionQuery,
    communityId,
    maxResults: 15,
    enabled: mentionActive && mentionMode === 'search',
  });
  const localSuggestions = useMemo(
    () => (mentionMode === 'local' && mentionActive ? filterLocalMentions(mentionCandidates, mentionQuery) : []),
    [mentionMode, mentionActive, mentionCandidates, mentionQuery],
  );
  const suggestions = mentionMode === 'local' ? localSuggestions : searched.suggestions;
  const loading = mentionMode === 'local' ? false : searched.loading;

  // Track active selection range within the editor
  const saveSelection = useCallback(() => {
    const el = editorRef.current;
    if (!el) return;
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0) {
      const range = sel.getRangeAt(0);
      if (el.contains(range.startContainer)) {
        savedRangeRef.current = range.cloneRange();
      }
    }
  }, []);

  useEffect(() => {
    const handleSelectionChange = () => {
      const el = editorRef.current;
      if (!el) return;
      if (document.activeElement === el || el.contains(document.activeElement)) {
        saveSelection();
      }
    };
    document.addEventListener('selectionchange', handleSelectionChange);
    return () => document.removeEventListener('selectionchange', handleSelectionChange);
  }, [saveSelection]);

  // Convert incoming value to standardized { text, mentions }
  const currentVal = useCallback(() => {
    if (typeof value === 'string') {
      return { text: value, mentions: [] };
    }
    return value || { text: '', mentions: [] };
  }, [value]);

  // Helper to parse DOM tree to { text, mentions }
  const parseDOM = useCallback(() => {
    const el = editorRef.current;
    if (!el) return { text: '', mentions: [] };

    let textString = '';
    const mentions = [];

    function traverse(node) {
      if (node.nodeType === Node.TEXT_NODE) {
        textString += node.nodeValue || '';
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        if (node.hasAttribute('data-username')) {
          const username = node.getAttribute('data-username');
          const userId = node.getAttribute('data-user-id') || username;
          const tagText = `@${username}`;
          const start = textString.length;
          const end = start + tagText.length;
          textString += tagText;
          mentions.push({ userId, username, start, end });
        } else if (node.hasAttribute('data-url')) {
          // A link chip from an older build (a restored draft, a paste): it
          // stands for the address it carries.
          textString += node.getAttribute('data-url') || '';
        } else if (node.nodeName === 'BR') {
          textString += '\n';
        } else if (node.nodeName === 'DIV' || node.nodeName === 'P') {
          if (textString.length > 0 && !textString.endsWith('\n')) {
            textString += '\n';
          }
          for (let i = 0; i < node.childNodes.length; i++) {
            traverse(node.childNodes[i]);
          }
        } else {
          for (let i = 0; i < node.childNodes.length; i++) {
            traverse(node.childNodes[i]);
          }
        }
      }
    }

    for (let i = 0; i < el.childNodes.length; i++) {
      traverse(el.childNodes[i]);
    }

    // Clean up trailing newline from browser divs
    if (textString.endsWith('\n') && el.childNodes.length === 1 && el.firstChild.nodeName === 'BR') {
      textString = '';
    }

    return { text: textString, mentions };
  }, []);

  /**
   * Removes whatever is over `maxChars`, from just before the caret, which is
   * where it was typed or pasted. Returns whether the DOM was changed.
   */
  const trimOverflow = useCallback((currentText) => {
    const el = editorRef.current;
    if (!el || !(maxChars > 0)) return false;
    const over = countChars(currentText) - maxChars;
    if (over <= 0) return false;

    const sel = window.getSelection();
    const caretInside = sel && sel.rangeCount > 0 && el.contains(sel.focusNode);
    // Small overflows (a keystroke, an emoji, a committed word) come off at
    // the caret. Selection.modify steps over a mention pill as one unit.
    if (caretInside && over <= 200 && typeof sel.modify === 'function') {
      try {
        sel.collapse(sel.focusNode, sel.focusOffset);
        let previous = -1;
        for (let i = 0; i < over + 20; i += 1) {
          sel.modify('extend', 'backward', 'character');
          const taken = countChars(sel.toString());
          if (taken >= over || taken === previous) break;
          previous = taken;
        }
        if (!sel.isCollapsed) {
          sel.getRangeAt(0).deleteContents();
          sel.collapseToStart();
          if (countChars(parseDOM().text) <= maxChars) return true;
        }
      } catch {
        // Fall through to the plain cut below.
      }
    }

    // Anything else: keep the first `maxChars` characters as plain text and
    // put the caret at the end.
    el.innerHTML = textToEditorHtml(clampChars(parseDOM().text, maxChars));
    try {
      const range = document.createRange();
      range.selectNodeContents(el);
      range.collapse(false);
      sel?.removeAllRanges();
      sel?.addRange(range);
      savedRangeRef.current = range.cloneRange();
    } catch {
      // Selection can be unavailable (detached editor); the text is still cut.
    }
    return true;
  }, [maxChars, parseDOM]);

  // Handle typing and caret check for @ suggestions
  const handleInput = useCallback(() => {
    const el = editorRef.current;
    if (!el) return;

    // One read of the editor per input; a second only when the cap cut it.
    let parsed = parseDOM();
    if (!composingRef.current && trimOverflow(parsed.text)) parsed = parseDOM();
    lastParsedTextRef.current = parsed.text;
    el.setAttribute('data-empty', parsed.text ? 'false' : 'true');
    if (onChange) {
      onChange(parsed);
    }

    // Check caret for @ trigger. Not at all where mentions are off.
    if (mentionMode === 'off') {
      setMentionActive(false);
      return;
    }
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) {
      setMentionActive(false);
      return;
    }

    const range = sel.getRangeAt(0);
    if (range.startContainer.nodeType !== Node.TEXT_NODE) {
      setMentionActive(false);
      return;
    }

    const node = range.startContainer;
    const offset = range.startOffset;
    const textBefore = node.nodeValue.slice(0, offset);
    const atIndex = textBefore.lastIndexOf('@');

    if (atIndex !== -1) {
      const charBefore = atIndex > 0 ? textBefore[atIndex - 1] : '';
      if (atIndex === 0 || /\s/.test(charBefore)) {
        const query = textBefore.slice(atIndex + 1);
        if (!/\s/.test(query) && query.length <= 25) {
          activeNodeRef.current = node;
          atOffsetRef.current = atIndex;
          caretOffsetRef.current = offset;
          setMentionQuery(query);
          setSelectedIndex(0);

          // Compute viewport-fixed dropdown position (portal escapes overflow:hidden)
          const rect = range.getBoundingClientRect();
          // Fall back to editor element rect when caret rect collapses to zero (empty field)
          const refRect = (rect.height > 0) ? rect : editorRef.current?.getBoundingClientRect();
          if (refRect) {
            // Space below ends at the keyboard, which overlays the page in the
            // app (no viewport shrinks for it). `bottom` is a fixed-position
            // offset, so it is measured from the layout viewport's bottom.
            const spaceBelow = (visibleViewportBottom() || window.innerHeight) - refRect.bottom;
            const shouldOpenUpwards = singleLine || spaceBelow < 250;

            if (shouldOpenUpwards) {
              setDropdownPos({
                bottom: window.innerHeight - refRect.top + 6,
                left: Math.max(16, refRect.left),
                top: 'auto',
                fixed: true
              });
            } else {
              setDropdownPos({
                top: refRect.bottom + 6,
                left: refRect.left,
                bottom: 'auto',
                fixed: true
              });
            }
          }
          setMentionActive(true);
          return;
        }
      }
    }

    setMentionActive(false);
  }, [onChange, parseDOM, singleLine, mentionMode, trimOverflow]);

  // Insert text/emoji at current or saved cursor position, then reposition caret directly after
  const insertTextAtCursor = useCallback((textToInsert) => {
    const el = editorRef.current;
    if (!el || !textToInsert) return;

    el.focus();

    const sel = window.getSelection();
    let range = savedRangeRef.current;

    // Check if saved range is valid and inside editor
    if (!range || !el.contains(range.startContainer)) {
      if (sel && sel.rangeCount > 0 && el.contains(sel.getRangeAt(0).startContainer)) {
        range = sel.getRangeAt(0);
      } else {
        range = document.createRange();
        range.selectNodeContents(el);
        range.collapse(false);
      }
    }

    try {
      sel.removeAllRanges();
      sel.addRange(range);
    } catch (_) {
      // Ignore selection errors on edge cases
    }

    // Delete any selected content
    range.deleteContents();

    // Insert text
    const textNode = document.createTextNode(textToInsert);
    range.insertNode(textNode);

    // Place caret immediately after the inserted text node
    const newRange = document.createRange();
    newRange.setStart(textNode, textNode.length);
    newRange.setEnd(textNode, textNode.length);
    newRange.collapse(true);

    try {
      sel.removeAllRanges();
      sel.addRange(newRange);
      savedRangeRef.current = newRange.cloneRange();
    } catch (_) {
      // Ignore
    }

    handleInput();
  }, [handleInput]);

  // Focus helper: focuses editor and moves caret to end with selection range
  const focusEditor = useCallback((options) => {
    const el = editorRef.current;
    if (!el) return;
    HTMLElement.prototype.focus.call(el, options);
    try {
      const range = document.createRange();
      range.selectNodeContents(el);
      range.collapse(false);
      const sel = window.getSelection();
      if (sel) {
        sel.removeAllRanges();
        sel.addRange(range);
      }
      savedRangeRef.current = range.cloneRange();
    } catch (_) {
      // safe fallback if selection range fails
    }
  }, []);

  // Connect external inputRef if provided and attach insertTextAtCursor and focus
  useEffect(() => {
    if (editorRef.current) {
      editorRef.current.insertTextAtCursor = insertTextAtCursor;
      editorRef.current.focus = focusEditor;
    }
    if (inputRef) {
      if (typeof inputRef === 'function') {
        inputRef(editorRef.current);
      } else {
        inputRef.current = editorRef.current;
      }
    }
  }, [inputRef, insertTextAtCursor, focusEditor]);

  /**
   * Mirrors an externally-supplied value into the DOM — form resets, initial
   * load, a draft restored from elsewhere.
   *
   * While the editor has focus or matches the last parsed text, keep DOM intact
   * to avoid resetting selection and jumping the caret to the start.
   */
  useEffect(() => {
    const el = editorRef.current;
    if (!el) return;

    const { text, mentions = [] } = currentVal();
    const isFocused = document.activeElement === el;

    // The DOM already shows this text: it came from typing here (onChange
    // echoes it back) or an insertion done in place. Leave the caret alone.
    if (lastParsedTextRef.current === text && text) return;
    // Focused, but the value was changed from outside (a reply's @mention put
    // in front): it was skipped before, so the box never showed it. Write it,
    // then put the caret at the end.
    const moveCaretToEnd = isFocused && Boolean(text);

    lastParsedTextRef.current = text;

    if (!text) {
      // Skip the DOM write when it is already empty
      if (el.innerHTML !== '') el.innerHTML = '';
      el.setAttribute('data-empty', 'true');
      return;
    }

    el.setAttribute('data-empty', 'false');

    const placeCaretAtEnd = () => {
      if (!moveCaretToEnd) return;
      try {
        const range = document.createRange();
        range.selectNodeContents(el);
        range.collapse(false);
        const sel = window.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(range);
        savedRangeRef.current = range.cloneRange();
      } catch (_) {
        // Selection unavailable: the text is still shown.
      }
    };

    if (!mentions || mentions.length === 0) {
      el.innerHTML = textToEditorHtml(text);
      placeCaretAtEnd();
      return;
    }

    // Sort mentions by start index
    const sorted = [...mentions].sort((a, b) => a.start - b.start);
    let html = '';
    let cursor = 0;

    sorted.forEach(m => {
      if (m.start >= cursor && m.end <= text.length && text.slice(m.start, m.end) === `@${m.username}`) {
        html += textToEditorHtml(text.slice(cursor, m.start));
        html += `<span class="${styles.pill}" contenteditable="false" data-user-id="${escapeHtml(String(m.userId))}" data-username="${escapeHtml(m.username)}">@${escapeHtml(m.username)}</span>`;
        cursor = m.end;
      }
    });

    html += textToEditorHtml(text.slice(cursor));
    el.innerHTML = html;
    placeCaretAtEnd();
  }, [value, currentVal]);

  // Focus on autoFocus
  useEffect(() => {
    if (autoFocus && editorRef.current) {
      editorRef.current.focus();
      // Move caret to end
      const range = document.createRange();
      range.selectNodeContents(editorRef.current);
      range.collapse(false);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      savedRangeRef.current = range.cloneRange();
    }
  }, [autoFocus]);

  const handleSelectSuggestion = useCallback((user) => {
    const node = activeNodeRef.current;
    if (!node || !node.parentNode) {
      setMentionActive(false);
      return;
    }

    const beforeAt = node.nodeValue.slice(0, atOffsetRef.current);
    const afterCaret = node.nodeValue.slice(caretOffsetRef.current);

    node.nodeValue = beforeAt;

    const pill = document.createElement('span');
    pill.className = styles.pill;
    pill.setAttribute('contenteditable', 'false');
    pill.setAttribute('data-user-id', user.id || user.username);
    pill.setAttribute('data-username', user.username);
    pill.innerText = `@${user.username}`;

    node.parentNode.insertBefore(pill, node.nextSibling);

    const afterNode = document.createTextNode(' ' + afterCaret);
    pill.parentNode.insertBefore(afterNode, pill.nextSibling);

    // Set caret after space
    const sel = window.getSelection();
    const newRange = document.createRange();
    newRange.setStart(afterNode, 1);
    newRange.setEnd(afterNode, 1);
    sel.removeAllRanges();
    sel.addRange(newRange);

    setMentionActive(false);
    handleInput();
  }, [handleInput]);

  const handleKeyDownInternal = useCallback((e) => {
    if (mentionActive && suggestions.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex(prev => (prev + 1) % suggestions.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex(prev => (prev - 1 + suggestions.length) % suggestions.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        handleSelectSuggestion(suggestions[selectedIndex]);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setMentionActive(false);
        return;
      }
    }

    if (singleLine && e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      // Call onSubmit (used by ChatInputArea) or fall back to onKeyDown
      if (onSubmit) {
        onSubmit();
      } else if (onKeyDown) {
        onKeyDown(e);
      }
      return;
    }

    if (onKeyDown) {
      onKeyDown(e);
    }
  }, [mentionActive, suggestions, selectedIndex, handleSelectSuggestion, singleLine, onSubmit, onKeyDown]);

  const handlePaste = useCallback((e) => {
    e.preventDefault();
    const html = e.clipboardData.getData('text/html');
    const text = e.clipboardData.getData('text/plain');

    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    range.deleteContents();

    // Only as much as still fits. Cut here, before it is in the DOM, so a huge
    // paste never has to be inserted and then taken back out.
    const room = maxChars > 0
      ? Math.max(0, maxChars - countChars(parseDOM().text))
      : Infinity;
    if (room === 0) {
      if (text) showToast(`This is limited to ${maxChars.toLocaleString('en-US')} characters`, 'info');
      handleInput();
      return;
    }
    const fittedText = Number.isFinite(room) ? clampChars(text, room) : text;
    if (fittedText !== text) {
      showToast(`Only ${maxChars.toLocaleString('en-US')} characters fit, so the paste was cut`, 'info');
    }

    if (html && html.includes('data-username') && countChars(text) <= room) {
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');
      const temp = doc.body;
      
      // Extract only safe text and mention pills
      const frag = document.createDocumentFragment();
      function cleanWalk(node) {
        if (node.nodeType === Node.TEXT_NODE) {
          frag.appendChild(document.createTextNode(node.nodeValue));
        } else if (node.nodeType === Node.ELEMENT_NODE) {
          if (node.hasAttribute('data-username')) {
            const pill = document.createElement('span');
            pill.className = styles.pill;
            pill.setAttribute('contenteditable', 'false');
            pill.setAttribute('data-user-id', node.getAttribute('data-user-id') || node.getAttribute('data-username'));
            pill.setAttribute('data-username', node.getAttribute('data-username'));
            pill.innerText = `@${node.getAttribute('data-username')}`;
            frag.appendChild(pill);
          } else if (node.hasAttribute('data-url')) {
            // A link chip copied from an older build pastes as its address,
            // as ordinary editable text.
            frag.appendChild(document.createTextNode(node.getAttribute('data-url') || ''));
          } else if (node.nodeName === 'BR') {
            frag.appendChild(document.createElement('br'));
          } else {
            for (let i = 0; i < node.childNodes.length; i++) {
              cleanWalk(node.childNodes[i]);
            }
          }
        }
      }
      for (let i = 0; i < temp.childNodes.length; i++) {
        cleanWalk(temp.childNodes[i]);
      }
      range.insertNode(frag);
      range.collapse(false);
    } else if (fittedText) {
      const textNode = document.createTextNode(fittedText);
      range.insertNode(textNode);
      range.collapse(false);
    }

    handleInput();
  }, [handleInput, maxChars, parseDOM]);

  // At the limit, a keystroke that would add characters is refused before it
  // reaches the DOM. Composition (most Android keyboards) cannot be refused;
  // what it commits past the limit is trimmed on compositionend instead.
  // Native listener: React's onBeforeInput is built on `textInput`/`keypress`,
  // which carry no inputType and miss Enter and line breaks.
  const handleBeforeInput = useCallback((e) => {
    if (!(maxChars > 0)) return;
    const type = e.inputType || '';
    if (!type.startsWith('insert') || type === 'insertCompositionText' || type === 'insertFromPaste') return;
    const sel = window.getSelection();
    const selected = sel && !sel.isCollapsed ? countChars(sel.toString()) : 0;
    // The text as of the last input (kept current by handleInput): no DOM walk per key.
    const room = maxChars - countChars(lastParsedTextRef.current ?? '') + selected;
    if (room <= 0) e.preventDefault();
  }, [maxChars]);

  useEffect(() => {
    const el = editorRef.current;
    if (!el) return undefined;
    el.addEventListener('beforeinput', handleBeforeInput);
    return () => el.removeEventListener('beforeinput', handleBeforeInput);
  }, [handleBeforeInput]);

  const handleCompositionStart = useCallback(() => {
    composingRef.current = true;
  }, []);

  const handleCompositionEnd = useCallback(() => {
    composingRef.current = false;
    // The final input event of a composition can arrive before this one, so
    // the limit is applied again now that the word is committed.
    handleInput();
  }, [handleInput]);

  return (
    <div className={`${styles.container} ${className}`} style={style} ref={containerRef}>
      <div
        ref={editorRef}
        className={styles.editor}
        contentEditable={true}
        inputMode={inputMode}
        onInput={handleInput}
        onCompositionStart={handleCompositionStart}
        onCompositionEnd={handleCompositionEnd}
        onKeyDown={handleKeyDownInternal}
        onKeyUp={saveSelection}
        onMouseUp={saveSelection}
        onTouchEnd={saveSelection}
        onPaste={handlePaste}
        onFocus={(e) => {
          saveSelection();
          if (onFocus) onFocus(e);
        }}
        onBlur={(e) => {
          saveSelection();
          // Delay closing so dropdown click can register
          setTimeout(() => setMentionActive(false), 200);
        }}
        data-placeholder={placeholder}
        data-empty="true"
        role="textbox"
        aria-multiline={!singleLine}
        aria-label={placeholder}
        aria-describedby={ariaDescribedBy}
        aria-invalid={ariaInvalid}
      />

      {mentionActive && (
        <MentionDropdown
          suggestions={suggestions}
          loading={loading}
          selectedIndex={selectedIndex}
          onSelect={handleSelectSuggestion}
          position={dropdownPos}
          onClose={() => setMentionActive(false)}
        />
      )}
    </div>
  );
}
