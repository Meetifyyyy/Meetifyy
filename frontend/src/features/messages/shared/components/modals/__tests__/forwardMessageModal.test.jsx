/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, act } from '@testing-library/react';
import { useState } from 'react';

vi.mock('@shared/hooks/useOverlayBack', () => ({ useOverlayBack: () => {} }));
vi.mock('@shared/hooks/useScrollLock', () => ({ useScrollLock: () => {} }));
vi.mock('@shared/components/avatar/Avatar', () => ({ default: () => <span /> }));

const { default: ForwardMessageModal } = await import('../ForwardMessageModal');
const { ForwardPartialError } = await import('../../../utils/forwardDelivery');

const CHATS = [
  { id: 'a', name: 'Alice' },
  { id: 'b', name: 'Bob' },
  { id: 'c', name: 'Cara' },
];

afterEach(() => cleanup());

function renderModal(props = {}) {
  const onClose = vi.fn();
  const onConfirmForward = vi.fn().mockResolvedValue(undefined);
  const utils = render(
    <ForwardMessageModal
      isOpen
      msg={{ text: 'hi' }}
      conversations={CHATS}
      onClose={onClose}
      onConfirmForward={onConfirmForward}
      {...props}
    />,
  );
  return { ...utils, onClose, onConfirmForward };
}

describe('Forward sheet semantics', () => {
  it('is a labelled modal dialog portalled to the body, with named controls', () => {
    renderModal();
    const dialog = screen.getByRole('dialog', { name: 'Forward message' });
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.parentElement.parentElement).toBe(document.body);
    expect(screen.getByRole('button', { name: 'Close' })).toBeTruthy();
    expect(screen.getByRole('textbox', { name: 'Search conversations' })).toBeTruthy();
  });

  it('says it is forwarding media when it is', () => {
    renderModal({ msg: { mediaUrl: 'chat/x.png' } });
    expect(screen.getByRole('dialog', { name: 'Forward media' })).toBeTruthy();
  });

  it('lists recipients as real checkboxes that a keyboard can toggle', () => {
    renderModal();
    const alice = screen.getByRole('checkbox', { name: 'Alice' });
    expect(alice.checked).toBe(false);
    fireEvent.click(alice);
    expect(screen.getByRole('checkbox', { name: 'Alice' }).checked).toBe(true);
    expect(screen.getByRole('button', { name: 'Forward to 1 chat' })).toBeTruthy();
  });

  it('moves focus into the dialog and restores it on close', () => {
    const opener = document.createElement('button');
    document.body.append(opener); opener.focus();
    const { unmount } = renderModal();
    expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true);
    unmount();
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });

  it('Escape closes only the sheet and does not reach layers underneath', () => {
    const { onClose } = renderModal();
    const underneath = vi.fn();
    window.addEventListener('keydown', underneath);
    const search = screen.getByRole('textbox', { name: 'Search conversations' });
    search.focus();
    fireEvent.keyDown(search, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(underneath).not.toHaveBeenCalled();
    window.removeEventListener('keydown', underneath);
  });

  it('keeps Tab inside the sheet', () => {
    renderModal();
    const dialog = screen.getByRole('dialog');
    const button = screen.getByRole('button', { name: /^Forward to/ });
    // Forward is disabled with nothing selected, so Tab from the last checkbox wraps to Close.
    const last = screen.getByRole('checkbox', { name: 'Cara' });
    last.focus();
    fireEvent.keyDown(last, { key: 'Tab' });
    expect(dialog.contains(document.activeElement)).toBe(true);
    expect(button.disabled).toBe(true);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close' }));
  });
});

