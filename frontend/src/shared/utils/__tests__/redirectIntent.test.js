import { describe, it, expect, beforeEach } from 'vitest';
import { setRedirectIntent, consumeRedirectIntent, clearRedirectIntent } from '../redirectIntent';

// The suite runs in the node environment, which has no sessionStorage.
function installStorageStub() {
  const store = new Map();
  globalThis.sessionStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
  };
}

describe('redirectIntent', () => {
  beforeEach(() => {
    installStorageStub();
    clearRedirectIntent();
  });

  it('round-trips a deep link and clears it after one use', () => {
    setRedirectIntent('/crew/42?tab=saved');
    expect(consumeRedirectIntent()).toBe('/crew/42?tab=saved');
    expect(consumeRedirectIntent()).toBe(null);
  });

  it('refuses off-site destinations so the redirect cannot be hijacked', () => {
    setRedirectIntent('//evil.example.com/phish');
    expect(consumeRedirectIntent()).toBe(null);

    setRedirectIntent('https://evil.example.com');
    expect(consumeRedirectIntent()).toBe(null);
  });

  it('refuses auth screens, which would bounce the user straight back out', () => {
    ['/', '/login', '/signup', '/onboarding'].forEach((path) => {
      setRedirectIntent(path);
      expect(consumeRedirectIntent()).toBe(null);
    });
  });
});
