import { BadRequestException } from '@nestjs/common';
import { MAX_NEW_GROUP_MEMBERS } from './message-limits';
import { queryUserIds, requestedUserIds } from './requested-user-ids';

describe('requestedUserIds', () => {
  it('accepts an array of ids', () => {
    expect(requestedUserIds(['a', 'b'])).toEqual(['a', 'b']);
  });

  it('accepts an array of { id } and { userId } objects', () => {
    expect(requestedUserIds([{ id: 'a' }, { userId: 'b' }, 'c'])).toEqual([
      'a',
      'b',
      'c',
    ]);
  });

  it('accepts a single id or a single object', () => {
    expect(requestedUserIds('a')).toEqual(['a']);
    expect(requestedUserIds({ userId: 'b' })).toEqual(['b']);
  });

  it('skips entries that name nothing', () => {
    expect(requestedUserIds(['', null, {}, 7, ['x'], 'a'])).toEqual(['a']);
    expect(requestedUserIds(true)).toEqual([]);
  });

  it('refuses an entry whose id is not a string', () => {
    // Previously passed through to the block check and failed there as a 500.
    expect(() => requestedUserIds([{ id: 5 }])).toThrow(BadRequestException);
    expect(() => requestedUserIds({ userId: { $ne: null } })).toThrow(
      BadRequestException,
    );
  });
});

describe('queryUserIds', () => {
  const id = (n: number) =>
    `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

  it('splits a comma-separated list and skips empty entries', () => {
    expect(queryUserIds(`${id(1)},,${id(2)},`)).toEqual([id(1), id(2)]);
    expect(queryUserIds(` ${id(3)} `)).toEqual([id(3)]);
  });

  it('accepts as many people as a new group may start with, and no more', () => {
    // The body form was capped; this form passed a raw split straight on.
    const most = Array.from({ length: MAX_NEW_GROUP_MEMBERS }, (_, i) => id(i));
    expect(queryUserIds(most.join(','))).toHaveLength(MAX_NEW_GROUP_MEMBERS);
    expect(() =>
      queryUserIds([...most, id(MAX_NEW_GROUP_MEMBERS)].join(',')),
    ).toThrow(BadRequestException);
  });

  it('refuses an entry that is not a user id, before any query sees it', () => {
    expect(() => queryUserIds(`${id(1)},not-an-id`)).toThrow(
      BadRequestException,
    );
  });
});
