import { describe, expect, it, vi } from 'vitest';

vi.mock('@shared/api/apiClient', () => ({ getMediaUrl: (v) => v || '' }));

import { SHARE_KIND, normalizeShareContent } from '../../content';
import { buildStoryModel, collageFor, compactCount } from '../model';


describe('story model', () => {
  it('picks a collage by image count and counts the overflow', () => {
    expect(collageFor([]).layout).toBeNull();
    expect(collageFor(['a']).layout).toBe('single');
    expect(collageFor(['a', 'b']).layout).toBe('pair');
    expect(collageFor(['a', 'b', 'c']).layout).toBe('feature');
    expect(collageFor(['a', 'b', 'c', 'd', 'e', 'f'])).toEqual({ layout: 'grid', images: ['a', 'b', 'c', 'd'], more: 2 });
  });

  it('formats counts compactly', () => {
    expect(compactCount(0)).toBe('0');
    expect(compactCount(999)).toBe('999');
    expect(compactCount(1000)).toBe('1K');
    expect(compactCount(12_400)).toBe('12.4K');
    expect(compactCount(3_100_000)).toBe('3.1M');
    expect(compactCount(NaN)).toBe('0');
  });

  it('gives a post its reaction counts instead of a time', () => {
    const model = buildStoryModel(normalizeShareContent(SHARE_KIND.POST, { id: 'p', likeCount: 1520, commentsCount: 3 }));
    expect(model.stats).toBe('1.5K likes · 3 comments');
    expect(model.timeLabel).toBeUndefined();
    const none = buildStoryModel(normalizeShareContent(SHARE_KIND.POST, { id: 'p', likes: [{}, {}] }));
    expect(none.stats).toBe('2 likes · 0 comments');
    const one = buildStoryModel(normalizeShareContent(SHARE_KIND.POST, { id: 'p', likeCount: 1, commentCount: 1 }));
    expect(one.stats).toBe('1 like · 1 comment');
  });

  it('shows poll results only once somebody voted, and caps the options', () => {
    const post = {
      id: 'p',
      poll: { options: ['A', 'B', 'C', 'D', 'E'], votes: [6, 2, 1, 1, 0] },
    };
    const model = buildStoryModel(normalizeShareContent(SHARE_KIND.POST, post));
    expect(model.poll.options.map((o) => o.pct)).toEqual([60, 20, 10, 10]);
    expect(model.poll.options[0].leading).toBe(true);
    expect(model.poll.hiddenOptions).toBe(1);
    expect(model.poll.votesLabel).toBe('10 votes');

    const fresh = buildStoryModel(normalizeShareContent(SHARE_KIND.POST, { id: 'p', poll: { options: ['A', 'B'] } }));
    expect(fresh.poll.options.every((o) => o.pct === null)).toBe(true);
  });

  it('gives a community a member line and no tags', () => {
    const model = buildStoryModel(normalizeShareContent(SHARE_KIND.COMMUNITY, { id: 'c', name: 'Chess', memberCount: 12_400 }));
    expect(model.subtitle).toBe('12.4K members');
    expect(model.tags).toEqual([]);
    const one = buildStoryModel(normalizeShareContent(SHARE_KIND.COMMUNITY, { id: 'c', name: 'Chess', memberCount: 1 }));
    expect(one.subtitle).toBe('1 member');
  });

  it('gives a profile its handle and interests', () => {
    const model = buildStoryModel(normalizeShareContent(SHARE_KIND.PROFILE, { username: 'al', displayName: 'Al', interests: ['Chess', ' ', 'Run'] }));
    expect(model.subtitle).toBe('@al');
    expect(model.tags).toEqual(['Chess', 'Run']);
  });

  it('words an activity like its chat card, with a fallback cover', () => {
    const model = buildStoryModel(normalizeShareContent(SHARE_KIND.ACTIVITY, { id: 'a', title: 'Run', startDate: '2026-10-03T10:00:00', time: '6 PM' }));
    expect(model.meta).toBe('Oct 3 • 6 PM');
    expect(model.calendar).toEqual({ month: 'OCT', day: '3' });
    expect(model.image).toMatch(/^https:\/\//);
    const bare = buildStoryModel(normalizeShareContent(SHARE_KIND.ACTIVITY, { id: 'a' }));
    expect(bare.title).toBe('Activity');
    expect(bare.meta).toBe('TBD');
  });
});
