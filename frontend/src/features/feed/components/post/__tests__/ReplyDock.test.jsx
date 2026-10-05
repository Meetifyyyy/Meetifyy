/** @vitest-environment jsdom */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { useState } from 'react';
import { render, fireEvent, cleanup } from '@testing-library/react';

afterEach(cleanup);

globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };

vi.mock('@shared/components/avatar/Avatar', () => ({ default: () => <span data-testid="avatar" /> }));
// The real editor pulls in the mention search; its contract here is just
// "a textbox that reports { text, mentions }".
vi.mock('@shared/components/mentions/MentionInput', () => ({
  default: ({ placeholder, value, onChange, onFocus, inputRef }) => (
    <input
      ref={inputRef}
      role="textbox"
      placeholder={placeholder}
      value={value.text}
      onFocus={onFocus}
      onChange={(e) => onChange({ text: e.target.value, mentions: [] })}
    />
  ),
}));

const { default: ReplyDock } = await import('../ReplyDock');

function Harness({ onSubmit = vi.fn(), isPosting = false }) {
  const [value, setValue] = useState({ text: '', mentions: [] });
  return (
    <ReplyDock
      currentUser={{ displayName: 'Me' }}
      value={value}
      onChange={setValue}
      onSubmit={(e) => { e.preventDefault(); onSubmit(value); }}
      isPosting={isPosting}
    />
  );
}

const dock = () => document.querySelector('[data-send]');
const sendButton = () => document.querySelector('button[type="submit"]');

describe('ReplyDock', () => {
  it('rests as the reader\'s avatar and "Post your reply..."', () => {
    render(<Harness />);
    expect(document.querySelector('[data-testid="avatar"]')).toBeTruthy();
    expect(document.querySelector('[role="textbox"]').getAttribute('placeholder')).toBe('Post your reply...');
  });

  it('is portalled to <body>, out of any clipping ancestor', () => {
    const { container } = render(<Harness />);
    expect(container.querySelector('[role="textbox"]')).toBeNull();
    expect(dock().parentElement).toBe(document.body);
  });

  it('offers no Send while there is nothing to send', () => {
    render(<Harness />);
    expect(dock().getAttribute('data-send')).toBe('closed');
    expect(sendButton().disabled).toBe(true);
    // Not reachable by keyboard while its slot is closed.
    expect(sendButton().tabIndex).toBe(-1);
  });

  it('opens the Send slot as soon as there is text, and closes it when cleared', () => {
    render(<Harness />);
    const input = document.querySelector('[role="textbox"]');
    fireEvent.change(input, { target: { value: 'hi' } });
    expect(dock().getAttribute('data-send')).toBe('open');
    expect(sendButton().disabled).toBe(false);
    fireEvent.change(input, { target: { value: '   ' } });
    // Whitespace alone is not something to send.
    expect(dock().getAttribute('data-send')).toBe('closed');
  });

  it('submits what was typed', () => {
    const onSubmit = vi.fn();
    render(<Harness onSubmit={onSubmit} />);
    fireEvent.change(document.querySelector('[role="textbox"]'), { target: { value: 'nice post' } });
    fireEvent.click(sendButton());
    expect(onSubmit).toHaveBeenCalledWith({ text: 'nice post', mentions: [] });
  });

  it('keeps the Send slot open but disabled while posting', () => {
    render(<Harness isPosting />);
    expect(dock().getAttribute('data-send')).toBe('open');
    expect(sendButton().disabled).toBe(true);
  });

  it('does not take focus from the field when Send is pressed', () => {
    render(<Harness />);
    const input = document.querySelector('[role="textbox"]');
    fireEvent.change(input, { target: { value: 'hi' } });
    // preventDefault on pointerdown is what keeps the keyboard up.
    const notPrevented = fireEvent.pointerDown(sendButton());
    expect(notPrevented).toBe(false);
  });

  it('marks itself focused while the field has focus', () => {
    render(<Harness />);
    expect(dock().getAttribute('data-focused')).toBe('false');
    fireEvent.focus(document.querySelector('[role="textbox"]'));
    expect(dock().getAttribute('data-focused')).toBe('true');
  });

  describe('replying to a comment', () => {
    it('tags the bar with the target and asks for that reply', () => {
      render(<ReplyDock currentUser={{}} value={{ text: '', mentions: [] }} onChange={() => {}} onSubmit={() => {}} replyingTo="diya" onCancelReply={() => {}} />);
      expect(dock().textContent).toContain('Replying to @diya');
      expect(document.querySelector('[role="textbox"]').getAttribute('placeholder')).toBe('Reply to @diya…');
    });

    it('drops the target from the × and from Escape', () => {
      const onCancelReply = vi.fn();
      render(<ReplyDock currentUser={{}} value={{ text: '', mentions: [] }} onChange={() => {}} onSubmit={() => {}} replyingTo="diya" onCancelReply={onCancelReply} />);
      fireEvent.click(document.querySelector('[aria-label="Cancel reply"]'));
      fireEvent.keyDown(document.querySelector('[role="textbox"]'), { key: 'Escape' });
      expect(onCancelReply).toHaveBeenCalledTimes(2);
    });

    it('shows no tag when commenting on the post', () => {
      render(<Harness />);
      expect(document.querySelector('[aria-label="Cancel reply"]')).toBeNull();
    });

    it('renders in place, not in a portal, when inline', () => {
      const { container } = render(<ReplyDock inline currentUser={{}} value={{ text: '', mentions: [] }} onChange={() => {}} onSubmit={() => {}} />);
      expect(container.querySelector('[role="textbox"]')).toBeTruthy();
    });
  });
});
