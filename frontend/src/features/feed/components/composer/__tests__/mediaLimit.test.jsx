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
  processAndUploadImage: () => new Promise(() => {}),
  processAndUploadVideo: () => new Promise(() => {}),
}));
vi.mock('@shared/api/apiClient', () => ({
  // Added with the cookie migration: AuthContext reads these to decide whether
  // a cookie session is worth recovering, and to carry the CSRF token the
  // server returns in the body of every session-issuing response.
  readCsrfCookie: () => '',
  mayHaveCookieSession: () => false,
  rememberCsrfToken: () => {},
  forgetCsrfToken: () => {},
  authApi: {
    currentSession: async () => ({ user: null }),
    adoptSession: async () => ({}),
    logoutSession: async () => ({}),
  }, uploadsApi: {} }));
vi.mock('@shared/utils/toast', () => ({ showToast: () => {} }));

const { default: PostComposer, MAX_POST_MEDIA, mediaLimitNotice } = await import('../PostComposer');

URL.createObjectURL = vi.fn(() => `blob:${Math.random()}`);
URL.revokeObjectURL = vi.fn();

const images = (n) => Array.from({ length: n }, (_, i) => new File(['x'], `p${i}.jpg`, { type: 'image/jpeg' }));
const imageInput = (c) => c.querySelector('input[type="file"][multiple]:not([accept^="video"])');
const pick = (c, files) => fireEvent.change(imageInput(c), { target: { files } });
const counter = (c) => c.querySelector('[aria-label$="photos and videos added"]')?.textContent;

describe('post media limit', () => {
  it('keeps the first six of a larger pick and says how many were left out', () => {
    const { container, getByRole } = render(<PostComposer onSubmit={() => {}} />);
    pick(container, images(8));
    expect(counter(container)).toBe(`${MAX_POST_MEDIA}/${MAX_POST_MEDIA}`);
    expect(getByRole('alert').textContent).toMatch(/Only 6 of the 8 you selected were added/);
  });

  it('does not open the picker when full, and explains why instead', () => {
    const { container, getByRole } = render(<PostComposer onSubmit={() => {}} />);
    pick(container, images(6));
    const click = vi.spyOn(imageInput(container), 'click');
    fireEvent.click(container.querySelector('button[title^="Maximum"]'));
    expect(click).not.toHaveBeenCalled();
    expect(getByRole('alert').textContent).toMatch(/already added 6/);
  });

  it('lets a second pick fill only the slots that are left', () => {
    const { container, getByRole } = render(<PostComposer onSubmit={() => {}} />);
    pick(container, images(4));
    pick(container, images(4));
    expect(counter(container)).toBe('6/6');
    expect(getByRole('alert').textContent).toMatch(/Only 2 of the 4/);
  });

  it('accepts a pick that fits without any warning', () => {
    const { container, queryByRole } = render(<PostComposer onSubmit={() => {}} />);
    pick(container, images(3));
    expect(counter(container)).toBe('3/6');
    expect(queryByRole('alert')).toBeNull();
  });
});

describe('mediaLimitNotice', () => {
  it('is silent when everything fit', () => {
    expect(mediaLimitNotice({ selected: 2, added: 2, attachedBefore: 0 })).toBeNull();
  });
  it('uses the singular for one', () => {
    expect(mediaLimitNotice({ selected: 3, added: 1, attachedBefore: 5 })).toMatch(/Only 1 of the 3 you selected was added/);
  });
});
