import { describe, it, expect } from 'vitest';
import { normalizeMultilineText, toSummaryText } from '../communityText';

// Same cases as backend/src/common/utils/multiline-text.util.spec.ts: the two
// implementations must agree.
const CASES = [
  ['collapses spaces and tabs', 'a   b\t\tc \t d', 'a b c d'],
  ['trims both ends', '  \n\t hello world \n\n ', 'hello world'],
  ['keeps single line breaks', 'line one\nline two', 'line one\nline two'],
  ['keeps one blank line between paragraphs', 'p1\n\n\n\n\np2', 'p1\n\np2'],
  ['drops blanks around breaks', 'p1   \n   p2', 'p1\np2'],
  ['treats whitespace-only lines as empty', 'p1\n   \n\t\n  \np2', 'p1\n\np2'],
  ['normalises CRLF and CR', 'a\r\nb\rc', 'a\nb\nc'],
  ['collapses no-break and ideographic spaces', 'a\u00a0\u00a0b\u3000c', 'a b c'],
  ['leaves emoji sequences intact', '\u{1F468}‍\u{1F469}‍\u{1F467}  family   \u{1F389}', '\u{1F468}‍\u{1F469}‍\u{1F467} family \u{1F389}'],
  ['handles mixed text', ' Robotics\t& AI  \u{1F916} \n\n\n Meet   weekly. ', 'Robotics & AI \u{1F916}\n\nMeet weekly.'],
  ['returns empty for only whitespace', ' \n\t \n ', ''],
  ['treats Hangul fillers as blank', '\u3164\u3164\u3164', ''],
  ['collapses fillers between words', 'a\u3164\u3164 \u2800b', 'a b'],
  ['drops zero-width spaces, keeps joiners', 'a\u200b\u200bb \u{1F468}\u200d\u{1F469}', 'ab \u{1F468}\u200d\u{1F469}'],
];

describe('normalizeMultilineText', () => {
  it.each(CASES)('%s', (_label, input, expected) => {
    expect(normalizeMultilineText(input)).toBe(expected);
  });

  it('is idempotent and tolerates non-strings', () => {
    const once = normalizeMultilineText(' a  \n\n\n b\t c ');
    expect(normalizeMultilineText(once)).toBe(once);
    expect(normalizeMultilineText(null)).toBe('');
    expect(normalizeMultilineText(undefined)).toBe('');
  });
});

describe('toSummaryText', () => {
  it('folds paragraphs into one line for a clamped preview', () => {
    expect(toSummaryText('  Robotics  club\n\n\n\nMeet\nweekly ')).toBe('Robotics club Meet weekly');
  });
});

describe('limitLineBreaks', () => {
  it('keeps up to ten line breaks and turns the rest into spaces', async () => {
    const { limitLineBreaks } = await import('@shared/constants/communityLimits');
    const twelve = Array.from({ length: 13 }, (_, i) => `l${i}`).join('\n');
    const out = limitLineBreaks(twelve);
    expect(out.split('\n')).toHaveLength(11);
    expect(out.endsWith('l10 l11 l12')).toBe(true);
    expect(limitLineBreaks('a\r\nb')).toBe('a\nb');
    expect(limitLineBreaks('one line')).toBe('one line');
  });
});
