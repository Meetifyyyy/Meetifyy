import { afterEach, describe, expect, it, vi } from 'vitest';
import { requestToggle, isTogglePending, __resetSerialToggles } from '../serialToggle';

const flush = () => new Promise((r) => setTimeout(r, 0));

function server() {
  const requests = [];
  const send = vi.fn((target) => new Promise((resolve, reject) => requests.push({ target, resolve, reject })));
  return { requests, send };
}

afterEach(() => __resetSerialToggles());

describe('serialToggle', () => {
  it('sends the first tap at once and never two requests at a time', async () => {
    const { requests, send } = server();
    const io = { send, onConfirmed: vi.fn() };
    requestToggle('k', true, io);
    await flush();
    expect(requests.map((r) => r.target)).toEqual([true]);
    requestToggle('k', false, io);
    requestToggle('k', true, io);
    requestToggle('k', false, io);
    await flush();
    expect(requests).toHaveLength(1);

    requests[0].resolve({});
    await flush();
    // Latest intent (false) differs from the server (true): one follow-up, in order.
    expect(requests.map((r) => r.target)).toEqual([true, false]);
    expect(io.onConfirmed).toHaveBeenLastCalledWith(true, {}, false);
    requests[1].resolve({ ok: 1 });
    await flush();
    expect(io.onConfirmed).toHaveBeenLastCalledWith(false, { ok: 1 }, true);
    expect(isTogglePending('k')).toBe(false);
  });

  it('sends nothing more when the burst ends where the server already is', async () => {
    const { requests, send } = server();
    const io = { send, onConfirmed: vi.fn() };
    requestToggle('k', true, io);
    requestToggle('k', false, io);
    requestToggle('k', true, io);
    await flush();
    requests[0].resolve({});
    await flush();
    expect(requests).toHaveLength(1);
    expect(io.onConfirmed).toHaveBeenCalledWith(true, {}, true);
  });

  it('reports the confirmed state on failure so the caller can restore it', async () => {
    const { requests, send } = server();
    const io = { send, onFailed: vi.fn() };
    requestToggle('k', true, io);
    await flush();
    requests[0].resolve({});
    await flush();
    requestToggle('k', false, io); // unsave, fails
    await flush();
    requests[1].reject(new Error('offline'));
    await flush();
    expect(io.onFailed).toHaveBeenCalledWith(expect.any(Error), { desired: false, confirmed: true });
    expect(isTogglePending('k')).toBe(false);
  });

  it('reports nothing to restore when the failed request was already overtaken', async () => {
    const { requests, send } = server();
    const io = { send, onFailed: vi.fn() };
    requestToggle('k', true, io);   // save, will fail
    requestToggle('k', false, io);  // unsave before it returns: back where the server is
    await flush();
    requests[0].reject(new Error('500'));
    await flush();
    expect(io.onFailed).toHaveBeenCalledWith(expect.any(Error), { desired: false, confirmed: false });
  });

  it('keeps entities independent', async () => {
    const { requests, send } = server();
    requestToggle('a', true, { send });
    requestToggle('b', true, { send });
    await flush();
    expect(requests).toHaveLength(2);
  });
});
