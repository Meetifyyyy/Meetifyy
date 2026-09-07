import { describe, expect, it } from 'vitest';
import {
  areUsersCompatible,
  filterCompatibleUsers,
  isFirstYearRestrictedError,
  isMessagingRestricted,
  MESSAGING_RESTRICTED_BODY,
  MESSAGING_RESTRICTED_TITLE,
} from '../studentYearPolicy';

/**
 * The client half of first-year isolation.
 *
 * Everything here is a UX hint, so the behaviour worth protecting is the
 * FAILURE MODE: what these helpers do when the server has not told them
 * something. Getting that wrong is how a hint turns into a lockout.
 */
describe('isMessagingRestricted', () => {
  it('locks the button when the server says the pair is restricted', () => {
    expect(isMessagingRestricted({ messagingRestricted: true })).toBe(true);
  });

  it('leaves it unlocked for an ordinary profile', () => {
    expect(isMessagingRestricted({ messagingRestricted: false })).toBe(false);
  });

  it('leaves it unlocked when the flag is absent, not the other way round', () => {
    // A payload from a stale cache or an older endpoint must not lock a user
    // out of somebody they are allowed to message. The server refuses the
    // action if it really is restricted.
    expect(isMessagingRestricted({})).toBe(false);
    expect(isMessagingRestricted(null)).toBe(false);
    expect(isMessagingRestricted(undefined)).toBe(false);
  });

  it('is not fooled by a truthy non-boolean', () => {
    expect(isMessagingRestricted({ messagingRestricted: 'yes' })).toBe(false);
  });
});

describe('areUsersCompatible', () => {
  const firstYear = { id: 'a', isFirstYearStudent: true };
  const senior = { id: 'b', isFirstYearStudent: false };

  it('allows two first-year students', () => {
    expect(
      areUsersCompatible(firstYear, { id: 'c', isFirstYearStudent: true }),
    ).toBe(true);
  });

  it('allows two non-first-year students', () => {
    expect(areUsersCompatible(senior, { id: 'd', isFirstYearStudent: false })).toBe(
      true,
    );
  });

  it('blocks a mixed pair in both directions', () => {
    expect(areUsersCompatible(firstYear, senior)).toBe(false);
    expect(areUsersCompatible(senior, firstYear)).toBe(false);
  });

  it('treats an unknown status as compatible', () => {
    expect(areUsersCompatible(firstYear, { id: 'e' })).toBe(true);
    expect(areUsersCompatible({ id: 'f' }, firstYear)).toBe(true);
  });
});

describe('filterCompatibleUsers', () => {
  const viewerFirstYear = { id: 'me', isFirstYearStudent: true };
  const viewerSenior = { id: 'me', isFirstYearStudent: false };

  const rows = [
    { id: '1', isFirstYearStudent: true },
    { id: '2', isFirstYearStudent: false },
    { id: '3' }, // unmarked — e.g. a conversation partner
  ];

  it('keeps only marked first-year rows for a first-year viewer', () => {
    expect(filterCompatibleUsers(viewerFirstYear, rows).map((u) => u.id)).toEqual(
      ['1', '3'],
    );
  });

  it('drops marked first-year rows for a senior viewer', () => {
    expect(filterCompatibleUsers(viewerSenior, rows).map((u) => u.id)).toEqual([
      '2',
      '3',
    ]);
  });

  it('keeps unmarked rows, so a picker cannot be emptied by a narrow payload', () => {
    // The New Message modal draws partly on conversation payloads, which carry
    // no marker. Dropping those would remove every thread a first-year student
    // already has from their own picker.
    expect(filterCompatibleUsers(viewerFirstYear, [{ id: 'x' }])).toHaveLength(1);
  });

  it('leaves the list alone when the viewer status is unknown', () => {
    expect(filterCompatibleUsers({ id: 'me' }, rows)).toHaveLength(3);
    expect(filterCompatibleUsers(null, rows)).toHaveLength(3);
  });

  it('tolerates a non-array', () => {
    expect(filterCompatibleUsers(viewerFirstYear, undefined)).toEqual([]);
  });
});

describe('the restriction copy', () => {
  it('says exactly what the product asked for', () => {
    expect(MESSAGING_RESTRICTED_TITLE).toBe('Messaging Restricted');
    expect(MESSAGING_RESTRICTED_BODY).toBe(
      'Direct messaging between first-year students and students from other ' +
        'years is temporarily restricted to help keep first-year students safe.',
    );
  });

  it('names neither cohort, so it reads the same in both directions', () => {
    expect(MESSAGING_RESTRICTED_BODY).not.toMatch(/\b20\d{2}\b/);
    expect(MESSAGING_RESTRICTED_BODY).not.toMatch(/you are|your batch/i);
  });
});

describe('isFirstYearRestrictedError', () => {
  it('recognises the policy refusal in the shapes an API error arrives in', () => {
    expect(
      isFirstYearRestrictedError({
        response: { data: { code: 'FIRST_YEAR_RESTRICTED' } },
      }),
    ).toBe(true);
    expect(
      isFirstYearRestrictedError({ data: { code: 'FIRST_YEAR_RESTRICTED' } }),
    ).toBe(true);
    expect(isFirstYearRestrictedError({ code: 'FIRST_YEAR_RESTRICTED' })).toBe(
      true,
    );
  });

  it('ignores every other failure', () => {
    expect(isFirstYearRestrictedError({ code: 'RECIPIENT_UNAVAILABLE' })).toBe(
      false,
    );
    expect(isFirstYearRestrictedError(new Error('network'))).toBe(false);
    expect(isFirstYearRestrictedError(null)).toBe(false);
  });
});
