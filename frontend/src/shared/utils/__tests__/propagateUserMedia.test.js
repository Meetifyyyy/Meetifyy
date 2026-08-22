import { describe, it, expect, beforeEach } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { propagateUserMedia } from '../propagateUserMedia';

const USER = 'u1';
let qc;
beforeEach(() => {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});

describe('propagateUserMedia', () => {
  it('patches the avatar everywhere it is denormalised, in one pass', () => {
    qc.setQueryData(['feed'], { pages: [{ posts: [{ id: 'p1', author: { id: USER, avatar: 'old.png' } }] }] });
    qc.setQueryData(['conversations'], [{ id: 'c1', targetUser: { id: USER, avatar: 'old.png' } }]);
    qc.setQueryData(['all-users-for-invite', ''], [{ id: USER, avatar: 'old.png', username: 'ana' }]);

    propagateUserMedia(qc, { userId: USER, username: 'ana', avatar: 'new.png' });

    expect(qc.getQueryData(['feed']).pages[0].posts[0].author.avatar).toBe('new.png');
    expect(qc.getQueryData(['conversations'])[0].targetUser.avatar).toBe('new.png');
    expect(qc.getQueryData(['all-users-for-invite', ''])[0].avatar).toBe('new.png');
  });

  it('patches nodes that identify the user by userId instead of id', () => {
    // A group's memberDetails inline the avatar beside a `userId`, with no
    // nested user object — those entries used to keep the old picture in Group
    // Details and in the invite picker built from them.
    qc.setQueryData(['groupDetails', 'g1'], {
      id: 'g1',
      memberDetails: [{ userId: USER, role: 'ADMIN', avatar: 'old.png', displayName: 'Ana' }],
    });

    propagateUserMedia(qc, { userId: USER, avatar: 'new.png' });

    expect(qc.getQueryData(['groupDetails', 'g1']).memberDetails[0].avatar).toBe('new.png');
  });

  it('keeps avatar and avatarUrl in step where both spellings exist', () => {
    qc.setQueryData(['x'], { id: USER, avatar: 'old.png', avatarUrl: 'old.png' });
    propagateUserMedia(qc, { userId: USER, avatar: 'new.png' });
    expect(qc.getQueryData(['x'])).toMatchObject({ avatar: 'new.png', avatarUrl: 'new.png' });
  });

  it('carries displayName too', () => {
    qc.setQueryData(['feed'], { pages: [{ posts: [{ id: 'p1', author: { id: USER, avatar: 'a.png', displayName: 'Old' } }] }] });
    propagateUserMedia(qc, { userId: USER, displayName: 'New' });
    expect(qc.getQueryData(['feed']).pages[0].posts[0].author.displayName).toBe('New');
  });

  it('leaves other users untouched', () => {
    qc.setQueryData(['x'], [{ id: USER, avatar: 'old.png' }, { id: 'u2', avatar: 'theirs.png' }]);
    propagateUserMedia(qc, { userId: USER, avatar: 'new.png' });
    expect(qc.getQueryData(['x'])[1].avatar).toBe('theirs.png');
  });

  it('does not rewrite an unrelated object that merely shares the id', () => {
    // A post whose id happens to equal a user id carries no image field, so the
    // field check keeps it out of scope.
    qc.setQueryData(['x'], { id: USER, text: 'a post', title: 'not a user' });
    propagateUserMedia(qc, { userId: USER, avatar: 'new.png' });
    expect(qc.getQueryData(['x'])).toEqual({ id: USER, text: 'a post', title: 'not a user' });
  });

  it('does nothing when no field was actually supplied', () => {
    qc.setQueryData(['x'], { id: USER, avatar: 'old.png' });
    expect(propagateUserMedia(qc, { userId: USER })).toBe(0);
    expect(qc.getQueryData(['x']).avatar).toBe('old.png');
  });

  it('survives a cyclic payload', () => {
    const node = { id: USER, avatar: 'old.png' };
    node.self = node;
    qc.setQueryData(['x'], node);
    expect(() => propagateUserMedia(qc, { userId: USER, avatar: 'new.png' })).not.toThrow();
    expect(qc.getQueryData(['x']).avatar).toBe('new.png');
  });
});
