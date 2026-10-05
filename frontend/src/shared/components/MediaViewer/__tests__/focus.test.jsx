/** @vitest-environment jsdom */
import { useRef } from 'react';
import { createPortal } from 'react-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useViewerFocus } from '../useViewerFocus';
function Viewer() {
  const ref = useRef(null);
  useViewerFocus(true, ref);
  return createPortal(<div ref={ref} role="dialog" aria-modal="true" tabIndex={-1}>
    <button>First</button><button>Last</button><div inert=""><button>Hidden</button></div>
  </div>, document.body);
}
afterEach(() => cleanup());
describe('viewer modal focus', () => {
  it('makes background inert, wraps Tab, and restores the opener', () => {
    const background = document.createElement('div');
    const opener = document.createElement('button');
    background.append(opener); document.body.append(background); opener.focus();
    const result = render(<Viewer />);
    expect(background.hasAttribute('inert')).toBe(true);
    const first = screen.getByRole('button', { name: 'First' });
    const last = screen.getByRole('button', { name: 'Last' });
    last.focus(); fireEvent.keyDown(last, { key: 'Tab' }); expect(document.activeElement).toBe(first);
    first.focus(); fireEvent.keyDown(first, { key: 'Tab', shiftKey: true }); expect(document.activeElement).toBe(last);
    result.unmount();
    expect(background.hasAttribute('inert')).toBe(false);
    expect(document.activeElement).toBe(opener); background.remove();
  });
  it('allows portalled menus and contains focus within a nested dialog', () => {
    render(<Viewer />);
    const menu = document.createElement('div'); menu.setAttribute('role', 'menu');
    const item = document.createElement('button'); menu.append(item); document.body.append(menu);
    item.focus(); expect(document.activeElement).toBe(item);
    menu.remove();
    const dialog = document.createElement('div'); dialog.setAttribute('role', 'dialog'); dialog.setAttribute('aria-modal', 'true');
    const button = document.createElement('button'); dialog.append(button); document.body.append(dialog);
    button.focus(); fireEvent.keyDown(button, { key: 'Tab' }); expect(document.activeElement).toBe(button);
    screen.getByRole('button', { name: 'First' }).focus(); expect(document.activeElement).toBe(button);
    dialog.remove();
  });

  it('treats a dialog the viewer was opened over as background, not as its own', () => {
    const behind = document.createElement('div');
    behind.setAttribute('role', 'dialog'); behind.setAttribute('aria-modal', 'true');
    const behindButton = document.createElement('button'); behind.append(behindButton); document.body.append(behind);
    behindButton.focus();
    const result = render(<Viewer />);
    const first = screen.getByRole('button', { name: 'First' });
    // It is made inert and focus is not pulled into it.
    expect(behind.hasAttribute('inert')).toBe(true);
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(first);
    behindButton.focus();
    expect(document.activeElement).not.toBe(behindButton);
    result.unmount();
    // Restored exactly as it was.
    expect(behind.hasAttribute('inert')).toBe(false);
    behind.remove();
  });

  it('does not exempt the app root just because some inline dialog lives inside it', () => {
    const root = document.createElement('div');
    const inline = document.createElement('div');
    inline.setAttribute('role', 'dialog'); inline.setAttribute('aria-modal', 'true');
    root.append(inline); document.body.append(root);
    const result = render(<Viewer />);
    expect(root.hasAttribute('inert')).toBe(true);
    result.unmount();
    expect(root.hasAttribute('inert')).toBe(false);
    root.remove();
  });

  it('keeps a layer opened after the viewer interactive and focus-contained', () => {
    render(<Viewer />);
    const sheet = document.createElement('div'); sheet.id = 'sheet';
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog'); dialog.setAttribute('aria-modal', 'true');
    const b1 = document.createElement('button'); const b2 = document.createElement('button');
    dialog.append(b1, b2); sheet.append(dialog); document.body.append(sheet);
    // Let the mutation observer run.
    return Promise.resolve().then(() => {
      expect(sheet.hasAttribute('inert')).toBe(false);
      b2.focus(); fireEvent.keyDown(b2, { key: 'Tab' });
      expect(document.activeElement).toBe(b1);
      sheet.remove();
    });
  });
  it('does not make a toast inert - it is a status message, not content behind the viewer', () => {
    const toast = document.createElement('div');
    toast.className = 'custom-toast custom-toast-error';
    toast.setAttribute('role', 'alert');
    document.body.append(toast);
    const result = render(<Viewer />);
    expect(toast.hasAttribute('inert')).toBe(false);
    result.unmount(); toast.remove();
  });
  it('hands focus back without scrolling the page', () => {
    const opener = document.createElement('button');
    document.body.append(opener); opener.focus();
    const focus = vi.spyOn(opener, 'focus');
    const result = render(<Viewer />);
    result.unmount();
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
    opener.remove();
  });
});
