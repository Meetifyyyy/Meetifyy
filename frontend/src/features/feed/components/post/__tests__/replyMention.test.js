import { describe, it, expect, vi } from 'vitest';

vi.mock('@shared/api/apiClient', () => ({ postsApi: {} }));

const { withLeadingMention } = await import('../PostView');

describe('withLeadingMention (Reply puts @username in the box)', () => {
  const who = { userId: 'u1', username: 'cat' };

  it('starts an empty box with the mention and a space', () => {
    expect(withLeadingMention({ text: '', mentions: [] }, who)).toEqual({
      text: '@cat ',
      mentions: [{ userId: 'u1', username: 'cat', start: 0, end: 4 }],
    });
  });

  it('keeps what was typed after it, moving its mentions along', () => {
    const out = withLeadingMention(
      { text: 'hi @dog', mentions: [{ userId: 'u2', username: 'dog', start: 3, end: 7 }] },
      who,
    );
    expect(out.text).toBe('@cat hi @dog');
    expect(out.mentions[1]).toEqual({ userId: 'u2', username: 'dog', start: 8, end: 12 });
    expect(out.text.slice(out.mentions[1].start, out.mentions[1].end)).toBe('@dog');
  });

  it('does nothing when that person is already mentioned', () => {
    const value = { text: '@cat yes', mentions: [{ userId: 'u1', username: 'cat', start: 0, end: 4 }] };
    expect(withLeadingMention(value, who)).toBe(value);
  });
});
