import { describe, it, expect } from 'vitest';
import { hashtagSearchPath, splitHashtags } from '../hashtags';

const tags = (text) => splitHashtags(text).filter((p) => p.tag).map((p) => p.tag);

describe('splitHashtags', () => {
  it('finds tags and keeps the original text intact', () => {
    const text = 'Jam tonight #Music, then #art!';
    const parts = splitHashtags(text);
    expect(parts.map((p) => p.text).join('')).toBe(text);
    expect(tags(text)).toEqual(['music', 'art']);
    expect(parts.find((p) => p.tag === 'music').text).toBe('#Music');
  });

  it('matches the backend rule on the awkward cases', () => {
    expect(tags('room #1 #2026 #a C#sharp a/#b &#39; x#y')).toEqual([]);
    expect(tags('#होली #fest_2026')).toEqual(['होली', 'fest_2026']);
    expect(tags('(#second) "#third"')).toEqual(['second', 'third']);
  });

  it('returns plain text untouched when there is no tag', () => {
    expect(splitHashtags('no tags here')).toEqual([{ text: 'no tags here' }]);
    expect(splitHashtags('')).toEqual([{ text: '' }]);
  });
});

describe('hashtagSearchPath', () => {
  it('opens a posts search for the exact tag', () => {
    expect(hashtagSearchPath('music')).toBe('/search?q=%23music&type=posts');
  });
});
