import { describe, it, expect } from 'vitest';
import {
  ALL_VIEWS,
  CREW_TAB_SLUGS,
  TAB_ALL,
  TAB_MINE,
  TAB_ONE_ON_ONE,
  TAB_SAVED,
  slugToTab,
  tabToSlug,
} from '../crewTabs';

const COLLEGE = 'GLA University';

describe('crew tab addressing', () => {
  it('offers exactly the five top-level categories', () => {
    expect(CREW_TAB_SLUGS).toEqual(['all', 'college', '1-on-1', 'my-activities', 'saved']);
  });

  it('round-trips every tab through its slug', () => {
    for (const tab of [TAB_ALL, COLLEGE, TAB_ONE_ON_ONE, TAB_MINE, TAB_SAVED]) {
      expect(slugToTab(tabToSlug(tab, COLLEGE), COLLEGE)).toBe(tab);
    }
  });

  it('addresses the college tab by role, so renaming the college keeps the link working', () => {
    expect(tabToSlug(COLLEGE, COLLEGE)).toBe('college');
    expect(slugToTab('college', 'Some Other College')).toBe('Some Other College');
  });

  it('falls back to All when the user has no college', () => {
    expect(slugToTab('college', null)).toBe(TAB_ALL);
    expect(tabToSlug(COLLEGE, null)).toBe('all');
  });

  it('sends a link to the retired for-you tab to All', () => {
    expect(CREW_TAB_SLUGS).not.toContain('for-you');
    expect(slugToTab('for-you', COLLEGE)).toBe(TAB_ALL);
  });

  it('resolves an unknown or missing slug to All', () => {
    expect(slugToTab('nonsense', COLLEGE)).toBe(TAB_ALL);
    expect(slugToTab(undefined, COLLEGE)).toBe(TAB_ALL);
  });

  it('exposes the sectioned and expanded views of the All tab', () => {
    expect(ALL_VIEWS).toEqual(['sections', 'for-you']);
  });
});
