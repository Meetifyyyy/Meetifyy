/** @vitest-environment jsdom */
import { describe, it, expect, vi } from 'vitest';
import { createWebNetwork } from '../network';

let onLine = true;
vi.spyOn(window.navigator, 'onLine', 'get').mockImplementation(() => onLine);

describe('web NetworkStatus', () => {
  it('reads navigator.onLine and follows online/offline events until unsubscribed', async () => {
    const net = createWebNetwork();
    onLine = false;
    expect(await net.isOnline()).toBe(false);
    const fn = vi.fn();
    const off = net.onChange(fn);
    window.dispatchEvent(new Event('online'));
    window.dispatchEvent(new Event('offline'));
    expect(fn.mock.calls).toEqual([[true], [false]]);
    off();
    window.dispatchEvent(new Event('online'));
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
