import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  isNetworkLevelFailure,
  describeNetworkError,
} from '../networkErrors';

/**
 * "Failed to fetch" is the browser saying the request never reached the server.
 * The whole point of these helpers is to keep that distinct from an error the
 * server sent back, because the two send you looking in completely different
 * places.
 */

const netErr = (message, name = 'TypeError') => Object.assign(new Error(message), { name });

afterEach(() => { vi.unstubAllGlobals(); });

describe('recognising a request that never landed', () => {
  it('spots the wording each engine uses', () => {
    expect(isNetworkLevelFailure(netErr('Failed to fetch'))).toBe(true);              // Chrome
    expect(isNetworkLevelFailure(netErr('NetworkError when attempting to fetch resource.'))).toBe(true); // Firefox
    expect(isNetworkLevelFailure(netErr('Load failed'))).toBe(true);                  // Safari
  });

  it('counts an abort or a timeout as never having landed', () => {
    expect(isNetworkLevelFailure(netErr('aborted', 'AbortError'))).toBe(true);
    expect(isNetworkLevelFailure(netErr('too slow', 'TimeoutError'))).toBe(true);
  });

  it('does NOT claim a server error is a network failure', () => {
    // These reached the server. Treating them as connectivity would send the
    // user to check their wifi over a validation problem.
    expect(isNetworkLevelFailure(Object.assign(new Error('Invalid login credentials'), { status: 400 }))).toBe(false);
    expect(isNetworkLevelFailure(Object.assign(new Error('rate limit exceeded'), { status: 429 }))).toBe(false);
    expect(isNetworkLevelFailure(new Error('User already registered'))).toBe(false);
    expect(isNetworkLevelFailure(null)).toBe(false);
    expect(isNetworkLevelFailure(undefined)).toBe(false);
  });
});

describe('what the user is told', () => {
  it('says offline when the browser knows it is offline', () => {
    vi.stubGlobal('navigator', { onLine: false });
    const msg = describeNetworkError(netErr('Failed to fetch'), { host: 'x.supabase.co' });
    expect(msg).toContain('offline');
    expect(msg).toContain('nothing was submitted');
  });

  it('names the host it could not reach, so the failure is traceable', () => {
    vi.stubGlobal('navigator', { onLine: true });
    const msg = describeNetworkError(netErr('Failed to fetch'), {
      host: 'gjfiwqpjtzhnqwriwdvi.supabase.co',
      action: 'create your account',
    });
    expect(msg).toContain('gjfiwqpjtzhnqwriwdvi.supabase.co');
    expect(msg).toContain('create your account');
    // The actionable part: on a campus network this is usually a filter.
    expect(msg).toMatch(/network|VPN|ad blocker/i);
    // And it must never leave the raw string in front of the user.
    expect(msg).not.toContain('Failed to fetch');
  });

  it('is explicit that nothing was created, so nobody signs up twice', () => {
    vi.stubGlobal('navigator', { onLine: true });
    expect(describeNetworkError(netErr('Failed to fetch'), { host: 'h' }))
      .toContain('Nothing was submitted');
  });

  it('says the wait was abandoned when it timed out', () => {
    vi.stubGlobal('navigator', { onLine: true });
    const msg = describeNetworkError(netErr('Timed out after 25s', 'TimeoutError'), { host: 'h' });
    expect(msg).toMatch(/too long/i);
    expect(msg).toContain('not created');
  });

  it('returns null for a real server error, leaving its message alone', () => {
    const serverErr = Object.assign(new Error('User already registered'), { status: 422 });
    expect(describeNetworkError(serverErr, { host: 'h' })).toBeNull();
  });

  it('reads as a whole sentence, with no template artefacts', () => {
    vi.stubGlobal('navigator', { onLine: true });
    const msg = describeNetworkError(netErr('Failed to fetch'), { host: 'h', action: 'create your account' });
    expect(msg).not.toMatch(/\$\{|\+ '|undefined|\bnull\b/);
    expect(msg.trim()).toBe(msg);
  });
});
