import { constantTimeEquals } from './constant-time.util';

describe('constantTimeEquals', () => {
  it('matches identical strings', () => {
    expect(constantTimeEquals('abc123', 'abc123')).toBe(true);
  });

  it('rejects different strings of the same length', () => {
    expect(constantTimeEquals('abc123', 'abc124')).toBe(false);
  });

  it('rejects different lengths', () => {
    expect(constantTimeEquals('abc', 'abcd')).toBe(false);
  });

  it('does not throw when UTF-16 lengths match but byte lengths differ', () => {
    // Both are 3 code units long; they encode to 3 and 9 bytes.
    expect(constantTimeEquals('abc', '€€€')).toBe(false);
  });
});
