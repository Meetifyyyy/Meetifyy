import { normalizeMultilineText } from './multiline-text.util';

describe('normalizeMultilineText', () => {
  it.each<[string, string, string]>([
    ['collapses spaces and tabs', 'a   b\t\tc \t d', 'a b c d'],
    ['trims both ends', '  \n\t hello world \n\n ', 'hello world'],
    ['keeps single line breaks', 'line one\nline two', 'line one\nline two'],
    ['keeps one blank line between paragraphs', 'p1\n\n\n\n\np2', 'p1\n\np2'],
    ['drops blanks around breaks', 'p1   \n   p2', 'p1\np2'],
    [
      'treats whitespace-only lines as empty',
      'p1\n   \n\t\n  \np2',
      'p1\n\np2',
    ],
    ['normalises CRLF and CR', 'a\r\nb\rc', 'a\nb\nc'],
    [
      'collapses no-break and ideographic spaces',
      'a\u00a0\u00a0b\u3000c',
      'a b c',
    ],
    ['leaves emoji sequences intact', '👨‍👩‍👧  family   🎉', '👨‍👩‍👧 family 🎉'],
    [
      'handles mixed text',
      ' Robotics\t& AI  🤖 \n\n\n Meet   weekly. ',
      'Robotics & AI 🤖\n\nMeet weekly.',
    ],
    ['returns empty for only whitespace', ' \n\t \n ', ''],
    ['treats Hangul fillers as blank', '\u3164\u3164\u3164', ''],
    ['collapses fillers between words', 'a\u3164\u3164 \u2800b', 'a b'],
    [
      'drops zero-width spaces, keeps joiners',
      'a\u200b\u200bb \u{1F468}\u200d\u{1F469}',
      'ab \u{1F468}\u200d\u{1F469}',
    ],
  ])('%s', (_label, input, expected) => {
    expect(normalizeMultilineText(input)).toBe(expected);
  });

  it('is idempotent', () => {
    const once = normalizeMultilineText(' a  \n\n\n b\t c ');
    expect(normalizeMultilineText(once)).toBe(once);
  });
});
