/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, cleanup, act } from '@testing-library/react';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
if (!window.matchMedia) {
  window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
}

/**
 * A plain textarea in place of the contenteditable mention editor: what
 * matters here is the value the composer receives and the aria wiring it
 * passes back, not the editor itself.
 */
vi.mock('@shared/components/mentions/MentionInput', () => ({
  default: ({ inputRef, value, onChange, onSubmit, ariaDescribedBy, ariaInvalid }) => {
    if (inputRef) inputRef.current = { focus: () => {} };
    return (
      <textarea
        data-testid="post-text"
        value={value?.text || ''}
        aria-describedby={ariaDescribedBy}
        aria-invalid={ariaInvalid}
        onChange={(e) => onChange({ text: e.target.value, mentions: [] })}
        onKeyDown={(e) => { if (e.key === 'Enter' && e.ctrlKey) onSubmit?.(); }}
      />
    );
  },
}));

vi.mock('@shared/context/AuthContext', () => ({
  useAuth: () => ({ loading: false, currentUser: { id: 'me', displayName: 'Me', username: 'me' } }),
}));
vi.mock('@shared/components/avatar/Avatar', () => ({ default: () => <div /> }));
vi.mock('@shared/components/ui/LazyEmojiPicker', () => ({ default: () => <div /> }));
vi.mock('../../post/MediaGrid', () => ({ default: () => <div /> }));
vi.mock('@shared/utils/mediaPipeline', () => ({
  processAndUploadImage: () => new Promise(() => {}),
  processAndUploadVideo: () => new Promise(() => {}),
}));
vi.mock('@shared/api/apiClient', () => ({
  readCsrfCookie: () => '',
  mayHaveCookieSession: () => false,
  rememberCsrfToken: () => {},
  forgetCsrfToken: () => {},
  authApi: {
    currentSession: async () => ({ user: null }),
    adoptSession: async () => ({}),
    logoutSession: async () => ({}),
  },
  uploadsApi: {},
}));
const { showToast } = vi.hoisted(() => ({ showToast: vi.fn() }));
vi.mock('@shared/utils/toast', () => ({ showToast }));

const { default: PostComposer } = await import('../PostComposer');

const field = () => document.querySelector('[data-testid="post-text"]');
const type = (text) => fireEvent.change(field(), { target: { value: text } });
const postButton = () => document.querySelector('button[title="Post"]');

let onLine;

/**
 * Posting offline is refused, not queued: the text stays where it was typed
 * (and in its saved draft), nothing is sent, no spinner starts and nothing
 * claims success. Posting again online works and sends exactly once.
 */
describe('PostComposer offline', () => {
  beforeEach(() => {
    onLine = false;
    vi.spyOn(window.navigator, 'onLine', 'get').mockImplementation(() => onLine);
    showToast.mockReset();
  });

  it('refuses to post, keeps the text, shows no success and no stuck spinner', async () => {
    const onSubmit = vi.fn(async () => {});
    render(<PostComposer onSubmit={onSubmit} />);
    type('Anyone up for chai at 5?');

    await act(async () => { fireEvent.click(postButton()); });

    expect(onSubmit).not.toHaveBeenCalled();
    expect(field().value).toBe('Anyone up for chai at 5?');
    expect(showToast).toHaveBeenCalledTimes(1);
    expect(showToast.mock.calls[0][0]).toMatch(/offline.*draft.*back online/i);
    expect(showToast.mock.calls[0][1]).toBe('error');
    expect(showToast.mock.calls.some((c) => c[1] === 'success')).toBe(false);
    // Not busy: the button can be pressed again.
    expect(postButton().disabled).toBe(false);
  });

  it('posts once when it is pressed again after reconnecting', async () => {
    const onSubmit = vi.fn(async () => {});
    render(<PostComposer onSubmit={onSubmit} />);
    type('Back with signal');
    await act(async () => { fireEvent.click(postButton()); });
    expect(onSubmit).not.toHaveBeenCalled();

    onLine = true;
    window.dispatchEvent(new Event('online'));
    // Reconnecting alone sends nothing: the person has to press Post.
    await act(async () => { await Promise.resolve(); });
    expect(onSubmit).not.toHaveBeenCalled();

    await act(async () => { fireEvent.click(postButton()); });
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0][0]).toBe('Back with signal');
  });

  it('a request lost mid-send keeps the text and says it can be retried', async () => {
    onLine = true;
    const onSubmit = vi.fn(async () => { throw new TypeError('Failed to fetch'); });
    render(<PostComposer onSubmit={onSubmit} />);
    type('Half-sent post');
    await act(async () => { fireEvent.click(postButton()); });

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(field().value).toBe('Half-sent post');
    expect(showToast.mock.calls[0][0]).toMatch(/kept; try again/i);
    expect(postButton().disabled).toBe(false);
  });
});
