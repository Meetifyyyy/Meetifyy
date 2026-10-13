import { describe, it, expect } from 'vitest';
import { groupNotifications, othersLabel } from '../groupNotifications';

const n = (id, type, extra = {}) => ({ id, type, createdAt: '2026-10-13T10:00:00Z', readAt: null, ...extra });

describe('groupNotifications', () => {
  it('merges likes on the same post into the newest one', () => {
    const rows = groupNotifications([
      n('3', 'LIKE', { entityId: 'p1' }),
      n('2', 'LIKE', { metadata: { postId: 'p1' } }),
      n('1', 'LIKE', { entityId: 'p1' }),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: '3', groupCount: 3, groupIds: ['3', '2', '1'] });
  });

  it('keeps likes on different posts apart, and keeps order', () => {
    const rows = groupNotifications([
      n('a', 'LIKE', { entityId: 'p1' }),
      n('b', 'COMMENT', { entityId: 'c1' }),
      n('c', 'LIKE', { entityId: 'p2' }),
      n('d', 'LIKE', { entityId: 'p1' }),
    ]);
    expect(rows.map((r) => r.id)).toEqual(['a', 'b', 'c']);
    expect(rows[0].groupCount).toBe(2);
    expect(rows[2].groupCount).toBeUndefined();
  });

  it('never merges comments, mentions or messages', () => {
    const rows = groupNotifications([
      n('1', 'COMMENT', { entityId: 'p1' }),
      n('2', 'COMMENT', { entityId: 'p1' }),
      n('3', 'MENTION', { entityId: 'p1' }),
      n('4', 'MENTION', { entityId: 'p1' }),
      n('5', 'MESSAGE', { entityId: 'conv' }),
      n('6', 'MESSAGE', { entityId: 'conv' }),
    ]);
    expect(rows).toHaveLength(6);
  });

  it('merges all follows, comment likes per comment, joins per activity', () => {
    const rows = groupNotifications([
      n('f1', 'FOLLOW'),
      n('cl1', 'COMMENT_LIKE', { entityId: 'c1' }),
      n('f2', 'FOLLOW'),
      n('cl2', 'COMMENT_LIKE', { metadata: { commentId: 'c1' } }),
      n('j1', 'JOIN_REQUEST', { entityId: 'act' }),
      n('j2', 'JOIN_REQUEST', { metadata: { activityId: 'act' } }),
    ]);
    expect(rows.map((r) => [r.id, r.groupCount])).toEqual([
      ['f1', 2],
      ['cl1', 2],
      ['j1', 2],
    ]);
  });

  it('reads as unread while any member is unread', () => {
    const [row] = groupNotifications([
      n('2', 'LIKE', { entityId: 'p', readAt: '2026-10-13T11:00:00Z', read: true }),
      n('1', 'LIKE', { entityId: 'p' }),
    ]);
    expect(row.read).toBe(false);
    expect(row.readAt).toBeNull();
    const [allRead] = groupNotifications([
      n('2', 'LIKE', { entityId: 'p', readAt: 'x' }),
      n('1', 'LIKE', { entityId: 'p', readAt: 'y' }),
    ]);
    expect(allRead.read).toBe(true);
  });

  it('leaves a lone notification exactly as it was', () => {
    const single = n('1', 'LIKE', { entityId: 'p' });
    expect(groupNotifications([single])[0]).toBe(single);
  });
});

describe('othersLabel', () => {
  it('counts the others', () => {
    expect(othersLabel(2)).toBe('and 1 other');
    expect(othersLabel(5)).toBe('and 4 others');
    expect(othersLabel(1)).toBe('');
    expect(othersLabel(undefined)).toBe('');
  });
});
