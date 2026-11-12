import {
  boundedTextKeyPart,
  hashCacheKeyPart,
  normalizeCacheText,
} from './cache-key';

describe('cache key parts', () => {
  it('normalises case and surrounding space only', () => {
    expect(normalizeCacheText('  Priya ')).toBe('priya');
    expect(normalizeCacheText(undefined)).toBe('');
    expect(normalizeCacheText('a  b')).toBe('a  b');
  });

  it('gives different spellings of one term the same key part', () => {
    expect(boundedTextKeyPart('  Priya', 100)).toBe(
      boundedTextKeyPart('priya  ', 100),
    );
  });

  it('keeps different terms apart, including inner spacing', () => {
    expect(boundedTextKeyPart('a b', 100)).not.toBe(
      boundedTextKeyPart('a  b', 100),
    );
  });

  it('has a fixed length whatever the input', () => {
    expect(hashCacheKeyPart('x')).toHaveLength(16);
    expect(boundedTextKeyPart('y'.repeat(100), 100)).toHaveLength(16);
  });

  it('refuses text longer than the cap instead of truncating it', () => {
    expect(boundedTextKeyPart('z'.repeat(10 * 1024), 100)).toBeNull();
    expect(boundedTextKeyPart('z'.repeat(101), 100)).toBeNull();
  });

  it('cannot be made to forge a neighbouring field with a delimiter', () => {
    expect(boundedTextKeyPart('a:posts', 100)).toMatch(/^[0-9a-f]{16}$/);
  });
});
