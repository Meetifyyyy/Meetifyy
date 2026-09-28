import { BadRequestException } from '@nestjs/common';
import { requestedUserIds } from './requested-user-ids';

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
