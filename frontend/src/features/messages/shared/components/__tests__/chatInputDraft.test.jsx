/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, cleanup, act } from '@testing-library/react';

/**
 * A plain input standing in for the contenteditable mention editor. It reads
 * `value.text` and reports `{ text, mentions }` like the real one, which is all
 * the composer's draft handling depends on.
 */
vi.mock('@shared/components/mentions/MentionInput', () => ({
  default: ({ value, onChange, onSubmit }) => (
    <input
      data-testid="editor"
      value={typeof value === 'string' ? value : value?.text ?? ''}
      onChange={(e) => onChange({ text: e.target.value, mentions: [] })}
      onKeyDown={(e) => { if (e.key === 'Enter') onSubmit?.(); }}
    />
  ),
}));
vi.mock('@shared/components/ui/LazyEmojiPicker', () => ({
  default: () => <div />,
  preloadEmojiPicker: () => {},
}));
vi.mock('@features/messages/hooks/useVoiceRecorder', () => ({
  useVoiceRecorder: () => ({
    isRecording: false,
    isUploading: false,
    recordingTime: 0,
    startRecording: () => {},
    deleteRecording: () => {},
    sendRecording: () => {},
    formatDuration: () => '0:00',
    levelsRef: { current: [] },
  }),
}));
vi.mock('@shared/utils/toast', () => ({ showToast: () => {} }));

const { default: ChatInputArea } = await import('../ChatInputArea');

const DRAFT_KEY = (scope) => `meetifyy_draft:v1:u1:${scope}`;

const chat = (id) => ({ id, type: 'DM', targetUser: { id: 't1' } });

const type = (container, text) =>
  fireEvent.change(container.querySelector('[data-testid="editor"]'), { target: { value: text } });
const editorValue = (container) => container.querySelector('[data-testid="editor"]').value;
const pause = () => act(() => { vi.advanceTimersByTime(500); });

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  localStorage.setItem('currentUser', JSON.stringify({ id: 'u1' }));
  localStorage.setItem('loggedIn', 'true');
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('ChatInputArea persistent drafts', () => {
  it('a half-typed message survives unmount and remount of the same chat', () => {
    const first = render(<ChatInputArea conversation={chat('c1')} onSend={() => {}} />);
    type(first.container, 'half a thought');
    pause();
    first.unmount();

    const second = render(<ChatInputArea conversation={chat('c1')} onSend={() => {}} />);
    // Already there in the very first render: no effect has had to run.
    expect(editorValue(second.container)).toBe('half a thought');
  });

  it('is saved on unmount even before the typing pause elapses', () => {
    const first = render(<ChatInputArea conversation={chat('c1')} onSend={() => {}} />);
    type(first.container, 'quick exit');
    first.unmount();
    expect(JSON.parse(localStorage.getItem(DRAFT_KEY('chat:c1'))).text).toBe('quick exit');
  });

  it('keeps one draft per conversation when switching chats', () => {
    const { container, rerender } = render(<ChatInputArea conversation={chat('c1')} onSend={() => {}} />);
    type(container, 'for chat one');

    rerender(<ChatInputArea conversation={chat('c2')} onSend={() => {}} />);
    expect(editorValue(container)).toBe('');
    type(container, 'for chat two');

    rerender(<ChatInputArea conversation={chat('c1')} onSend={() => {}} />);
    expect(editorValue(container)).toBe('for chat one');
    rerender(<ChatInputArea conversation={chat('c2')} onSend={() => {}} />);
    expect(editorValue(container)).toBe('for chat two');
  });

  it('is cleared once the message is sent', () => {
    const onSend = vi.fn();
    const first = render(<ChatInputArea conversation={chat('c1')} onSend={onSend} />);
    type(first.container, 'sending this');
    pause();
    expect(localStorage.getItem(DRAFT_KEY('chat:c1'))).not.toBeNull();

    fireEvent.click(first.getByTitle('Send'));
    expect(onSend).toHaveBeenCalledWith('c1', 'sending this', undefined, [], null, null, null, null);
    expect(editorValue(first.container)).toBe('');
    // No waiting for the typing pause: a quick kill must not resurrect it.
    expect(localStorage.getItem(DRAFT_KEY('chat:c1'))).toBeNull();
    first.unmount();

    const second = render(<ChatInputArea conversation={chat('c1')} onSend={onSend} />);
    expect(editorValue(second.container)).toBe('');
  });

  it('a chat that does not exist yet is keyed by its draft_<userId> id', () => {
    const first = render(<ChatInputArea conversation={chat('draft_t1')} onSend={() => {}} />);
    type(first.container, 'hello stranger');
    pause();
    expect(localStorage.getItem(DRAFT_KEY('chat:draft_t1'))).not.toBeNull();
  });

  it('does not persist for the unresolved placeholder conversation', () => {
    const first = render(<ChatInputArea conversation={chat('new')} onSend={() => {}} />);
    type(first.container, 'nowhere to keep this');
    pause();
    first.unmount();
    expect(Object.keys(localStorage).filter((k) => k.startsWith('meetifyy_draft:'))).toEqual([]);
  });
});
