import { ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { MessagesService } from './messages.service';
import { MessagesController } from './messages.controller';
import { DmService } from './dm/dm.service';
import { GroupChatsController } from './group-chats/group-chats.controller';
import { dmCreateLockKey } from './core/dm-lock';
import { LruCache } from '../common/utils/lru-cache.util';
import { PrismaService } from '../prisma/prisma.service';
import { PresenceService } from '../presence/presence.service';
import { DomainEventService } from '../events/domain-event.service';
import { MentionsService } from '../mentions/mentions.service';
import { RedisService } from '../redis/redis.service';
import { BlocksService } from '../users/blocks.service';
import { verificationAccessMockProvider } from '../common/verification/testing/verification-access.mock';
import { allowAllRateLimitProvider } from '../common/rate-limit/testing/rate-limit.mock';

type ErrorWithResponse = { getResponse?: () => { code?: string } };

/** Fixtures shared by the MessagesService and DmService suites below. */
const baseProviders = (prisma: object, withLock: jest.Mock) => [
  allowAllRateLimitProvider(),
  verificationAccessMockProvider(),
  { provide: PrismaService, useValue: prisma },
  { provide: PresenceService, useValue: { getPresence: jest.fn() } },
  { provide: DomainEventService, useValue: { emit: jest.fn() } },
  {
    provide: MentionsService,
    useValue: { sanitize: jest.fn().mockResolvedValue([]) },
  },
  {
    provide: RedisService,
    useValue: {
      getClient: jest.fn().mockReturnValue(null),
      getSubClient: jest.fn().mockReturnValue(null),
      withLock,
    },
  },
  {
    provide: BlocksService,
    useValue: {
      isBlocked: jest.fn().mockResolvedValue(false),
      filterBlockedUsers: jest.fn((_u: string, ids: string[]) =>
        Promise.resolve(ids),
      ),
      getExcludedUserIds: jest.fn().mockResolvedValue([]),
      getBlockedByUserIds: jest.fn().mockResolvedValue([]),
    },
  },
];

describe('MessagesService — hardening', () => {
  const ME = 'user-b';
  const THEM = 'user-a';
  let service: MessagesService;
  let withLock: jest.Mock;
  let lockedKeys: string[];
  let participants: {
    userId: string;
    isMuted: boolean;
    user: { accountStatus: string; deletedAt: Date | null };
  }[];
  let prisma: {
    conversation: { findUnique: jest.Mock; findFirst: jest.Mock };
    message: { create: jest.Mock; findFirst: jest.Mock };
  };

  const live = { accountStatus: 'ACTIVE', deletedAt: null };

  beforeEach(async () => {
    lockedKeys = [];
    withLock = jest.fn(
      (key: string, _ttl: number, fn: () => Promise<unknown>) => {
        lockedKeys.push(key);
        return fn();
      },
    );
    participants = [
      { userId: ME, isMuted: false, user: live },
      { userId: THEM, isMuted: false, user: live },
    ];
    prisma = {
      conversation: {
        findUnique: jest.fn(() =>
          Promise.resolve({
            id: 'conv-1',
            publicId: 'conv-1',
            name: null,
            type: 'DM',
            isInstantMatch: false,
            participants,
          }),
        ),
        // The pair already has a DM, so startConversation returns early.
        findFirst: jest.fn(() =>
          Promise.resolve({ id: 'dm-1', publicId: 'dm-pub' }),
        ),
      },
      message: { create: jest.fn(), findFirst: jest.fn() },
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [MessagesService, ...baseProviders(prisma, withLock)],
    }).compile();
    service = module.get(MessagesService);
    jest.spyOn(service, 'resolveConversationId').mockResolvedValue('conv-1');
  });

  describe('sendMessage — unavailable recipient', () => {
    it.each(['PENDING_DELETION', 'DELETED'])(
      'refuses a direct message to a partner who is %s',
      async (accountStatus) => {
        participants[1] = {
          ...participants[1],
          user: { accountStatus, deletedAt: new Date() },
        };
        try {
          await service.sendMessage(ME, 'conv-1', { text: 'hello?' });
          throw new Error('should have been refused');
        } catch (err: unknown) {
          expect(err).toBeInstanceOf(ForbiddenException);
          expect((err as ErrorWithResponse).getResponse?.()).toMatchObject({
            code: 'RECIPIENT_UNAVAILABLE',
          });
        }
        expect(prisma.message.create).not.toHaveBeenCalled();
      },
    );
  });

  describe('startConversation — pair lock', () => {
    it('serialises a 1:1 start on a key built from the sorted pair', async () => {
      await service.startConversation([THEM], ME);
      await service.startConversation(['user-b'], 'user-a');
      expect(lockedKeys).toEqual([
        'dm:create:user-a:user-b',
        'dm:create:user-a:user-b',
      ]);
    });

    it('does not take the pair lock for a named group', async () => {
      prisma.conversation.findFirst.mockResolvedValue(null);
      await service
        .startConversation([THEM, 'user-c'], ME, 'Study group')
        .catch(() => undefined);
      expect(lockedKeys).toEqual([]);
    });
  });

  describe('in-process caches are bounded', () => {
    it('uses LRU caches rather than unbounded maps', () => {
      expect(service['resolveCache']).toBeInstanceOf(LruCache);
      expect(service['presenceCache']).toBeInstanceOf(LruCache);
    });

    it('evicts the oldest resolve entry once the cache is full', () => {
      const cache = service['resolveCache'];
      for (let i = 0; i < 6000; i++) cache.set(`k${i}`, `v${i}`);
      expect(cache.get('k0')).toBeUndefined();
      expect(cache.get('k5999')).toBe('v5999');
    });
  });
});

