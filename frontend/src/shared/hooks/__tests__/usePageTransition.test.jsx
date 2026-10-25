/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const navigate = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => ({
  ...(await importOriginal()),
  useNavigate: () => navigate,
}));

const { usePageTransition } = await import('../usePageTransition');
const { PAGE_TRANSITION_STATE_KEY, setPageTransitionDriver } = await import('@shared/lib/navigation/pageTransition');

const wrapper = ({ children }) => <MemoryRouter>{children}</MemoryRouter>;

/** A driver that runs the navigation straight away, recording the effect it was given. */
const driver = { open: vi.fn((go) => go()), close: vi.fn() };

afterEach(() => {
  setPageTransitionDriver(null);
  navigate.mockReset();
  driver.open.mockClear();
});

describe('usePageTransition().open', () => {
  it('opens with the slide unless the page asks for another effect', () => {
    setPageTransitionDriver(driver);
    const { result } = renderHook(() => usePageTransition(), { wrapper });
    result.current.open('/notifications');
    expect(driver.open).toHaveBeenCalledWith(expect.any(Function), { effect: 'slide' });
    expect(navigate).toHaveBeenCalledWith('/notifications', {
      state: { [PAGE_TRANSITION_STATE_KEY]: 'slide' },
    });
  });

  it('opens with the centre opening, and marks the entry so Back closes the same way', () => {
    setPageTransitionDriver(driver);
    const onNavigate = vi.fn();
    const { result } = renderHook(() => usePageTransition(), { wrapper });
    result.current.open('/post/p1', { state: { post: { id: 'p1' } } }, { effect: 'centre', onNavigate });
    expect(driver.open).toHaveBeenCalledWith(expect.any(Function), { effect: 'centre' });
    expect(navigate).toHaveBeenCalledWith('/post/p1', {
      state: { post: { id: 'p1' }, [PAGE_TRANSITION_STATE_KEY]: 'centre' },
    });
    expect(onNavigate).toHaveBeenCalledTimes(1);
  });

  it('opens everything with the effect the hook was given, unless a call asks for another', () => {
    setPageTransitionDriver(driver);
    const { result } = renderHook(() => usePageTransition({ effect: 'centre' }), { wrapper });
    result.current.open('/profile/asha');
    expect(driver.open).toHaveBeenLastCalledWith(expect.any(Function), { effect: 'centre' });
    expect(navigate).toHaveBeenLastCalledWith('/profile/asha', {
      state: { [PAGE_TRANSITION_STATE_KEY]: 'centre' },
    });
    result.current.open('/settings', undefined, { effect: 'slide' });
    expect(driver.open).toHaveBeenLastCalledWith(expect.any(Function), { effect: 'slide' });
    expect(navigate).toHaveBeenLastCalledWith('/settings', {
      state: { [PAGE_TRANSITION_STATE_KEY]: 'slide' },
    });
  });

  it('is a plain navigate on the website, whatever effect is asked for', () => {
    const { result } = renderHook(() => usePageTransition(), { wrapper });
    result.current.open('/post/p1', { state: { post: { id: 'p1' } } }, { effect: 'centre' });
    expect(navigate).toHaveBeenCalledWith('/post/p1', { state: { post: { id: 'p1' } } });
  });

  it('lets a link open with the effect, and leaves it alone on the website', () => {
    const event = { preventDefault: vi.fn() };
    const { result } = renderHook(() => usePageTransition(), { wrapper });
    result.current.openFromLink(event, '/post/p1', undefined, { effect: 'centre' });
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();

    setPageTransitionDriver(driver);
    result.current.openFromLink(event, '/post/p1', undefined, { effect: 'centre' });
    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(driver.open).toHaveBeenCalledWith(expect.any(Function), { effect: 'centre' });
  });
});
