import { communityMemberCount } from '@shared/utils/community';

const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });

/** "1 member", "1.2K members". */
export function memberLabel(community) {
  const n = communityMemberCount(community);
  return `${compact.format(n)} ${n === 1 ? 'member' : 'members'}`;
}

/** Newest post first; communities with no posts keep their join order. */
export function byRecentActivity(a, b) {
  const ta = a.lastPostAt ? Date.parse(a.lastPostAt) : 0;
  const tb = b.lastPostAt ? Date.parse(b.lastPostAt) : 0;
  return tb - ta;
}
