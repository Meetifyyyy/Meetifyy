import { describe, it, expect } from 'vitest';
import { validateHandle, suggestHandles, looksIdentifying, HANDLE_MAX } from '../confessionHandle';

describe('validateHandle', () => {
  it.each([
    ['ab', 'short'],
    ['a'.repeat(HANDLE_MAX + 1), 'long'],
    ['1fox', 'start'],
    ['_fox', 'start'],
    ['fox-tail', 'chars'],
    ['fox tail', 'chars'],
    ['fox..tail', 'repeat'],
    ['fox._tail', 'repeat'],
    ['foxtail.', 'end'],
    ['foxtail_', 'end'],
    ['Admin', 'reserved'],
    ['meetifyy', 'reserved'],
  ])('refuses %j (%s)', (handle, reason) => {
    expect(validateHandle(handle)).toEqual({ ok: false, reason });
  });

  it.each(['fox', 'quiet.fox', 'Velvet_Moth42', 'a'.repeat(HANDLE_MAX)])('accepts %j', (handle) => {
    expect(validateHandle(handle).ok).toBe(true);
  });

  it('treats non-strings as empty', () => {
    expect(validateHandle(undefined)).toEqual({ ok: false, reason: 'short' });
  });
});

describe('suggestHandles', () => {
  it('only suggests names that pass the rules, without repeats', () => {
    for (let i = 0; i < 20; i += 1) {
      const names = suggestHandles(3);
      expect(names).toHaveLength(3);
      expect(new Set(names).size).toBe(3);
      names.forEach((n) => expect(validateHandle(n).ok).toBe(true));
    }
  });
});

describe('looksIdentifying', () => {
  const priya = {
    names: ['Priya Sharma', 'priya_s21'],
    emails: ['priya.sharma2004@iitd.ac.in', '21bcs045@college.edu'],
  };

  it.each([
    ['PriyaWrites', 'first name, any case'],
    ['the.sharma', 'surname'],
    ['priyasharma', 'joined full name'],
    ['moth2004', 'digits from the email'],
    ['owl_045x', 'roll number digits'],
  ])('flags %j (%s)', (handle) => {
    expect(looksIdentifying(handle, priya)).toBe(true);
  });

  it.each([
    ['quiet.fox42', 'unrelated, short digits'],
    ['midnight_owl', 'unrelated'],
    ['iitd.ghost', 'college domain is not the person'],
    ['student.moth', 'a generic email piece'],
  ])('leaves %j alone (%s)', (handle) => {
    expect(looksIdentifying(handle, priya)).toBe(false);
  });

  it('matches three-letter names only as a whole piece', () => {
    const sam = { names: ['Sam Li'], emails: [] };
    expect(looksIdentifying('sam.owl', sam)).toBe(true);
    expect(looksIdentifying('samosa.lover', sam)).toBe(false);
    // Two letters is too short to mean anything.
    expect(looksIdentifying('li.lantern', sam)).toBe(false);
  });

  it('ignores accents', () => {
    expect(looksIdentifying('zoe.writes', { names: ['Zoë Hart'] })).toBe(true);
  });

  it('is quiet with no identity to compare', () => {
    expect(looksIdentifying('priya', undefined)).toBe(false);
    expect(looksIdentifying('priya', { names: [null, ''], emails: [undefined] })).toBe(false);
  });
});
