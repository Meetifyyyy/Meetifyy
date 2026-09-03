/** @vitest-environment jsdom */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, act, within, fireEvent } from '@testing-library/react';
import { useState } from 'react';
import PasswordField from '@features/auth/shared/ui/PasswordField';

/**
 * The ways a password actually arrives in these fields: typed, pasted, filled
 * by the browser, or written straight into the DOM by a password-manager
 * extension. The last two do not produce a React change event, which is what
 * used to leave the field visibly full while React state held ''.
 */

afterEach(() => cleanup());

/** A controlled field, exactly as the signup and reset screens use it. */
function Harness({ onValue }) {
  const [value, setValue] = useState('');
  onValue.current = () => value;
  return (
    <PasswordField
      id="pw"
      label="Password"
      value={value}
      onChange={(e) => setValue(e.target.value)}
    />
  );
}

const setup = () => {
  const onValue = { current: () => '' };
  const utils = render(<Harness onValue={onValue} />);
  const input = utils.container.querySelector('input');
  return { ...utils, input, read: () => onValue.current() };
};

/** Write the value the way an extension does: straight past React's tracker. */
function writeLikeExtension(input, value) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(input, value);
}

describe('password entry reaches React state', () => {
  it('typing works', () => {
    const { input, read } = setup();
    fireEvent.change(input, { target: { value: 'typed-password' } });
    expect(read()).toBe('typed-password');
  });

  it('pasting works, including special characters', () => {
    const { input, read } = setup();
    const pasted = String.raw`aB3!£$%^&*()_+{}|:"<>?~-=[];',./`;
    fireEvent.change(input, { target: { value: pasted } });
    expect(read()).toBe(pasted);
  });

  it('a long generated password is not truncated', () => {
    const { input, read } = setup();
    const generated = 'Xk9#mQ2$vL8@pR4!'.repeat(6); // 96 chars
    fireEvent.change(input, { target: { value: generated } });
    expect(read()).toBe(generated);
    expect(read()).toHaveLength(96);
  });

  it('leading and trailing spaces are preserved, not trimmed', () => {
    const { input, read } = setup();
    fireEvent.change(input, { target: { value: '  spaced password  ' } });
    expect(read()).toBe('  spaced password  ');
  });

  it('picks up a value a password manager wrote straight to the DOM', async () => {
    const { input, read } = setup();
    expect(read()).toBe('');

    writeLikeExtension(input, 'manager-generated-x9');
    // No React-tracked event was dispatched, which is the whole problem.
    expect(read()).toBe('');

    // The reconcile poll notices the divergence and syncs it.
    await act(async () => { await new Promise((r) => setTimeout(r, 400)); });
    expect(read()).toBe('manager-generated-x9');
  });

  it('picks up a browser autofill announced by animationstart', async () => {
    const { input, read } = setup();
    writeLikeExtension(input, 'chrome-autofilled');
    await act(async () => {
      // jsdom has no constructible AnimationEvent, so this is a plain Event
      // carrying the one property the listener reads.
      const evt = new Event('animationstart', { bubbles: true });
      Object.defineProperty(evt, 'animationName', { value: 'onAutoFillStart' });
      input.dispatchEvent(evt);
    });
    expect(read()).toBe('chrome-autofilled');
  });

  it('syncs on blur, for a fill that announced nothing at all', async () => {
    const { input, read } = setup();
    writeLikeExtension(input, 'silently-filled');
    await act(async () => { fireEvent.blur(input); });
    expect(read()).toBe('silently-filled');
  });

  it('does not fight the user while they type', () => {
    const { input, read } = setup();
    fireEvent.change(input, { target: { value: 'a' } });
    fireEvent.change(input, { target: { value: 'ab' } });
    fireEvent.change(input, { target: { value: 'abc' } });
    expect(read()).toBe('abc');
  });
});

describe('the visibility toggle does not disturb the value', () => {
  it('keeps the password across show and hide', async () => {
    const { input, read, container } = setup();
    const secret = ' Pa$$w0rd with spaces ';
    fireEvent.change(input, { target: { value: secret } });

    const toggle = container.querySelector('button[aria-label*="password" i]');
    await act(async () => { toggle.click(); });
    expect(container.querySelector('input').type).toBe('text');
    expect(read()).toBe(secret);

    await act(async () => { toggle.click(); });
    expect(container.querySelector('input').type).toBe('password');
    expect(read()).toBe(secret);
  });

  it('survives rapid toggling', async () => {
    const { input, read, container } = setup();
    fireEvent.change(input, { target: { value: 'stable-value' } });
    const toggle = container.querySelector('button[aria-label*="password" i]');
    for (let i = 0; i < 10; i++) {
      // eslint-disable-next-line no-await-in-loop
      await act(async () => { toggle.click(); });
    }
    expect(read()).toBe('stable-value');
  });
});
