/**
 * Crew tab addressing.
 *
 * The selected tab lives in the URL (?tab=college), so a refresh, a shared link
 * and the Back button all agree on which list is showing. Slugs are fixed even
 * though the college pill's label is dynamic, so its address never shifts.
 */

export const TAB_ALL = 'All';
export const TAB_ONE_ON_ONE = '1-on-1';
export const TAB_MINE = 'My Activities';
export const TAB_SAVED = 'Saved';

export const CREW_TAB_SLUGS = ['all', 'college', '1-on-1', 'my-activities', 'saved'];

export const STATIC_TAB_BY_SLUG = {
  all: TAB_ALL,
  '1-on-1': TAB_ONE_ON_ONE,
  'my-activities': TAB_MINE,
  saved: TAB_SAVED,
};

/**
 * Views within the All tab. "See all" on the For You strip opens the full ranked
 * list in place (?tab=all&view=for-you) rather than adding a sixth top-level tab.
 */
export const ALL_VIEWS = ['sections', 'for-you'];

/**
 * Slug → visible tab label. An unknown slug — including a link to the retired
 * `for-you` tab, whose content is now a subsection of All — resolves to All.
 */
export function slugToTab(slug, collegeTab) {
  if (slug === 'college') return collegeTab || TAB_ALL;
  return STATIC_TAB_BY_SLUG[slug] || TAB_ALL;
}

/** Visible tab label → slug. The college tab is addressed by role, not by name. */
export function tabToSlug(tab, collegeTab) {
  if (collegeTab && tab === collegeTab) return 'college';
  const found = Object.entries(STATIC_TAB_BY_SLUG).find(([, label]) => label === tab);
  return found ? found[0] : 'all';
}