describe('Forward sheet delivery', () => {
  it('hands the confirm callback the selection and one operation id, then closes on success', async () => {
    const { onConfirmForward, onClose } = renderModal();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Alice' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Bob' }));
    fireEvent.click(screen.getByRole('button', { name: 'Forward to 2 chats' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(onConfirmForward).toHaveBeenCalledWith(['a', 'b'], { operationId: expect.any(String) });
  });

  it('after a partial failure keeps only the failed recipients selected and retries under the same operation id', async () => {
    const calls = [];
    const onConfirmForward = vi.fn(async (ids, ctx) => {
      calls.push([ids, ctx.operationId]);
      if (calls.length === 1) throw new ForwardPartialError(['b'], 2);
    });
    const { onClose } = renderModal({ onConfirmForward });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Alice' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Bob' }));
    fireEvent.click(screen.getByRole('button', { name: 'Forward to 2 chats' }));

    await waitFor(() => expect(screen.getByRole('button', { name: 'Forward to 1 chat' })).toBeTruthy());
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('checkbox', { name: 'Alice' }).checked).toBe(false);
    expect(screen.getByRole('checkbox', { name: 'Bob' }).checked).toBe(true);
    expect(screen.getByRole('status').textContent).toMatch(/Sent to 1\. 1 failed/);

    fireEvent.click(screen.getByRole('button', { name: 'Forward to 1 chat' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(calls[1][0]).toEqual(['b']);
    expect(calls[1][1]).toBe(calls[0][1]);
  });

  it('keeps the whole selection for an error that says nothing about who failed', async () => {
    const onConfirmForward = vi.fn().mockRejectedValue(new Error('offline'));
    const { onClose } = renderModal({ onConfirmForward });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Alice' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Bob' }));
    fireEvent.click(screen.getByRole('button', { name: 'Forward to 2 chats' }));
    await waitFor(() => expect(onConfirmForward).toHaveBeenCalled());
    await act(async () => {});
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Forward to 2 chats' })).toBeTruthy();
  });

  it('a new operation id is used once the previous forward fully succeeded', async () => {
    const ids = [];
    function Harness() {
      const [open, setOpen] = useState(true);
      return (
        <>
          <button onClick={() => setOpen(true)}>reopen</button>
          <ForwardMessageModal
            isOpen={open}
            conversations={CHATS}
            onClose={() => setOpen(false)}
            onConfirmForward={async (_ids, ctx) => { ids.push(ctx.operationId); }}
          />
        </>
      );
    }
    render(<Harness />);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Alice' }));
    fireEvent.click(screen.getByRole('button', { name: 'Forward to 1 chat' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    fireEvent.click(screen.getByText('reopen'));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Alice' }));
    fireEvent.click(screen.getByRole('button', { name: 'Forward to 1 chat' }));
    await waitFor(() => expect(ids.length).toBe(2));
    expect(ids[0]).not.toBe(ids[1]);
  });
});

describe('Forward sheet search', () => {
  it('reports what is typed, so the owner can search past the first page', () => {
    const onSearchChange = vi.fn();
    renderModal({ onSearchChange });

    fireEvent.change(screen.getByRole('textbox', { name: 'Search conversations' }), { target: { value: 'zed' } });
    expect(onSearchChange).toHaveBeenLastCalledWith('zed');
  });

  it('clears the owner\'s search when the sheet closes', () => {
    const onSearchChange = vi.fn();
    const { rerender } = renderModal({ onSearchChange });
    fireEvent.change(screen.getByRole('textbox', { name: 'Search conversations' }), { target: { value: 'zed' } });

    rerender(
      <ForwardMessageModal
        isOpen={false}
        msg={{ text: 'hi' }}
        conversations={CHATS}
        onClose={vi.fn()}
        onConfirmForward={vi.fn()}
        onSearchChange={onSearchChange}
      />,
    );
    expect(onSearchChange).toHaveBeenLastCalledWith('');
  });

  it('still works for an owner that does not search the server', () => {
    renderModal();
    fireEvent.change(screen.getByRole('textbox', { name: 'Search conversations' }), { target: { value: 'ali' } });
    expect(screen.getByRole('checkbox', { name: 'Alice' })).toBeTruthy();
    expect(screen.queryByRole('checkbox', { name: 'Bob' })).toBeNull();
  });
});
