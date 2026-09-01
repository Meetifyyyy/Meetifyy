import { ActivitiesService } from './activities.service';

/**
 * How a deleted member appears on an activity card and in its attendee list.
 *
 * Activities hosted BY a deleted user are already filtered out by
 * `ActivityAuthorizationService`. This covers the other half, which was
 * leaking: an activity hosted by somebody live, which a since-deleted user had
 * joined. Their row stays — removing it would silently change the attendee
 * count and the host's record of who came — but their avatar was still
 * rendering in the card's stack and their real name in the attendee list.
 */
describe('ActivitiesService — deleted members', () => {
  const live = {
    id: 'u1',
    username: 'sarthak',
    displayName: 'Sarthak Saini',
    avatar: 'avatars/sarthak.jpg',
    isCampusRep: true,
    accountStatus: 'ACTIVE',
    deletedAt: null,
  };

  const present = (user: any) =>
    (ActivitiesService as any).presentMember(user);
  const presentCard = (row: any) =>
    (ActivitiesService as any).presentCardRow(row);

  it('leaves a live member untouched', () => {
    expect(present(live)).toBe(live);
  });

  it.each(['PENDING_DELETION', 'DELETED'])(
    'substitutes the tombstone for a %s member',
    (accountStatus) => {
      const shown = present({ ...live, accountStatus, deletedAt: new Date() });

      expect(shown.displayName).toBe('Deleted User');
      // Null, so every client's Avatar falls back to the default asset — which
      // is the reported symptom: the real photograph was still rendering.
      expect(shown.avatar).toBeNull();
      expect(shown.username).not.toBe('sarthak');
      expect(shown.isDeleted).toBe(true);
      expect(shown.profileAvailable).toBe(false);
      expect(shown.isCampusRep).toBe(false);
      // The id survives so membership rows still key correctly.
      expect(shown.id).toBe('u1');
    },
  );

  it('leaks nothing of the real identity', () => {
    const shown = present({
      ...live,
      accountStatus: 'PENDING_DELETION',
      deletedAt: new Date(),
    });
    const serialized = JSON.stringify(shown);
    expect(serialized).not.toContain('Sarthak Saini');
    expect(serialized).not.toContain('sarthak');
    expect(serialized).not.toContain('avatars/');
  });

  describe('the card’s embedded avatar stack', () => {
    const deleted = {
      ...live,
      id: 'u2',
      username: 'gone',
      displayName: 'Gone Person',
      avatar: 'avatars/gone.jpg',
      accountStatus: 'PENDING_DELETION',
      deletedAt: new Date(),
    };

    it('substitutes only the deleted members, leaving the rest alone', () => {
      const row = presentCard({
        id: 'act-1',
        title: 'Football at 6',
        members: [
          { userId: 'u1', status: 'MEMBER', user: live },
          { userId: 'u2', status: 'MEMBER', user: deleted },
        ],
      });

      expect(row.members[0].user.displayName).toBe('Sarthak Saini');
      expect(row.members[1].user.displayName).toBe('Deleted User');
      expect(row.members[1].user.avatar).toBeNull();
      // The membership row itself is untouched, so the attendee count and the
      // host's record of who joined do not silently change.
      expect(row.members[1].userId).toBe('u2');
      expect(row.members).toHaveLength(2);
      expect(row.title).toBe('Football at 6');
    });

    it('passes a row with no members straight through', () => {
      const row = { id: 'act-2', title: 'Chess' };
      expect(presentCard(row)).toBe(row);
      expect(presentCard({ ...row, members: [] })).toEqual({
        ...row,
        members: [],
      });
    });
  });

  it('treats a missing user as nothing to present rather than throwing', () => {
    expect(present(null)).toBeNull();
    expect(present(undefined)).toBeUndefined();
  });
});
