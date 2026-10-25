import { describe, expect, it } from 'vitest';
import { avatarFor } from '../components/HandleMark';

describe('avatarFor', () => {
  it('gives a name the same avatar every time, whatever its case', () => {
    expect(avatarFor('Lunar.Koi')).toEqual(avatarFor('lunar.koi'));
  });

  it('shows the name’s first letter, capitalised', () => {
    expect(avatarFor('quiet.fern').letter).toBe('Q');
    expect(avatarFor('Velvet_moth').letter).toBe('V');
    expect(avatarFor('').letter).toBe('?');
  });

  it('spreads names across every colour', () => {
    const colours = new Set();
    for (let i = 0; i < 400; i += 1) colours.add(avatarFor(`quiet.fox${i}`).bg);
    expect(colours.size).toBe(10);
  });
});
