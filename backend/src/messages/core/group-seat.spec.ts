import { BadRequestException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { stub } from '../../common/testing/stub';
import {
  assertFoundingGroupSize,
  GROUP_FULL,
  groupFullError,
  isGroupFull,
  lockGroupSeat,
} from './group-membership';
import { MAX_GROUP_MEMBERS } from './message-limits';
import { GroupChatsService } from '../group-chats/group-chats.service';
import { MessagesService } from '../messages.service';

/**
 * The group ceiling (owner decision D12): at most MAX_GROUP_MEMBERS people in
 * a group, its owner included. The real-Postgres check of every path lives in
 * group-join-requests.db.spec.ts; these pin the helpers' contract.
 */
describe('group ceiling', () => {
  const CONV = 'conv-1';
  const ids = (n: number) => Array.from({ length: n }, (_, i) => `u${i}`);

  /** A transaction client that records what lockGroupSeat asks, in order. */
  const txWith = (others: number) => {
    const calls: string[] = [];
    const queryRaw = jest.fn(
      (strings: TemplateStringsArray, ...values: unknown[]) => {
        calls.push(`lock:${strings.join('?').replace(/\s+/g, ' ').trim()}`);
        expect(values).toEqual([CONV]);
        return Promise.resolve([]);
      },
    );
    const count = jest.fn((args: Prisma.ConversationParticipantCountArgs) => {
      calls.push('count');
      expect(args).toEqual({
        where: { conversationId: CONV, leftAt: null, userId: { not: 'new' } },
      });
      return Promise.resolve(others);
    });
    const tx = stub<Prisma.TransactionClient>({
      $queryRaw: queryRaw,
      conversationParticipant: { count },
    });
    return { tx, calls };
  };

  it('locks the group row before counting, and admits up to the ceiling', async () => {
    const { tx, calls } = txWith(MAX_GROUP_MEMBERS - 1);
    await expect(lockGroupSeat(tx, CONV, 'new')).resolves.toBeUndefined();
    expect(calls).toEqual([
      'lock:SELECT "id" FROM "Conversation" WHERE "id" = ? FOR NO KEY UPDATE',
      'count',
    ]);
  });

  it('refuses the next person once the group is full', async () => {
    const { tx } = txWith(MAX_GROUP_MEMBERS);
    const refused = lockGroupSeat(tx, CONV, 'new');
    await expect(refused).rejects.toBeInstanceOf(BadRequestException);
    await expect(refused).rejects.toMatchObject({
      response: { code: GROUP_FULL },
    });
  });

  it('answers whether a group is full without a lock, by the same count', async () => {
    const count = jest.fn(() => Promise.resolve(MAX_GROUP_MEMBERS));
    const prisma = {
      conversationParticipant: stub<
        Prisma.TransactionClient['conversationParticipant']
      >({ count }),
    };
    await expect(isGroupFull(prisma, CONV, 'new')).resolves.toBe(true);
    count.mockResolvedValue(MAX_GROUP_MEMBERS - 1);
    await expect(isGroupFull(prisma, CONV, 'new')).resolves.toBe(false);
  });

  it('founds a group of up to the ceiling, counting each person once', () => {
    expect(() => assertFoundingGroupSize(ids(MAX_GROUP_MEMBERS))).not.toThrow();
    expect(() =>
      assertFoundingGroupSize([...ids(MAX_GROUP_MEMBERS), 'u0', 'u1']),
    ).not.toThrow();
    expect(() => assertFoundingGroupSize(ids(MAX_GROUP_MEMBERS + 1))).toThrow(
      BadRequestException,
    );
  });

  it('explains itself to builds that do not know the code', () => {
    expect(groupFullError().getResponse()).toEqual({
      code: GROUP_FULL,
      message: `This group is full. A group can have up to ${MAX_GROUP_MEMBERS} members.`,
    });
  });

  describe('creating a group past the ceiling', () => {
    const others = ids(MAX_GROUP_MEMBERS); // plus the creator: one too many

    it('POST /api/group-chats refuses before spending the rate limit', async () => {
      const consume = jest.fn();
      const create = jest.fn();
      const service = Object.create(
        GroupChatsService.prototype,
      ) as GroupChatsService;
      Object.assign(service, {
        rateLimit: { consume, consumeAll: consume },
        prisma: { conversation: { create } },
      });
      await expect(
        service.createGroup(others, 'creator', 'Trip'),
      ).rejects.toMatchObject({ response: { code: GROUP_FULL } });
      expect(consume).not.toHaveBeenCalled();
      expect(create).not.toHaveBeenCalled();
    });

    it('POST /api/messages refuses before any lookup', async () => {
      const filterBlockedUsers = jest.fn();
      const create = jest.fn();
      const service = Object.create(
        MessagesService.prototype,
      ) as MessagesService;
      Object.assign(service, {
        blocksService: { filterBlockedUsers },
        prisma: { conversation: { create } },
      });
      await expect(
        service.startConversation(others, 'creator', 'Trip'),
      ).rejects.toMatchObject({ response: { code: GROUP_FULL } });
      expect(filterBlockedUsers).not.toHaveBeenCalled();
      expect(create).not.toHaveBeenCalled();
    });
  });
});
