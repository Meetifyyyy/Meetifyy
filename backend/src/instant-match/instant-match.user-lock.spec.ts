import { expect } from '@jest/globals';
import { ForbiddenException } from '@nestjs/common';
import {
  InstantMatchService,
  setRealtimeGatewayRef,
} from './instant-match.service';
import {
  PrismaFake,
  blocksStubFor,
  createEmitterMock,
} from './testing/prisma-fake';
import { stub } from '../common/testing/stub';
import type { MessagesService } from '../messages/messages.service';
import type { RedisService } from '../redis/redis.service';
import type { JoinQueueDto } from './dto/join-queue.dto';
import { createVerificationAccessMock } from '../common/verification/testing/verification-access.mock';

/**
 * Per-user serialisation of queue changes, and the idle answer for an
 * ineligible caller. A requeue that was waiting behind a join/cancel must not
 * put someone back in the queue after the world has moved on.
 */
describe('InstantMatchService — per-user lock and ineligible state', () => {
  let prisma: PrismaFake;
  let verificationAccess: ReturnType<typeof createVerificationAccessMock>;
  let lockKeys: string[];
  let service: InstantMatchService;

  const dto = (userId: string): JoinQueueDto => ({
    userId,
    campus: 'campus-a',
    activity: 'study',
    timePreference: 'now',
    optionalDetail: null,
    area: null,
    gps: null,
  });
  const snapshot = {
    campus: 'campus-a',
    activity: 'study',
    timePreference: 'now',
    optionalDetail: null,
    area: null,
    gps: null,
  };

  /** A withLock that really serialises per key, like the real one. */
  const tails = new Map<string, Promise<unknown>>();
  const withLock = <T>(key: string, _ttl: number, fn: () => Promise<T>) => {
    lockKeys.push(key);
    const prev = tails.get(key) ?? Promise.resolve();
    const run = prev.then(fn, fn);
    tails.set(
      key,
      run.catch(() => undefined),
    );
    return run;
  };

  beforeEach(() => {
    tails.clear();
    lockKeys = [];
    prisma = new PrismaFake();
    ['alice', 'bob'].forEach((id) => prisma.seedUser(id));
    verificationAccess = createVerificationAccessMock();
    setRealtimeGatewayRef(createEmitterMock());
    service = new InstantMatchService(
      prisma.asService(),
      stub<MessagesService>({
        createInstantMatchConversation: jest.fn(),
        registerInstantMatchGuard: jest.fn(),
      }),
      blocksStubFor(prisma),
      verificationAccess,
      stub<RedisService>({ withLock: jest.fn(withLock) }),
    );
    service.rankingOptions = { deterministic: true };
  });

  afterEach(() => setRealtimeGatewayRef(null));

  it('serialises join and cancel on instant-match:user:<id>', async () => {
    await service.joinQueue(dto('alice'));
    await service.cancelQueue('alice');
    expect(new Set(lockKeys)).toEqual(new Set(['instant-match:user:alice']));
    expect(lockKeys.length).toBeGreaterThanOrEqual(2);
  });

  it('a requeue that runs after the user was matched elsewhere does not re-queue them', async () => {
    // Alice already holds a live (accepted) chat when the stale requeue lands.
    prisma.seedSession({
      userAId: 'alice',
      userBId: 'bob',
      status: 'ACCEPTED',
      conversationId: 'conv-1',
      chatStatus: 'ACTIVE',
      chatExpiresAt: new Date(Date.now() + 3_600_000),
    });
    const requeued = await service['requeue']('alice', snapshot);
    expect(requeued).toBe(false);
    expect(prisma.queue).toHaveLength(0);
  });

  it('a requeue for a user who became ineligible does not re-queue them', async () => {
    verificationAccess.isUserEligible.mockResolvedValue(false);
    expect(await service['requeue']('alice', snapshot)).toBe(false);
    expect(prisma.queue).toHaveLength(0);
  });

  it('a requeue queued behind a cancel on the same user runs after it', async () => {
    await service.joinQueue(dto('alice'));
    const order: string[] = [];
    const cancel = service
      .cancelQueue('alice')
      .then(() => order.push('cancel'));
    const requeue = service['requeue']('alice', snapshot).then(() =>
      order.push('requeue'),
    );
    await Promise.all([cancel, requeue]);
    expect(order).toEqual(['cancel', 'requeue']);
  });

  describe('ineligible callers get the idle state, not an error', () => {
    it('getStateFor', async () => {
      await service.joinQueue(dto('alice'));
      verificationAccess.isUserEligible.mockResolvedValue(false);
      await expect(service.getStateFor('alice')).resolves.toEqual({
        queued: null,
        pendingMatch: null,
        recentMatch: null,
        stats: null,
      });
    });

    it('getChatStateFor returns null even with a live chat', async () => {
      prisma.seedSession({
        userAId: 'alice',
        userBId: 'bob',
        status: 'ACCEPTED',
        conversationId: 'conv-1',
        chatExpiresAt: new Date(Date.now() + 3_600_000),
      });
      expect(await service.getChatStateFor('alice')).not.toBeNull();
      verificationAccess.isUserEligible.mockResolvedValue(false);
      expect(await service.getChatStateFor('alice')).toBeNull();
    });

    it('a user who is not a participant of the chat gets the same null as for no chat', async () => {
      prisma.seedUser('mallory');
      prisma.seedSession({
        userAId: 'alice',
        userBId: 'bob',
        status: 'ACCEPTED',
        conversationId: 'conv-1',
        chatExpiresAt: new Date(Date.now() + 3_600_000),
      });
      expect(await service.getChatStateFor('mallory')).toBeNull();
    });

    it('getSearchingNow still refuses an ineligible viewer', async () => {
      verificationAccess.isUserEligible.mockResolvedValue(false);
      await expect(service.getSearchingNow('alice')).rejects.toThrow(
        ForbiddenException,
      );
    });
  });
});
