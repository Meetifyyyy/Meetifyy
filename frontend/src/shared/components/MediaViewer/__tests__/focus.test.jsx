/** @vitest-environment jsdom */
import { useRef } from 'react';
import { createPortal } from 'react-dom';
import { afterEach, describe, expect, it } from 'vitest';
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
});
