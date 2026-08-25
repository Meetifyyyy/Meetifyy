import { describe, it, expect } from 'vitest';
import { isSystemMessage } from '../cacheUtils';

/**
 * A system message carries a sender on the wire (the user whose action produced
 * it) but is not authored by them, so nothing may attribute it. Getting this
 * wrong produced "Gyu: @gyu changed group name to ..." in the instant toast —
 * the same person named twice, once mid-sentence.
 */
describe('isSystemMessage', () => {
  it('recognises the server casing', () => {
    expect(isSystemMessage({ type: 'SYSTEM' })).toBe(true);
  });

  it('recognises the lowercase variant older payloads use', () => {
    expect(isSystemMessage({ type: 'system' })).toBe(true);
  });

  it('recognises the isSystem flag', () => {
    expect(isSystemMessage({ isSystem: true })).toBe(true);
  });

  it('does not treat an ordinary chat message as one', () => {
    expect(isSystemMessage({ type: 'CHAT', text: 'hi' })).toBe(false);
    expect(isSystemMessage({ type: 'MEDIA' })).toBe(false);
  });

  it('is safe on missing input', () => {
    expect(isSystemMessage(null)).toBe(false);
    expect(isSystemMessage(undefined)).toBe(false);
    expect(isSystemMessage({})).toBe(false);
  });
});
