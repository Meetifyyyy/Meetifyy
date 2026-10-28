/** @vitest-environment jsdom */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/react';

vi.mock('@shared/hooks/useMentionSuggestions', () => ({
  useMentionSuggestions: () => ({ suggestions: [], loading: false }),
}));

const { default: MentionInput } = await import('../MentionInput');

/**
 * Links in the composers stay text.
 *
 * Typing a URL and a space used to replace it with a non-editable chip that
 * read "[ example.com/… ]", and the chip was sent as a sanitised copy of the
 * address, not what was typed. These pin the composer half of the fix: the
 * editor never grows a chip, and what it reports is exactly what was typed.
 */
const URLS = [
  'https://example.com/a?b=1&c=two#frag',
  'https://en.wikipedia.org/wiki/Foo_(bar)',
  'https://example.com/caf%C3%A9?q=%20x',
  'www.example.com/path',
  'http://x.test/a),',
];

afterEach(cleanup);

function typeInto(editor, text) {
  editor.textContent = text;
  // Caret at the end, as after typing.
  const range = document.createRange();
  range.selectNodeContents(editor);
  range.collapse(false);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
  fireEvent.input(editor);
}

describe('MentionInput: URLs stay as typed', () => {
  it.each(URLS)('keeps %s as plain, editable text after a space', (url) => {
    const onChange = vi.fn();
    const { container } = render(<MentionInput value="" onChange={onChange} />);
    const editor = container.querySelector('[role="textbox"]');
    const text = `see ${url} and more`;
    typeInto(editor, text);
    expect(editor.querySelector('[data-url]')).toBeNull();
    expect(editor.textContent).toBe(text);
    expect(onChange).toHaveBeenLastCalledWith({ text, mentions: [] });
  });

  it('keeps several links and the text around them, line breaks included', () => {
    const onChange = vi.fn();
    const { container } = render(<MentionInput value="" onChange={onChange} />);
    const editor = container.querySelector('[role="textbox"]');
    const text = `${URLS[0]} ${URLS[1]}\u00a0✓ ünïcode`;
    typeInto(editor, text);
    expect(onChange).toHaveBeenLastCalledWith({ text, mentions: [] });
  });

  it('restores a saved draft containing links as text, with no "[ ]"', () => {
    const text = `first ${URLS[0]}\nsecond ${URLS[3]}`;
    const { container } = render(<MentionInput value={{ text, mentions: [] }} onChange={() => {}} />);
    const editor = container.querySelector('[role="textbox"]');
    expect(editor.querySelector('[data-url]')).toBeNull();
    expect(editor.textContent).not.toMatch(/\[ /);
    expect(editor.innerHTML).toContain('<br>');
    expect(editor.textContent).toBe(text.replace('\n', ''));
  });

  it('escapes markup typed as text in a restored draft', () => {
    const text = '<img src=x onerror=alert(1)> https://e.com/?a=<b>';
    const { container } = render(<MentionInput value={{ text, mentions: [] }} onChange={() => {}} />);
    const editor = container.querySelector('[role="textbox"]');
    expect(editor.querySelector('img, b')).toBeNull();
    expect(editor.textContent).toBe(text);
  });
});
