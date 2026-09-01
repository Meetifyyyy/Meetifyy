import {
  isUnavailableUser,
  presentUser,
  presentUserName,
  presentUserAvatar,
  DELETED_USER_DISPLAY_NAME,
} from './deleted-user';

describe('deleted-user presentation', () => {
  const real = {
    id: 'u1',
    username: 'sam',
    displayName: 'Sam Rivera',
    avatar: 'https://cdn/avatars/sam.jpg',
    cover: 'https://cdn/covers/sam.jpg',
    bio: 'CS 2027',
    accountStatus: 'ACTIVE',
    deletedAt: null,
  };

  it('leaves an active user completely untouched', () => {
    expect(presentUser(real)).toBe(real);
    expect(presentUserName(real)).toBe('Sam Rivera');
    expect(presentUserAvatar(real)).toBe('https://cdn/avatars/sam.jpg');
  });

  // The pending case is the one that actually leaks: the row still holds the
  // real name and photo for the whole 30 days, so anything that forgets to
  // substitute shows them.
  it.each(['PENDING_DELETION', 'DELETED'])(
    'substitutes the tombstone for a %s account',
    (status) => {
      const user = { ...real, accountStatus: status, deletedAt: new Date() };
      expect(isUnavailableUser(user)).toBe(true);

      const shown = presentUser(user)! as any;
      expect(shown.id).toBe('u1'); // rows still key off it
      expect(shown.displayName).toBe(DELETED_USER_DISPLAY_NAME);
      expect(shown.avatar).toBeNull();
      expect(shown.cover).toBeNull();
      expect(shown.bio).toBeNull();
      expect(shown.username).not.toBe('sam');
      expect(shown.profileAvailable).toBe(false);
      expect(presentUserName(user)).toBe(DELETED_USER_DISPLAY_NAME);
      expect(presentUserAvatar(user)).toBeNull();
    },
  );

  it('treats a stamped deletedAt as unavailable even without a status column', () => {
    // Half the call sites select one column, half the other. Either alone has
    // to be enough or a narrow select becomes a silent leak.
    expect(isUnavailableUser({ id: 'u1', deletedAt: new Date() })).toBe(true);
    expect(isUnavailableUser({ id: 'u1', accountStatus: 'DELETED' })).toBe(true);
  });

  it('does not pass extra selected fields through the tombstone', () => {
    const user = {
      ...real,
      accountStatus: 'DELETED',
      deletedAt: new Date(),
      collegeEmail: 'sam@university.edu',
      birthday: '2004-01-01',
    };
    const shown = presentUser(user) as any;
    expect(shown.collegeEmail).toBeUndefined();
    expect(shown.birthday).toBeUndefined();
  });

  it('treats a missing user as unavailable rather than throwing', () => {
    expect(isUnavailableUser(null)).toBe(true);
    expect(presentUser(null)).toBeNull();
    expect(presentUserName(undefined)).toBe(DELETED_USER_DISPLAY_NAME);
  });
});
