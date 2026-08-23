import { useState, useRef, useEffect, useCallback } from 'react';
import { useMentionSuggestions } from '../../hooks/useMentionSuggestions';
import MentionDropdown from './MentionDropdown';
import { cleanUrlDisplay } from '@shared/utils/linkPreview';
import { sanitizeUrl } from '@shared/utils/urlSanitize';
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

function convertUrlsToChipsHTML(text) {
  if (!text) return '';
  const urlRegex = /(https?:\/\/[^\s]+|www\.[^\s]+)/g;
  
  return escapeHtml(text).replace(urlRegex, (url) => {
    const cleanDisplay = cleanUrlDisplay(url);
    const truncatedDisplay = cleanDisplay.length > 40 ? cleanDisplay.slice(0, 37) + '...' : cleanDisplay;
    const cleanUrl = url.startsWith('www.') ? `https://${url}` : url;
    const safeUrl = sanitizeUrl(cleanUrl);
    return `<span class="${styles.urlChip}" contenteditable="false" data-url="${safeUrl}">[ ${truncatedDisplay} ]</span>`;
  });
}

function checkForUrlsAndConvertToChips(el) {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return;
  const range = sel.getRangeAt(0);
  const cursorNode = range.startContainer;
  const cursorOffset = range.startOffset;

  if (cursorNode.nodeType !== Node.TEXT_NODE) return;

  const textVal = cursorNode.nodeValue;
  const urlRegex = /(https?:\/\/[^\s]+|www\.[^\s]+)/i;
  const match = textVal.match(urlRegex);
  if (!match) return;

  const url = match[0];
  const urlIndex = match.index;
  
  // Only convert if cursor is past the end of the URL (meaning user typed space/completed URL)
  if (cursorOffset < urlIndex + url.length) {
    return;
  }

  const cleanDisplay = cleanUrlDisplay(url);
  const truncatedDisplay = cleanDisplay.length > 40 ? cleanDisplay.slice(0, 37) + '...' : cleanDisplay;

  const beforeText = textVal.slice(0, urlIndex);
  const afterText = textVal.slice(urlIndex + url.length);

  cursorNode.nodeValue = beforeText;

  const cleanUrl = url.startsWith('www.') ? `https://${url}` : url;
  const safeUrl = sanitizeUrl(cleanUrl);

  const chip = document.createElement('span');
  chip.className = styles.urlChip;
  chip.setAttribute('contenteditable', 'false');
  chip.setAttribute('data-url', safeUrl);
  chip.innerText = `[ ${truncatedDisplay} ]`;

  cursorNode.parentNode.insertBefore(chip, cursorNode.nextSibling);

  const afterNode = document.createTextNode(afterText);
  chip.parentNode.insertBefore(afterNode, chip.nextSibling);

  const newRange = document.createRange();
  const relativeOffset = cursorOffset - (urlIndex + url.length);
  newRange.setStart(afterNode, Math.min(relativeOffset, afterText.length));
  newRange.setEnd(afterNode, Math.min(relativeOffset, afterText.length));
  sel.removeAllRanges();
  sel.addRange(newRange);
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
  inputRef
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

  const { suggestions, loading } = useMentionSuggestions({
    query: mentionQuery,
    communityId,
    maxResults: 15
  });

  // Connect external inputRef if provided
  useEffect(() => {
    if (inputRef) {
      inputRef.current = editorRef.current;
    }
  }, [inputRef]);

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
          const rawUrl = node.getAttribute('data-url');
          textString += rawUrl;
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
   * Mirrors an externally-supplied value into the DOM — form resets, initial
   * load, a draft restored from elsewhere.
   *
   * While the editor has focus the DOM is authoritative and this effect keeps
   * its hands off, because rewriting `innerHTML` destroys the selection: the
   * caret jumps to the start of the field mid-word.
   *
   * It used to guard on `lastParsedTextRef.current === text` instead, which
   * held only while the parent's state was exactly in step with the DOM. Any
   * re-render carrying a value that had not caught up yet — a post refetch
   * landing after a comment was added or deleted, a `comment.created` socket
   * event, anything asynchronous — failed that check and rewrote the field
   * underneath the user. The character being typed was wiped and the caret was
   * thrown to position zero, which is what made spaces "not work" and made the
   * composer feel like it had stopped accepting input.
   *
   * The one external write worth honouring while focused is a clear, which is
   * how every caller resets the field after a successful submit.
   */
  useEffect(() => {
    const el = editorRef.current;
    if (!el) return;

    const { text, mentions = [] } = currentVal();
    const isFocused = document.activeElement === el;

    if (isFocused && text) {
      // Typing in progress. Whatever the parent is holding is at best an echo
      // of what is already on screen, and at worst stale.
      return;
    }

    lastParsedTextRef.current = text;

    if (!text) {
      // Skip the DOM write when it is already empty, so a parent that re-renders
      // on every keystroke cannot repeatedly reset a field the user just focused.
      if (el.innerHTML !== '') el.innerHTML = '';
      el.setAttribute('data-empty', 'true');
      return;
    }

    el.setAttribute('data-empty', 'false');

    if (!mentions || mentions.length === 0) {
      el.innerHTML = convertUrlsToChipsHTML(text).replace(/\n/g, '<br>');
      return;
    }

    // Sort mentions by start index
    const sorted = [...mentions].sort((a, b) => a.start - b.start);
    let html = '';
    let cursor = 0;

    sorted.forEach(m => {
      if (m.start >= cursor && m.end <= text.length && text.slice(m.start, m.end) === `@${m.username}`) {
        html += convertUrlsToChipsHTML(text.slice(cursor, m.start)).replace(/\n/g, '<br>');
        html += `<span class="${styles.pill}" contenteditable="false" data-user-id="${escapeHtml(String(m.userId))}" data-username="${escapeHtml(m.username)}">@${escapeHtml(m.username)}</span>`;
        cursor = m.end;
      }
    });

    html += convertUrlsToChipsHTML(text.slice(cursor)).replace(/\n/g, '<br>');
    el.innerHTML = html;
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
    }
  }, [autoFocus]);

  // Handle typing and caret check for @ suggestions
  const handleInput = useCallback(() => {
    const el = editorRef.current;
    if (!el) return;

    checkForUrlsAndConvertToChips(el);

    const parsed = parseDOM();
    lastParsedTextRef.current = parsed.text;
    el.setAttribute('data-empty', parsed.text ? 'false' : 'true');
    if (onChange) {
      onChange(parsed);
    }

    // Check caret for @ trigger
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
            const vh = window.visualViewport?.height || window.innerHeight;
            const spaceBelow = vh - refRect.bottom;
            const shouldOpenUpwards = singleLine || spaceBelow < 250;

            if (shouldOpenUpwards) {
              setDropdownPos({
                bottom: vh - refRect.top + 6,
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
  }, [onChange, parseDOM, singleLine]);

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

    if (html && html.includes('data-username')) {
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
            const chip = document.createElement('span');
            chip.className = styles.urlChip;
            chip.setAttribute('contenteditable', 'false');
            const safeUrl = sanitizeUrl(node.getAttribute('data-url'));
            chip.setAttribute('data-url', safeUrl);
            chip.innerText = node.innerText;
            frag.appendChild(chip);
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
    } else if (text) {
      const textNode = document.createTextNode(text);
      range.insertNode(textNode);
      range.collapse(false);
    }

    handleInput();
  }, [handleInput]);

  return (
    <div className={`${styles.container} ${className}`} style={style} ref={containerRef}>
      <div
        ref={editorRef}
        className={styles.editor}
        contentEditable={true}
        onInput={handleInput}
        onKeyDown={handleKeyDownInternal}
        onPaste={handlePaste}
        // PostComposer has always passed an onFocus (to expand itself the moment
        // the field is clicked) and this component never accepted it, so the
        // prop went nowhere. It was masked because the first keystroke expands
        // the composer too — the field just did not open until you typed.
        onFocus={onFocus}
        onBlur={() => {
          // Delay closing so dropdown click can register
          setTimeout(() => setMentionActive(false), 200);
        }}
        data-placeholder={placeholder}
        data-empty="true"
        role="textbox"
        aria-multiline={!singleLine}
        aria-label={placeholder}
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
