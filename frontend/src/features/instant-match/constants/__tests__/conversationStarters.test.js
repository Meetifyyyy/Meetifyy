import { describe, it, expect } from 'vitest';
import { getConversationStarters } from '../conversationStarters';

/**
 * Openers for a chat between two strangers. They are prompts, not gates —
 * these tests pin the one property that matters for that: the row is always
 * full and always sensible, whatever activity it is asked about.
 */
describe('getConversationStarters', () => {
  it('leads with prompts tailored to the activity', () => {
    const [first] = getConversationStarters('coding');
    expect(first).toMatch(/building/i);
  });

  it('falls back to general prompts for an activity with none of its own', () => {
    const starters = getConversationStarters('other');
    expect(starters).toHaveLength(3);
    expect(starters.every((s) => typeof s === 'string' && s.length > 0)).toBe(true);
  });

  it('tops up with general prompts when an activity has too few', () => {
    // 'chat' has three of its own; asking for more must not come back short —
    // a half-empty prompt row looks broken.
    expect(getConversationStarters('chat', 5)).toHaveLength(5);
  });

  it('never returns duplicates within a set', () => {
    const starters = getConversationStarters('study', 6);
    expect(new Set(starters).size).toBe(starters.length);
  });

  it('handles an unknown or missing activity without throwing', () => {
    expect(getConversationStarters(undefined)).toHaveLength(3);
    expect(getConversationStarters('nonsense')).toHaveLength(3);
  });
});
