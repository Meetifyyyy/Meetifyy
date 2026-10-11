import { describe, it, expect } from 'vitest';
import {
  COMMUNITY_DESCRIPTION_MAX,
  isValidCommunityDescription,
} from '../communityLimits';

describe('community description limit', () => {
  it('is 250', () => {
    expect(COMMUNITY_DESCRIPTION_MAX).toBe(250);
  });

  it.each([
    [2, false],
    [3, true],
    [199, true],
    [200, true],
    [201, true],
    [249, true],
    [250, true],
    [251, false],
  ])('%i characters -> %s', (length, valid) => {
    expect(isValidCommunityDescription('a'.repeat(length))).toBe(valid);
  });

  it('counts the trimmed text', () => {
    expect(isValidCommunityDescription(`  ${'a'.repeat(250)}  `)).toBe(true);
  });
});
