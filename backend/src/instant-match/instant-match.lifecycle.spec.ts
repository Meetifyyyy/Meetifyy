import { Prisma, type MatchSession } from '@prisma/client';
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
import type { PresenceService } from '../presence/presence.service';
import type { MediaCleanupService } from '../uploads/media-cleanup.service';
import { createVerificationAccessMock } from '../common/verification/testing/verification-access.mock';

/**
 * The match lifecycle fixes of the E-7 inspection
 * (docs/private/backend-optimization/E7_INSTANT_MATCH_INSPECTION.md), each
 * driven through the real service on the in-memory database.
 */
describe('Instant Match lifecycle (E-7a)', () => {
  let prisma: PrismaFake;
  let service: InstantMatchService;
  let emitter: ReturnType<typeof createEmitterMock>;
  let online: Set<string>;
  let messages: {
    createInstantMatchConversation: jest.Mock;
    registerInstantMatchGuard: jest.Mock;
  };
  let media: {
    recordPendingDeletions: jest.Mock<Promise<string[]>, [string[], unknown]>;
    drainSoon: jest.Mock<void, [string[]]>;
  };
  let order: string[];

  const MIN = 60_000;
  const snap = (activity = 'study') => ({
    campus: 'campus-a',
    activity,
    timePreference: 'now',
    optionalDetail: null,
    area: null,
    gps: { latitude: 12.97, longitude: 77.59 },
  });

  const build = (ineligible: string[] = []) => {
    messages = {
      createInstantMatchConversation: jest.fn(() =>
        Promise.resolve({
          id: 'pub-conv-new',
          internalId: 'conv-new',
          expiresAt: Date.now() + 24 * 60 * MIN,
        }),
      ),
      registerInstantMatchGuard: jest.fn(),
    };
    order = [];
    media = {
      recordPendingDeletions: jest.fn((keys: string[], _tx: unknown) => {
        order.push('record');
        return Promise.resolve(keys);
      }),
      drainSoon: jest.fn((_keys: string[]) => {
        order.push('drain');
      }),
    };
    service = new InstantMatchService(
      prisma.asService(),
      stub<MessagesService>(messages),
      blocksStubFor(prisma),
      createVerificationAccessMock(ineligible),
      undefined,
      stub<PresenceService>({
        getPresence: (userId: string) =>
          Promise.resolve(
            online.has(userId)
              ? { status: 'online' as const, lastSeen: '', socketIds: ['s'] }
              : null,
          ),
      }),
      stub<MediaCleanupService>(media),
    );
    service.rankingOptions = { deterministic: true };
  };

  beforeEach(() => {
    prisma = new PrismaFake();
    for (const id of ['alice', 'bob', 'carol', 'dave'])
      prisma.seedUser(id, { interests: ['music'] });
    emitter = createEmitterMock();
    setRealtimeGatewayRef(emitter);
    online = new Set(['alice', 'bob', 'carol', 'dave']);
    build();
  });

  const pending = (over: Partial<MatchSession> = {}) =>
    prisma.seedSession({
      userAId: 'alice',
      userBId: 'bob',
      snapshotA: snap() as Prisma.JsonObject,
      snapshotB: snap() as Prisma.JsonObject,
      ...over,
    });
  const queued = (userId: string) =>
    prisma.queue.find((e) => e.userId === userId);
  const declinedTo = (userId: string) =>
    emitter.emitMatchDeclined.mock.calls
      .filter(([uid]) => uid === userId)
      .map(([, payload]) => payload);

  describe('IM-1: a timed-out match re-queues only people who are here', () => {
    it('puts back the one still online, and tells the absent one it timed out', async () => {
      online = new Set(['alice']);
      pending({ expiresAt: new Date(Date.now() - 1000) });

      await service.expireStale();

      expect(queued('alice')).toBeDefined();
      expect(queued('bob')).toBeUndefined();
      expect(declinedTo('bob')).toEqual([
        { reason: 'No match this time', requeued: false },
      ]);
      expect(declinedTo('alice')[0]).toMatchObject({ requeued: true });
    });

    it('puts back someone who accepted, even if they have gone quiet', async () => {
      online = new Set();
      pending({ expiresAt: new Date(Date.now() - 1000), bAccepted: true });

      await service.expireStale();

      expect(queued('bob')).toBeDefined();
      expect(queued('alice')).toBeUndefined();
    });

    it('does not re-queue an absent person the other side passed on', async () => {
      online = new Set(['alice']);
      const s = pending();
      await service.respondToMatch('alice', s.id, 'decline');
      expect(queued('bob')).toBeUndefined();
      expect(declinedTo('bob')[0]).toMatchObject({ requeued: false });
    });
  });

  describe('IM-2: nobody holds two matches', () => {
    it('a pairing refuses someone who already holds a match, and clears their leftover row', async () => {
      pending(); // alice <> bob, unanswered
      const old = new Date(Date.now() - 10 * MIN);
      prisma.seedQueueEntry('alice', { joinedAt: old }); // a leftover row
      prisma.seedQueueEntry('carol', { joinedAt: old });

      await service.tryMatch('carol');

      expect(prisma.sessions).toHaveLength(1);
      expect(queued('alice')).toBeUndefined();
      expect(queued('carol')).toBeDefined();
    });

    it('a join that a pairing overtakes does not stay in the queue', async () => {
      prisma.afterQueueWrite = (userId) => {
        if (userId !== 'alice') return;
        prisma.afterQueueWrite = undefined;
        // A pairing commits between the join's checks and its write.
        pending({ userAId: 'alice', userBId: 'dave' });
      };

      await expect(
        service.joinQueue({ userId: 'alice', ...snap() }),
      ).rejects.toThrow('Respond to your current match first');
      expect(queued('alice')).toBeUndefined();
    });

    it('an accept refuses while one of them has a chat still being opened, and tells both', async () => {
      // alice <> carol accepted; its conversation is not linked yet.
      prisma.seedSession({
        userAId: 'alice',
        userBId: 'carol',
        status: 'ACCEPTED',
        aAccepted: true,
        bAccepted: true,
      });
      const s = pending({ aAccepted: true });

      await service.respondToMatch('bob', s.id, 'accept');

      expect(messages.createInstantMatchConversation).not.toHaveBeenCalled();
      expect(prisma.sessions.find((x) => x.id === s.id)?.status).toBe(
        'EXPIRED',
      );
      expect(declinedTo('alice')[0]?.reason).toMatch(/^No match this time/);
      expect(declinedTo('bob')[0]?.reason).toMatch(/^No match this time/);
      // Both people's locks were held while it was decided.
      expect(prisma.advisoryLocks).toEqual([
        'instant-match:live:alice',
        'instant-match:live:bob',
      ]);
    });
  });

  describe('IM-3 / IM-7: a refused accept tells both people', () => {
    it('someone who became ineligible: withdrawn, both told, the other searches again', async () => {
      build(['bob']);
      const s = pending({ bAccepted: true });

      await service.respondToMatch('alice', s.id, 'accept');

      expect(prisma.sessions[0].status).toBe('EXPIRED');
      expect(declinedTo('alice')[0]).toMatchObject({ requeued: true });
      expect(declinedTo('bob')[0]).toMatchObject({ requeued: false });
      expect(queued('alice')).toBeDefined();
      expect(queued('bob')).toBeUndefined();
    });

    it('a block placed while the match was pending stops it', async () => {
      const s = pending({ bAccepted: true });
      prisma.addBlock('bob', 'alice');

      await service.respondToMatch('alice', s.id, 'accept');

      expect(messages.createInstantMatchConversation).not.toHaveBeenCalled();
      expect(prisma.sessions[0].status).toBe('EXPIRED');
      expect(declinedTo('alice')).toHaveLength(1);
      expect(declinedTo('bob')).toHaveLength(1);
    });

    it('one failing expiry does not strand the rest of the sweep', async () => {
      const first = pending({ expiresAt: new Date(Date.now() - 1000) });
      const second = pending({
        userAId: 'carol',
        userBId: 'dave',
        expiresAt: new Date(Date.now() - 1000),
      });
      emitter.emitMatchDeclined.mockImplementationOnce(() => {
        throw new Error('socket down');
      });

      await service.expireStale();

      // Both expired (the people re-queued from them may be paired anew).
      const status = (id: string) =>
        prisma.sessions.find((x) => x.id === id)?.status;
      expect([status(first.id), status(second.id)]).toEqual([
        'EXPIRED',
        'EXPIRED',
      ]);
      expect(declinedTo('bob')).toHaveLength(1);
      expect(declinedTo('carol')).toHaveLength(1);
      expect(declinedTo('dave')).toHaveLength(1);
    });
  });

  it('IM-4: a chat that could not be linked goes back to pending, its conversation closed', async () => {
    prisma.seedConversation('conv-new', { status: 'ACTIVE' });
    prisma.failNext.sessionUpdate = new Error('connection reset');
    const s = pending({ aAccepted: true });

    await expect(service.respondToMatch('bob', s.id, 'accept')).rejects.toThrow(
      'Could not open your chat — try again',
    );

    expect(prisma.sessions[0].status).toBe('PENDING');
    expect(prisma.conversations[0]).toMatchObject({ status: 'ENDED' });
    expect(emitter.emitMatchAccepted).not.toHaveBeenCalled();
  });

  it('IM-5: a late re-queue keeps the newer search', async () => {
    pending({ expiresAt: new Date(Date.now() - 1000) }); // snapshot: study
    prisma.seedQueueEntry('alice', { activity: 'gym' }); // searched again

    await service.expireStale();

    expect(queued('alice')?.activity).toBe('gym');
    expect(declinedTo('alice')[0]).toMatchObject({ requeued: true });
  });

  it('IM-6: "leave" does nothing to a match that is not a chat', async () => {
    const s = pending();

    const result = await service.leaveChatSession('alice', s.id);

    expect(result.ended).toBe(false);
    expect(prisma.sessions[0]).toMatchObject({
      status: 'PENDING',
      chatStatus: 'ACTIVE',
      endedById: null,
    });
    expect(emitter.emitInstantMatchChatEnded).not.toHaveBeenCalled();
  });

  describe('IM-8 / IM-9: ending a chat', () => {
    const chat = () =>
      prisma.seedSession({
        id: 'm1',
        userAId: 'alice',
        userBId: 'bob',
        status: 'ACCEPTED',
        aAccepted: true,
        bAccepted: true,
        conversationId: 'conv-1',
        chatExpiresAt: new Date(Date.now() + 60 * MIN),
      });

    beforeEach(() => {
      prisma.seedConversation('conv-1', { status: 'ACTIVE' });
      prisma.messages.push(
        {
          id: 'x1',
          conversationId: 'conv-1',
          senderId: 'alice',
          attachmentMediaId: 'md1',
        },
        {
          id: 'x2',
          conversationId: 'conv-1',
          senderId: 'bob',
          attachmentMediaId: null,
        },
      );
      prisma.mediaRows.push({ id: 'md1', objectKey: 'chat/photo.jpg' });
    });

    it('records the chat’s photos and videos inside the teardown, and deletes them after it commits', async () => {
      chat();

      await service.leaveChatSession('alice', 'm1');

      expect(media.recordPendingDeletions).toHaveBeenCalledWith(
        ['chat/photo.jpg'],
        prisma,
      );
      expect(media.drainSoon).toHaveBeenCalledWith(['chat/photo.jpg']);
      expect(order).toEqual(['record', 'drain']);
      expect(prisma.messages).toHaveLength(0);
    });

    it('a teardown that fails undoes the claim, so it can be tried again', async () => {
      chat();
      prisma.failNext.messageDelete = new Error('connection reset');

      await expect(service.leaveChatSession('alice', 'm1')).rejects.toThrow(
        'connection reset',
      );

      expect(prisma.sessions[0]).toMatchObject({
        chatStatus: 'ACTIVE',
        endedById: null,
      });
      expect(prisma.messages).toHaveLength(2);
      expect(media.drainSoon).not.toHaveBeenCalled();
      expect(emitter.emitInstantMatchChatEnded).not.toHaveBeenCalled();
    });

    it('an expiry whose teardown fails is left for the next sweep', async () => {
      chat();
      prisma.sessions[0].chatExpiresAt = new Date(Date.now() - 1000);
      prisma.failNext.messageDelete = new Error('connection reset');

      await expect(service.expireStaleChats()).resolves.toBe(0);
      expect(prisma.sessions[0].chatStatus).toBe('ACTIVE');

      await expect(service.expireStaleChats()).resolves.toBe(1);
      expect(prisma.sessions[0].chatStatus).toBe('EXPIRED');
    });
  });

  describe('IM-9: the stored queue requests (with GPS) go once a match is answered', () => {
    it('accepted', async () => {
      const s = pending({ aAccepted: true });
      await service.respondToMatch('bob', s.id, 'accept');
      expect(prisma.sessions[0]).toMatchObject({
        status: 'ACCEPTED',
        snapshotA: Prisma.DbNull,
        snapshotB: Prisma.DbNull,
      });
    });

    it('declined', async () => {
      const s = pending();
      await service.respondToMatch('alice', s.id, 'decline');
      expect(prisma.sessions[0]).toMatchObject({
        snapshotA: Prisma.DbNull,
        snapshotB: Prisma.DbNull,
      });
    });

    it('expired, keeping only the direct-request marker', async () => {
      pending({
        expiresAt: new Date(Date.now() - 1000),
        snapshotA: { ...snap(), requested: true } as Prisma.JsonObject,
      });
      await service.expireStale();
      expect(prisma.sessions[0]).toMatchObject({
        status: 'EXPIRED',
        snapshotA: { requested: true },
        snapshotB: Prisma.DbNull,
      });
    });
  });
});