describe('dmCreateLockKey', () => {
  it('is the same for either order of the pair', () => {
    expect(dmCreateLockKey('b', 'a')).toBe('dm:create:a:b');
    expect(dmCreateLockKey('a', 'b')).toBe('dm:create:a:b');
  });
});

describe('DmService.startDM — pair lock', () => {
  it('runs the find-then-create under the sorted-pair lock', async () => {
    const lockedKeys: string[] = [];
    const withLock = jest.fn(
      (key: string, _ttl: number, fn: () => Promise<unknown>) => {
        lockedKeys.push(key);
        return fn();
      },
    );
    const tx = {
      conversation: {
        findFirst: jest.fn(() =>
          Promise.resolve({ id: 'dm-1', publicId: 'dm-pub' }),
        ),
      },
      conversationParticipant: {
        updateMany: jest.fn(() => Promise.resolve({ count: 1 })),
      },
    };
    const prisma = {
      $transaction: jest.fn((cb: (t: typeof tx) => Promise<unknown>) => cb(tx)),
    };
    const module = await Test.createTestingModule({
      providers: [DmService, ...baseProviders(prisma, withLock)],
    }).compile();
    const dm = module.get(DmService);

    await expect(dm.startDM('user-z', 'user-m')).resolves.toEqual({
      id: 'dm-pub',
      publicId: 'dm-pub',
    });
    expect(lockedKeys).toEqual(['dm:create:user-m:user-z']);
    // The transaction ran inside the lock, not before it.
    expect(withLock.mock.invocationCallOrder[0]).toBeLessThan(
      prisma.$transaction.mock.invocationCallOrder[0],
    );
  });
});

describe('endGroup — announce only after ownership is verified', () => {
  const build = <C extends object>(
    proto: C,
    service: Record<string, jest.Mock>,
    serviceKey: string,
  ) => {
    const controller = Object.create(proto) as C;
    Object.assign(controller, {
      [serviceKey]: service,
      domainEventService: { emit: jest.fn() },
    });
    return controller;
  };

  const makeService = (endGroup: jest.Mock) => ({
    getUserHandle: jest.fn(() => Promise.resolve('@alice')),
    endGroup,
    createSystemMessage: jest.fn(() => Promise.resolve({ id: 'sys-1' })),
    getConversationParticipantIds: jest.fn(() => Promise.resolve(['u1'])),
  });

  const req = { user: { id: 'u1' } };

  it('MessagesController: a non-owner gets a 403 and no "closed the group" line', async () => {
    const svc = makeService(
      jest.fn(() => Promise.reject(new ForbiddenException('Only the owner'))),
    );
    const controller = build(
      MessagesController.prototype,
      svc,
      'messagesService',
    );
    await expect(controller.endGroup(req as never, 'conv-1')).rejects.toThrow(
      ForbiddenException,
    );
    expect(svc.createSystemMessage).not.toHaveBeenCalled();
  });

  it('MessagesController: the owner closes the group, then it is announced', async () => {
    const svc = makeService(jest.fn(() => Promise.resolve({ success: true })));
    const controller = build(
      MessagesController.prototype,
      svc,
      'messagesService',
    );
    await expect(controller.endGroup(req as never, 'conv-1')).resolves.toEqual({
      success: true,
    });
    expect(svc.createSystemMessage).toHaveBeenCalledWith(
      'conv-1',
      'u1',
      '@alice closed the group',
    );
    expect(svc.endGroup.mock.invocationCallOrder[0]).toBeLessThan(
      svc.createSystemMessage.mock.invocationCallOrder[0],
    );
  });

  it('GroupChatsController: a non-owner gets a 403 and no "closed the group" line', async () => {
    const svc = makeService(
      jest.fn(() => Promise.reject(new ForbiddenException('Only the owner'))),
    );
    const controller = build(
      GroupChatsController.prototype,
      svc,
      'groupChatsService',
    );
    await expect(controller.endGroup(req as never, 'conv-1')).rejects.toThrow(
      ForbiddenException,
    );
    expect(svc.createSystemMessage).not.toHaveBeenCalled();
  });

  it('GroupChatsController: the owner closes the group, then it is announced', async () => {
    const svc = makeService(jest.fn(() => Promise.resolve({ success: true })));
    const controller = build(
      GroupChatsController.prototype,
      svc,
      'groupChatsService',
    );
    await controller.endGroup(req as never, 'conv-1');
    expect(svc.endGroup.mock.invocationCallOrder[0]).toBeLessThan(
      svc.createSystemMessage.mock.invocationCallOrder[0],
    );
  });
});
