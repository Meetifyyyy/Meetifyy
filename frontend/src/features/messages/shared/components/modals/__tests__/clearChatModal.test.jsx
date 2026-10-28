/** @vitest-environment jsdom */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';

vi.mock('@shared/hooks/useOverlayBack', () => ({ useOverlayBack: () => {} }));
vi.mock('@shared/hooks/useScrollLock', () => ({ useScrollLock: () => {} }));

const { default: ClearChatModal } = await import('../ClearChatModal');

/**
 * Clear chat asks first, says what goes and for whom, and changes the chat
 * only on the server's success. It used to clear the moment the menu item was
 * tapped.
 */
afterEach(cleanup);

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

const dm = { id: 'c1', type: 'DM', targetUser: { displayName: 'Ana' } };
const group = { id: 'g1', type: 'GROUP', isGroup: true, name: 'Crew' };

describe('ClearChatModal', () => {
  it('says the clear is for this person only, naming who keeps the messages', () => {
    render(<ClearChatModal conversation={dm} onConfirm={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByRole('alertdialog')).toBeTruthy();
    expect(screen.getByText(/removed for you only/)).toBeTruthy();
    expect(screen.getByText(/Ana will still see them/)).toBeTruthy();
    cleanup();
    render(<ClearChatModal conversation={group} onConfirm={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByText(/Other members will still see them/)).toBeTruthy();
  });

  it('sends one request however many times the button is pressed, and closes on success', async () => {
    const request = deferred();
    const onConfirm = vi.fn(() => request.promise);
    const onClose = vi.fn();
    render(<ClearChatModal conversation={dm} onConfirm={onConfirm} onClose={onClose} />);
    const clear = screen.getByRole('button', { name: 'Clear chat' });
    fireEvent.click(clear);
    fireEvent.click(clear);
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: /Clearing/ }).disabled).toBe(true);
    expect(screen.getByRole('button', { name: 'Cancel' }).disabled).toBe(true);
    expect(onClose).not.toHaveBeenCalled();
    await act(async () => {
      request.resolve(true);
      await request.promise;
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('cannot be dismissed while the request is out', () => {
    const onClose = vi.fn();
    render(<ClearChatModal conversation={dm} onConfirm={() => new Promise(() => {})} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: 'Clear chat' }));
    fireEvent.keyDown(screen.getByRole('alertdialog'), { key: 'Escape' });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('stays open on failure, says why, and retries with the same button', async () => {
    const onConfirm = vi
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error('x'), { status: 500 }))
      .mockResolvedValueOnce(true);
    const onClose = vi.fn();
    render(<ClearChatModal conversation={dm} onConfirm={onConfirm} onClose={onClose} />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Clear chat' }));
    });
    expect(screen.getByRole('alert').textContent).toMatch(/Couldn't clear the chat/);
    expect(onClose).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Clear chat' }));
    });
    expect(onConfirm).toHaveBeenCalledTimes(2);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('Cancel closes without clearing', () => {
    const onConfirm = vi.fn();
    const onClose = vi.fn();
    render(<ClearChatModal conversation={dm} onConfirm={onConfirm} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
