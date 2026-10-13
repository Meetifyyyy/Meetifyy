import { extractHashtags, hashtagQuery } from './hashtags.util';

describe('extractHashtags', () => {
  it('finds tags, lower-cased and de-duplicated, in order', () => {
    expect(extractHashtags('Jam tonight #Music #art and more #music')).toEqual([
      'music',
      'art',
    ]);
  });

  it('accepts letters from any script and underscores', () => {
    expect(extractHashtags('#होली #fest_2026')).toEqual(['होली', 'fest_2026']);
  });

  it('ignores numbers, single characters and tags glued to words', () => {
    expect(extractHashtags('room #1 #2026 #a C#sharp a/#b &#39; x#y')).toEqual(
      [],
    );
  });

  it('works at the start of the text and after punctuation', () => {
    expect(extractHashtags('#first, (#second) "#third"')).toEqual([
      'first',
      'second',
      'third',
    ]);
  });

  it('caps the number of tags per post', () => {
    const text = Array.from({ length: 15 }, (_, i) => `#tag${i}x`).join(' ');
    expect(extractHashtags(text)).toHaveLength(10);
  });

  it('handles empty input', () => {
    expect(extractHashtags('')).toEqual([]);
    expect(extractHashtags(null)).toEqual([]);
  });
});

describe('hashtagQuery', () => {
  it('recognises a single-hashtag search', () => {
    expect(hashtagQuery('#Music')).toBe('music');
    expect(hashtagQuery('  #music ')).toBe('music');
  });

  it('is null for ordinary searches', () => {
    expect(hashtagQuery('music')).toBeNull();
    expect(hashtagQuery('#music #art')).toBeNull();
    expect(hashtagQuery('#1')).toBeNull();
  });
});
