/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

vi.mock('@shared/hooks/useOverlayBack', () => ({ useOverlayBack: () => {} }));
vi.mock('@shared/hooks/useScrollLock', () => ({ useScrollLock: () => {} }));
vi.mock('@shared/hooks/useSheetDrag', () => ({ useSheetDrag: () => ({ current: null }) }));

import BlockUserModal from '../BlockUserModal';

afterEach(cleanup);

describe('BlockUserModal', () => {
  it('names the person and says what a block does, before it happens', () => {
    render(<BlockUserModal name="Asha" onConfirm={vi.fn()} onCancel={vi.fn()} />);

    expect(screen.getByText('Block Asha?')).toBeTruthy();
    const text = document.body.textContent;
    expect(text).toMatch(/neither of you will be able to message/i);
    expect(text).toMatch(/stop following each other/i);
    expect(text).toMatch(/read-only history/i);
    expect(text).toMatch(/unblock Asha at any time/i);
    expect(screen.getByRole('button', { name: 'Block' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy();
  });

  it('asks about unblocking differently, and is honest that follows are not restored', () => {
    render(<BlockUserModal name="Asha" isBlocked onConfirm={vi.fn()} onCancel={vi.fn()} />);

    expect(screen.getByText('Unblock Asha?')).toBeTruthy();
    expect(document.body.textContent).toMatch(/message each other again/i);
    expect(document.body.textContent).toMatch(/aren.t restored/i);
    expect(screen.getByRole('button', { name: 'Unblock' })).toBeTruthy();
  });

  it('falls back to "this person" when it has no name', () => {
    render(<BlockUserModal name="  " onConfirm={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByText('Block this person?')).toBeTruthy();
  });

  it('only acts when confirmed; cancelling does nothing', () => {
    vi.useFakeTimers();
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(<BlockUserModal name="Asha" onConfirm={onConfirm} onCancel={onCancel} />);

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    vi.runAllTimers();
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Block' }));
    vi.runAllTimers();
    expect(onConfirm).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});
