import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PostsService } from './posts.service';
import { sortPollOptions } from './post-view';
import { stub } from '../common/testing/stub';
import type { PrismaService } from '../prisma/prisma.service';
import type { NotificationsService } from '../notifications/notifications.service';
import type { NotificationFactory } from '../notifications/notification.factory';
import type { BlocksService } from '../users/blocks.service';
import type { DomainEventService } from '../events/domain-event.service';
import type { RedisService } from '../redis/redis.service';
import type { MentionsService } from '../mentions/mentions.service';
import type { StorageService } from '../uploads/uploads.service';
import type { ContentDeletionAuthorizer } from './content-deletion.authorizer';

/**
 * Polls keep the author's order, and a vote is safe to repeat:
 * - options are read by `position` (ids are random, and sorting by them
 *   showed every poll in an order nobody chose);
 * - an index a client sends names the option it showed at that place;
 * - voting again (a double tap, another device, a retry) answers with the
 *   vote that stands instead of an error, and a vote that races past the lock
 *   onto the unique constraint does the same instead of a 500;
 * - the live update every viewer of the post receives carries the counts
 *   only, never the voter or their choice.
 */
// Stored in an order unlike the author's (ids sort c, a, b; positions a, b, c).
const OPTIONS = [
  { id: 'c-opt', text: 'Third', voteCount: 0, position: 2 },
  { id: 'a-opt', text: 'First', voteCount: 3, position: 0 },
  { id: 'b-opt', text: 'Second', voteCount: 1, position: 1 },
];

function makeService(
  over: { existingVote?: { optionId: string } | null } = {},
) {
  const emit = jest.fn(() => Promise.resolve());
  const votes = { standing: over.existingVote ?? null };
  const prisma = {
    post: {
      findUnique: jest.fn(() =>
        Promise.resolve({
          id: 'p1',
          text: 'Which one?',
          authorId: 'author',
          deletedAt: null,
          communityId: null,
          pollOptions: OPTIONS.map((o) => ({
            ...o,
            _count: { votes: o.voteCount },
          })),
        }),
      ),
    },
    pollVote: {
      findUnique: jest.fn(() => Promise.resolve(votes.standing)),
      create: jest.fn(),
    },
    pollOption: {
      update: jest.fn(),
      findMany: jest.fn(() => Promise.resolve(sortPollOptions(OPTIONS))),
    },
    $transaction: jest.fn(() => Promise.resolve([])),
  };
  const service = new PostsService(
    stub<PrismaService>(prisma),
    stub<NotificationsService>(),
    stub<NotificationFactory>(),
    stub<BlocksService>({ getExcludedUserIds: () => Promise.resolve([]) }),
    stub<DomainEventService>({ emit }),
    stub<RedisService>({
      withLock: <T>(_key: string, _ttl: number, fn: () => Promise<T>) => fn(),
    }),
    stub<MentionsService>(),
    stub<StorageService>(),
    stub<ContentDeletionAuthorizer>(),
  );
  return { service, prisma, emit, votes };
}

describe('poll options keep the order their author gave them', () => {
  it('sorts by position, then by id for options sharing one', () => {
    expect(sortPollOptions(OPTIONS).map((o) => o.text)).toEqual([
      'First',
      'Second',
      'Third',
    ]);
    // Rows from before the column existed all have 0: still a stable order.
    expect(
      sortPollOptions([
        { id: 'b', position: 0 },
        { id: 'a', position: 0 },
      ]).map((o) => o.id),
    ).toEqual(['a', 'b']);
  });
});

describe('voting in a poll', () => {
  it('an index names the option shown at that place, and the poll comes back in order', async () => {
    const { service, prisma } = makeService();
    const res = await service.voteInPoll('p1', 'me', { indices: [1] });

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.pollOption.update).toHaveBeenCalledWith({
      where: { id: 'b-opt' },
      data: { voteCount: { increment: 1 } },
    });
    expect(res.changed).toBe(true);
    expect(res.poll.options.map((o) => o.text)).toEqual([
      'First',
      'Second',
      'Third',
    ]);
    expect(res.poll.userVotedOptionId).toBe('b-opt');
    expect(res.poll.votedOptionIndex).toBe(1);
  });

  it('an option id is used as given', async () => {
    const { service, prisma } = makeService();
    await service.voteInPoll('p1', 'me', { optionId: 'c-opt' });
    expect(prisma.pollOption.update).toHaveBeenCalledWith({
      where: { id: 'c-opt' },
      data: { voteCount: { increment: 1 } },
    });
  });

  it('refuses an option that is not in this poll', async () => {
    const { service } = makeService();
    await expect(
      service.voteInPoll('p1', 'me', { optionId: 'elsewhere' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.voteInPoll('p1', 'me', { indices: [7] }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('voting again answers with the vote that stands, writes nothing and tells no one', async () => {
    const { service, prisma, emit } = makeService({
      existingVote: { optionId: 'a-opt' },
    });
    const res = await service.voteInPoll('p1', 'me', { optionId: 'c-opt' });

    expect(res.changed).toBe(false);
    expect(res.poll.userVotedOptionId).toBe('a-opt');
    expect(res.poll.myVotes).toEqual([0]);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(emit).not.toHaveBeenCalled();
  });

  it('a vote that races onto the unique constraint gets the standing vote, not a 500', async () => {
    const { service, prisma, votes } = makeService();
    prisma.$transaction.mockImplementationOnce(() => {
      votes.standing = { optionId: 'a-opt' };
      return Promise.reject(
        new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
          code: 'P2002',
          clientVersion: 'test',
        }),
      );
    });
    const res = await service.voteInPoll('p1', 'me', { optionId: 'b-opt' });
    expect(res).toMatchObject({ changed: false });
    expect(res.poll.userVotedOptionId).toBe('a-opt');
  });

  it('the live update carries the counts and nothing about the voter or their choice', async () => {
    const { service, emit } = makeService();
    await service.voteInPoll('p1', 'me', { optionId: 'b-opt' });

    expect(emit).toHaveBeenCalledTimes(1);
    const [type, data, targets] = emit.mock.calls[0] as unknown as [
      string,
      Record<string, unknown>,
      string[],
    ];
    expect(type).toBe('post.pollVoted');
    expect(targets).toEqual(['me']);
    expect(Object.keys(data).sort()).toEqual(['poll', 'postId']);
    expect(Object.keys(data.poll as object).sort()).toEqual([
      'options',
      'totalVotes',
    ]);
    expect(JSON.stringify(data)).not.toContain('"me"');
  });
});
