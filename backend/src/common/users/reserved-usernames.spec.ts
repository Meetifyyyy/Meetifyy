import {
  isReservedUsername,
  RESERVED_USERNAME_MESSAGE,
} from './reserved-usernames';
import { DELETED_USER_USERNAME } from './deleted-user';

/**
 * Handles nobody may hold.
 *
 * Enforced in two places — signup availability and the profile rename — and it
 * was only in one. The rename path checked the regex and uniqueness but not the
 * list, so anyone could register an ordinary handle and then become `admin`,
 * `support` or `meetifyy`.
 */
describe('isReservedUsername', () => {
  it('allows an ordinary handle', () => {
    for (const name of ['sarthak', 'priya_98', 'a.b.c', 'deleteme']) {
      expect(isReservedUsername(name)).toBe(false);
    }
  });

  it('reserves platform and staff handles', () => {
    for (const name of ['admin', 'meetifyy', 'support', 'official', 'system']) {
      expect(isReservedUsername(name)).toBe(true);
    }
  });

  it('reserves handles that would shadow a route', () => {
    // A username that collides with a path breaks every profile link to it.
    for (const name of ['settings', 'messages', 'crew', 'search']) {
      expect(isReservedUsername(name)).toBe(true);
    }
  });

  describe('deleted-account impersonation', () => {
    it('reserves the handle the tombstone renders under', () => {
      // Every unavailable account is presented as this username. A real person
      // holding it would be indistinguishable from a deleted one in every list
      // the presenter touches.
      expect(isReservedUsername(DELETED_USER_USERNAME)).toBe(true);
      expect(isReservedUsername('deleted')).toBe(true);
    });

    it('reserves the obvious variants', () => {
      for (const name of [
        'deleteduser',
        'deleted_user',
        'deleted-user',
        'deletedaccount',
        'deleted_account',
        'accountdeleted',
        'removeduser',
      ]) {
        expect(isReservedUsername(name)).toBe(true);
      }
    });

    it('reserves the whole deleted_ prefix the purge writes', () => {
      // The purge anonymizes to `deleted_<id fragment>_<timestamp>`. Reserving
      // the prefix stops a user hand-crafting a handle that looks purged — and
      // stops a later real purge colliding with it.
      expect(isReservedUsername('deleted_a1b2c3d4_1788234160332')).toBe(true);
      expect(isReservedUsername('deleted_anything')).toBe(true);
    });
  });

  it('normalizes case and surrounding whitespace', () => {
    // The callers lowercase already; this does not depend on every one of them
    // remembering, because the cost of a miss is an impersonation.
    expect(isReservedUsername('ADMIN')).toBe(true);
    expect(isReservedUsername('  Deleted  ')).toBe(true);
    expect(isReservedUsername('DeLeTeD_User')).toBe(true);
  });

  it('treats an empty value as not reserved, leaving format validation to the caller', () => {
    expect(isReservedUsername('')).toBe(false);
    expect(isReservedUsername(null)).toBe(false);
    expect(isReservedUsername(undefined)).toBe(false);
  });

  it('does not disclose why a handle is unavailable', () => {
    // A distinct "that one is reserved" message would let the list be
    // enumerated through the endpoint.
    expect(RESERVED_USERNAME_MESSAGE).toBe('Username not available');
  });
});
