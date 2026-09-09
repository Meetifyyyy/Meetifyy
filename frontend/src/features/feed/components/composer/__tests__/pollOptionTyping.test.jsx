/** @vitest-environment jsdom */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/react';

afterEach(cleanup);

globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
if (!window.matchMedia) {
  window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
}

/**
 * A stand-in for the real mention editor, which is a contenteditable with its
 * own selection handling. What matters here is only that it exposes `focus()`
 * through the same imperative ref the composer uses — because the bug was the
 * composer calling that `focus()` at the wrong moment.
 */
vi.mock('@shared/components/mentions/MentionInput', () => ({
  default: ({ inputRef, placeholder }) => {
    if (inputRef) {
      inputRef.current = {
        focus: () => document.getElementById('mock-mention-input')?.focus(),
      };
    }
    return <div id="mock-mention-input" tabIndex={-1} data-placeholder={placeholder} />;
  },
}));

vi.mock('@shared/context/AuthContext', () => ({
  useAuth: () => ({ loading: false, currentUser: { id: 'me', displayName: 'Me', username: 'me' } }),
}));
vi.mock('@shared/components/avatar/Avatar', () => ({ default: () => <div /> }));
vi.mock('@shared/components/ui/LazyEmojiPicker', () => ({ default: () => <div /> }));
vi.mock('../../post/MediaGrid', () => ({ default: () => <div /> }));
vi.mock('@shared/utils/mediaPipeline', () => ({
  processAndUploadImage: async () => ({}),
  processAndUploadVideo: async () => ({}),
}));
vi.mock('@shared/api/apiClient', () => ({ uploadsApi: {} }));
vi.mock('@shared/utils/toast', () => ({ showToast: () => {} }));

const { default: PostComposer } = await import('../PostComposer');

/** Opens the inline poll editor and returns the option inputs. */
function openPoll(container) {
  fireEvent.click(container.querySelector('button[title="Poll"]'));
  return () => [...container.querySelectorAll('input')].filter((i) =>
    /^Option /.test(i.placeholder || ''),
  );
}

/**
 * jsdom does not move focus on a synthetic click the way a browser does, so
 * focus is set explicitly first. That is exactly the condition under test: the
 * question is whether the click that FOLLOWS takes focus away again.
 */
function clickInto(input) {
  input.focus();
  fireEvent.click(input);
}

/**
 * The element carrying the click handler — the inner composer, not the outer
 * `postComposerWrapper`, whose name would also match a looser selector.
 */
function composerBody(container) {
  return [...container.querySelectorAll('div')].find((el) =>
    /(^|\s|_)postComposer_/.test(el.className || ''),
  );
}

describe('PostComposer — typing into poll options', () => {
  /**
   * The bug: the composer wrapper carried an `onClick` that focused the main
   * text field, as a convenience for clicking its empty area. That wrapper also
   * CONTAINS the poll editor, so a click into a poll option bubbled up and had
   * focus yanked straight back to the post text — every keystroke went into the
   * post instead of the option, and the fields looked impossible to type into.
   */
  it('keeps focus in the option a click landed on', () => {
    const { container } = render(<PostComposer onSubmit={async () => {}} />);
    const options = openPoll(container);

    const first = options()[0];
    clickInto(first);

    expect(document.activeElement).toBe(first);
  });

  it('lets every option be typed into, including one added later', () => {
    const { container } = render(<PostComposer onSubmit={async () => {}} />);
    const options = openPoll(container);

    clickInto(options()[0]);
    fireEvent.change(options()[0], { target: { value: 'Pizza' } });
    clickInto(options()[1]);
    fireEvent.change(options()[1], { target: { value: 'Biryani' } });

    fireEvent.click(container.querySelector('button[title="Add option"]'));
    clickInto(options()[2]);
    fireEvent.change(options()[2], { target: { value: 'Dosa' } });

    expect(options().map((i) => i.value)).toEqual(['Pizza', 'Biryani', 'Dosa']);
    expect(document.activeElement).toBe(options()[2]);
  });

  /**
   * The convenience the guard must not break: clicking the composer's own inert
   * area still focuses the text field.
   */
  it('still focuses the text field when the click lands on empty composer space', () => {
    const { container } = render(<PostComposer onSubmit={async () => {}} />);
    fireEvent.click(composerBody(container));

    expect(document.activeElement).toBe(container.querySelector('#mock-mention-input'));
  });

  it('enforces a 100-character limit on poll options and displays remaining count', () => {
    const { container } = render(<PostComposer onSubmit={async () => {}} />);
    const options = openPoll(container);

    const first = options()[0];
    expect(first.getAttribute('maxlength')).toBe('100');

    // Entering a string longer than 100 characters is capped at 100
    const overLimit = 'a'.repeat(160);
    clickInto(first);
    fireEvent.change(first, { target: { value: overLimit } });

    expect(first.value.length).toBe(100);
    expect(first.value).toBe('a'.repeat(100));

    // The counter appears in the last 30 characters; at the cap it reads 0 left
    expect(container.textContent).toContain('0');

    // Inside the counter's window but under the cap: 80 characters leaves 20
    fireEvent.change(first, { target: { value: 'b'.repeat(80) } });
    expect(first.value.length).toBe(80);
    expect(container.textContent).toContain('20');
  });
});
