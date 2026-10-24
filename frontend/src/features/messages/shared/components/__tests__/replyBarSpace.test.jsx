/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';

vi.mock('@shared/components/mentions/MentionInput', () => ({
  default: ({ value, onChange }) => (
    <input data-testid="editor" value={typeof value === 'string' ? value : value?.text ?? ''} onChange={(e) => onChange({ text: e.target.value, mentions: [] })} />
  ),
}));
vi.mock('@shared/components/ui/LazyEmojiPicker', () => ({ default: () => <div />, preloadEmojiPicker: () => {} }));
vi.mock('@features/messages/hooks/useVoiceRecorder', () => ({
  useVoiceRecorder: () => ({
    isRecording: false, isUploading: false, recordingTime: 0, startRecording: () => {}, deleteRecording: () => {},
    sendRecording: () => {}, formatDuration: () => '0:00', levelsRef: { current: [] },
  }),
}));
vi.mock('@shared/utils/toast', () => ({ showToast: () => {} }));

const { default: ChatInputArea } = await import('../ChatInputArea');

/**
 * The reply bar floats above the composer and takes no room of its own, so the
 * thread ran underneath it and its last messages were covered. The composer now
 * reserves the bar's measured height (`--reply-bar-h`, read as a margin by the
 * stylesheet) so the thread ends above the bar. jsdom has no layout, so the
 * bar's height is supplied here; what is under test is that it is measured,
 * kept up to date, and let go of.
 */
let barHeight;
let observers;
const realRect = Element.prototype.getBoundingClientRect;

beforeEach(() => {
  barHeight = 57.2;
  observers = [];
  globalThis.ResizeObserver = class {
    constructor(cb) { this.cb = cb; observers.push(this); }
    observe() {}
    unobserve() {}
    disconnect() { observers = observers.filter((o) => o !== this); }
  };
  // Only the bar itself (`.msgReplyPreview`, not its label or button) has a height.
  Element.prototype.getBoundingClientRect = function rect() {
    const isBar = /msgReplyPreview(_|$|\s)/.test(String(this.className));
    return { x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: isBar ? barHeight : 0 };
  };
  localStorage.clear();
  localStorage.setItem('currentUser', JSON.stringify({ id: 'u1' }));
});

afterEach(() => {
  cleanup();
  Element.prototype.getBoundingClientRect = realRect;
  delete globalThis.ResizeObserver;
});

const chat = { id: 'c1', type: 'DM', name: 'Aarav', targetUser: { id: 't1' } };
const reply = { id: 'm1', from: 'them', senderName: 'Aarav', text: 'quoted text' };
const wrapOf = (container) => container.firstChild;
const reserved = (container) => wrapOf(container).style.getPropertyValue('--reply-bar-h');

describe('the composer reserves room for the reply bar', () => {
  it('reserves nothing when there is no reply', () => {
    const { container } = render(<ChatInputArea conversation={chat} onSend={() => {}} />);
    expect(reserved(container)).toBe('');
  });

  it('reserves the bar\'s measured height, rounded up so it never falls short', () => {
    const { container } = render(<ChatInputArea conversation={chat} onSend={() => {}} replyingTo={reply} onCancelReply={() => {}} />);
    expect(reserved(container)).toBe('58px');
  });

  it('follows the bar when its height changes while open (a quoted image arriving)', () => {
    const { container } = render(<ChatInputArea conversation={chat} onSend={() => {}} replyingTo={reply} onCancelReply={() => {}} />);
    expect(reserved(container)).toBe('58px');
    barHeight = 120;
    act(() => observers.forEach((o) => o.cb()));
    expect(reserved(container)).toBe('120px');
  });

  it('lets go of the room when the reply is dismissed or sent', () => {
    const { container, rerender } = render(<ChatInputArea conversation={chat} onSend={() => {}} replyingTo={reply} onCancelReply={() => {}} />);
    expect(reserved(container)).toBe('58px');
    rerender(<ChatInputArea conversation={chat} onSend={() => {}} replyingTo={null} onCancelReply={() => {}} />);
    expect(reserved(container)).toBe('');
    expect(observers).toHaveLength(0); // and stops watching a bar that is gone
  });

  it('names who is being replied to, in sentence case', () => {
    const { container } = render(<ChatInputArea conversation={chat} onSend={() => {}} replyingTo={reply} onCancelReply={() => {}} />);
    expect(container.textContent).toContain('Replying to Aarav');
    expect(container.textContent).not.toContain('REPLYING');
  });
});
