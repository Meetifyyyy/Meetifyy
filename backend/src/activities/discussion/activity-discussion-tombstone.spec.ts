import { ActivityDiscussionService } from './activity-discussion.service';

/**
 * How a deleted member appears in an activity discussion.
 *
 * The rule, and the reason it differs from posts and activities: a discussion
 * is a conversation among the activity's members, so removing one person's
 * messages rewrites the thread for everyone else. The messages stay with their
 * text intact; only the identity is replaced — default avatar, "Deleted User",
 * no profile link, no campus-representative badge.
 *
 * This holds for BOTH halves of the lifecycle. During the 30-day window the row
 * still carries the real name and photo, so the substitution has to happen in
 * the serialization layer rather than relying on the purge having run.
 */
describe('ActivityDiscussionService — deleted author presentation', () => {
  let service: ActivityDiscussionService;

  const message = (user: any) => ({
    id: 'm1',
    text: 'see you all at 6',
    createdAt: new Date('2026-09-01T10:00:00Z'),
    userId: 'u1',
    user,
  });

  const live = {
    id: 'u1',
    username: 'sam',
    displayName: 'Sam Rivera',
    avatar: 'avatars/sam.jpg',
    isCampusRep: true,
    accountStatus: 'ACTIVE',
    deletedAt: null,
  };

  /** `format` is private; this is the projection every read path goes through. */
  const format = (user: any) =>
    (service as any).format(message(user), 'act-1');

  beforeEach(() => {
    service = Object.create(
      ActivityDiscussionService.prototype,
    ) as ActivityDiscussionService;
  });

  it('leaves a live author untouched', () => {
    const out = format(live);
    expect(out.user).toMatchObject({
      id: 'u1',
      username: 'sam',
      displayName: 'Sam Rivera',
      avatar: 'avatars/sam.jpg',
      isDeleted: false,
      profileAvailable: true,
      isCampusRep: true,
    });
  });

  it.each(['PENDING_DELETION', 'DELETED'])(
    'substitutes the tombstone for a %s author while keeping the message',
    (accountStatus) => {
      const out = format({ ...live, accountStatus, deletedAt: new Date() });

      // The message itself survives — that is the whole point.
      expect(out.text).toBe('see you all at 6');
      expect(out.id).toBe('m1');
      expect(out.userId).toBe('u1');

      expect(out.user.displayName).toBe('Deleted User');
      // Null, so the client's Avatar falls back to the default asset.
      expect(out.user.avatar).toBeNull();
      expect(out.user.username).not.toBe('sam');
      expect(out.user.isDeleted).toBe(true);
      expect(out.user.profileAvailable).toBe(false);
      // A deleted account must not keep wearing a representative badge.
      expect(out.user.isCampusRep).toBe(false);
    },
  );

  it('leaks nothing of the real identity anywhere in the payload', () => {
    const out = format({
      ...live,
      accountStatus: 'DELETED',
      deletedAt: new Date(),
    });
    const serialized = JSON.stringify(out);
    expect(serialized).not.toContain('Sam Rivera');
    expect(serialized).not.toContain('sam');
    expect(serialized).not.toContain('avatars/');
  });

  it('falls back safely when the author row was not loaded at all', () => {
    // A missing relation is treated as unavailable rather than as a live user,
    // so a narrowed select can never fail open.
    const out = format(null);
    expect(out.user.displayName).toBe('Deleted User');
    expect(out.user.avatar).toBeNull();
    expect(out.userId).toBe('u1');
  });
});
