import { stripTags } from './strip-tags.util';

/** CodeQL #81: nested or broken tags must not leave markup behind. */
describe('stripTags', () => {
  it.each([
    ['<b>bold</b> text', 'bold text'],
    ['plain', 'plain'],
    ['<<b>script>alert(1)<</b>/script>', 'script>alert(1)/script>'],
    ['<scr<script>ipt>x', 'ipt>x'],
    ['a <unterminated', 'a '],
  ])('%j becomes %j', (input, expected) => {
    expect(stripTags(input)).toBe(expected);
  });

  it.each([
    '<<script>script>alert(1)<</script>/script>',
    '<scr<script>ipt>',
    '<<<>>>',
    '<img src=x onerror=alert(1)//',
  ])('leaves no "<" in %j, so no tag can survive', (input) => {
    expect(stripTags(input)).not.toContain('<');
  });
});
