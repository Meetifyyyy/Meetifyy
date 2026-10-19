/** @vitest-environment jsdom */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, cleanup, act } from '@testing-library/react';

afterEach(cleanup);

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
vi.mock('@shared/utils/toast', () => ({ showToast: () => {} }));

const { default: PostComposer } = await import('../PostComposer');

const field = () => document.querySelector('[data-testid="post-text"]');
const type = (text) => fireEvent.change(field(), { target: { value: text } });
const counter = () => document.querySelector('span[data-over]');
const number = () => counter()?.querySelector('span');
const postButton = () => document.querySelector('button[title="Post"]');
const chars = (n) => 'a'.repeat(n);

describe('PostComposer: the 2,000-character limit', () => {
  it('shows no ring for an empty draft', () => {
    render(<PostComposer onSubmit={vi.fn()} />);
    expect(counter()).toBeNull();
  });

  it('shows a ring that fills with the draft, with no number yet', () => {
    render(<PostComposer onSubmit={vi.fn()} />);
    type(chars(500));
    expect(counter().getAttribute('data-progress')).toBe('0.250');
    expect(counter().style.getPropertyValue('--limit-red')).toBe('0%');
    expect(number()).toBeNull();
    expect(postButton().disabled).toBe(false);
  });

  it('from 1,800 shows what is left and turns towards red', () => {
    render(<PostComposer onSubmit={vi.fn()} />);
    type(chars(1900));
    expect(number().textContent).toBe('100');
    expect(counter().getAttribute('data-near')).toBe('true');
    expect(counter().style.getPropertyValue('--limit-red')).toBe('50%');
    expect(postButton().disabled).toBe(false);
    expect(field().getAttribute('aria-describedby')).toBe(number().id);
  });

  it('posts exactly 2,000 characters', async () => {
    const onSubmit = vi.fn(async () => {});
    render(<PostComposer onSubmit={onSubmit} />);
    type(chars(2000));
    expect(number().textContent).toBe('0');
    expect(counter().getAttribute('data-progress')).toBe('1.000');
    await act(async () => { fireEvent.click(postButton()); });
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0][0]).toHaveLength(2000);
  });

  it('blocks 2,001 characters, says by how much, and does not submit', async () => {
    const onSubmit = vi.fn(async () => {});
    render(<PostComposer onSubmit={onSubmit} />);
    type(chars(2001));
    expect(number().textContent).toBe('-1');
    expect(counter().style.getPropertyValue('--limit-red')).toBe('100%');
    expect(counter().getAttribute('data-over')).toBe('true');
    expect(postButton().disabled).toBe(true);
    expect(field().getAttribute('aria-invalid')).toBe('true');
    await act(async () => { fireEvent.keyDown(field(), { key: 'Enter', ctrlKey: true }); });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('judges a large paste as a whole, and re-enables Post once shortened', () => {
    render(<PostComposer onSubmit={vi.fn()} />);
    type(chars(2600));
    expect(number().textContent).toBe('-600');
    expect(postButton().disabled).toBe(true);
    type(chars(1900));
    expect(postButton().disabled).toBe(false);
  });

  it('counts the text as it is sent: trimmed, extra blank lines collapsed', () => {
    render(<PostComposer onSubmit={vi.fn()} />);
    // 2,000 characters of content wrapped in whitespace the composer drops.
    type(`   ${chars(1000)}\n\n\n\n${chars(998)}   `);
    expect(number().textContent).toBe('0');
    expect(postButton().disabled).toBe(false);
  });
});
