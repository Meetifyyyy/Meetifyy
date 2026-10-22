/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useComposerDraft } from '../useComposerDraft';
import { saveDraft, readDraft } from '@shared/lib/drafts';

const empty = { text: '', mentions: [] };
const pause = () => act(() => { vi.advanceTimersByTime(500); });

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  localStorage.setItem('currentUser', JSON.stringify({ id: 'u1' }));
  localStorage.setItem('loggedIn', 'true');
});
afterEach(() => vi.useRealTimers());

describe('useComposerDraft', () => {
  it('starts from the saved draft in the first render', () => {
    saveDraft('comment:p1', 'saved reply');
    const { result } = renderHook(() => useComposerDraft('comment:p1'));
    expect(result.current[0].text).toBe('saved reply');
  });

  it('debounces writes and does not rewrite a restored draft', () => {
    saveDraft('comment:p1', 'saved');
    const spy = vi.spyOn(Storage.prototype, 'setItem');
    const { result } = renderHook(() => useComposerDraft('comment:p1'));
    pause();
    expect(spy).not.toHaveBeenCalled();

    act(() => result.current[1]({ text: 'saved!', mentions: [] }));
    act(() => result.current[1]({ text: 'saved!!', mentions: [] }));
    expect(spy).not.toHaveBeenCalled();
    pause();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(readDraft('comment:p1').text).toBe('saved!!');
    spy.mockRestore();
  });

  it('emptying deletes at once, and a failed-submit restore saves it again', () => {
    const { result } = renderHook(() => useComposerDraft('comment:p1'));
    act(() => result.current[1]({ text: 'my comment', mentions: [] }));
    pause();

    // Submit: the composer clears right away.
    const draft = result.current[0];
    act(() => result.current[1](empty));
    expect(readDraft('comment:p1')).toBeNull();

    // The post failed: the existing code puts the draft back unless typing began.
    act(() => result.current[1]((cur) => (cur.text.trim() ? cur : draft)));
    pause();
    expect(readDraft('comment:p1').text).toBe('my comment');
  });

  it('keeps mentions with the text', () => {
    const { result, unmount } = renderHook(() => useComposerDraft('comment:p1'));
    const mentions = [{ userId: 'u9', username: 'sam', start: 0, end: 4 }];
    act(() => result.current[1]({ text: '@sam hi', mentions }));
    unmount();
    expect(readDraft('comment:p1')).toEqual({ text: '@sam hi', mentions });
  });

  it('swaps drafts when the scope changes and saves the one it left', () => {
    const { result, rerender } = renderHook(({ scope }) => useComposerDraft(scope), {
      initialProps: { scope: 'comment:p1' },
    });
    act(() => result.current[1]({ text: 'on post one', mentions: [] }));
    rerender({ scope: 'comment:p2' });
    expect(result.current[0]).toEqual(empty);
    expect(readDraft('comment:p1').text).toBe('on post one');
    expect(readDraft('comment:p2')).toBeNull();
  });

  it('writes pending text when the page is hidden', () => {
    const { result } = renderHook(() => useComposerDraft('comment:p1'));
    act(() => result.current[1]({ text: 'before the kill', mentions: [] }));
    expect(readDraft('comment:p1')).toBeNull();
    act(() => { window.dispatchEvent(new Event('pagehide')); });
    expect(readDraft('comment:p1').text).toBe('before the kill');
  });

  it('a falsy scope turns persistence off', () => {
    const { result, unmount } = renderHook(() => useComposerDraft(null));
    act(() => result.current[1]({ text: 'nowhere', mentions: [] }));
    unmount();
    expect(Object.keys(localStorage).some((k) => k.startsWith('meetifyy_draft:'))).toBe(false);
  });
});
