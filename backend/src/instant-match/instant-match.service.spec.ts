import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import {
  InstantMatchService,
  setRealtimeGatewayRef,
} from './instant-match.service';
import { PrismaFake } from './testing/prisma-fake';
import { createVerificationAccessMock } from '../common/verification/testing/verification-access.mock';

/**
 * Instant Match is a two-party state machine driven entirely by socket events,
 * so its failure modes are concurrency ones: two people matched twice, one
 * conversation created twice, a timed-out match still acceptable, a declined
 * partner silently dropped out of the queue. Each of those has a case here.
 */
describe('InstantMatchService', () => {
  let verificationAccess: ReturnType<typeof createVerificationAccessMock>;
  let prisma: PrismaFake;
  let messages: {
    createInstantMatchConversation: jest.Mock;
    registerInstantMatchGuard: jest.Mock;
  };
  let emitter: {
    emitMatchFound: jest.Mock;
    emitMatchAccepted: jest.Mock;
    emitMatchDeclined: jest.Mock;
    emitSearchResumed: jest.Mock;
    emitQueueStats: jest.Mock;
    emitInstantMatchChatEnded: jest.Mock;
    emitQueueChanged: jest.Mock;
  };
  let service: InstantMatchService;

  const snapshot = (overrides: Record<string, any> = {}) => ({
    campus: 'campus-a',
    activity: 'study',
    timePreference: 'now',
    optionalDetail: null,
    area: null,
    gps: null,
    ...overrides,
  });

  const joinDto = (userId: string, overrides: Record<string, any> = {}) => ({
    userId,
    ...snapshot(),
    ...overrides,
  });

  /** A fresh fake with the cast seeded. Extracted so a test that needs many
   *  independent runs — the weighted tie draw — can rebuild between them. */
  const freshPrisma = () => {
    const fake = new PrismaFake();
    fake.seedUser('alice');
    fake.seedUser('bob');
    fake.seedUser('carol');
    return fake;
  };

  const buildService = () =>
    new InstantMatchService(
      prisma as any,
      messages as any,
      blocksStubFor(prisma),
      verificationAccess as any,
    );

  beforeEach(() => {
    prisma = freshPrisma();

    messages = {
      createInstantMatchConversation: jest.fn().mockResolvedValue({
        id: 'pub-conv-1',
        internalId: 'int-conv-1',
        expiresAt: Date.now() + 24 * 60 * 60 * 1000,
      }),
      registerInstantMatchGuard: jest.fn(),
    };
    emitter = {
      emitMatchFound: jest.fn(),
      emitMatchAccepted: jest.fn(),
      emitMatchDeclined: jest.fn(),
      emitSearchResumed: jest.fn(),
      emitQueueStats: jest.fn(),
      emitInstantMatchChatEnded: jest.fn(),
      emitQueueChanged: jest.fn(),
    };
    verificationAccess = createVerificationAccessMock();
    setRealtimeGatewayRef(emitter);
    service = buildService();
  });

  afterEach(() => setRealtimeGatewayRef(null));

  // ── Joining ────────────────────────────────────────────────────────────────

  describe('joinQueue', () => {
    it('queues a lone user and leaves them searching', async () => {
      await service.joinQueue(joinDto('alice'));
      expect(prisma.queue).toHaveLength(1);
      expect(prisma.sessions).toHaveLength(0);
      expect(emitter.emitMatchFound).not.toHaveBeenCalled();
    });

    it('re-joining replaces the entry instead of stacking duplicates', async () => {
      await service.joinQueue(joinDto('alice'));
      await service.joinQueue(joinDto('alice', { activity: 'coffee' }));
      expect(prisma.queue).toHaveLength(1);
      expect(prisma.queue[0].activity).toBe('coffee');
    });

    it('refuses to re-queue a user who still has a live match to answer', async () => {
      prisma.seedSession({ userAId: 'alice', userBId: 'bob' });
      await expect(service.joinQueue(joinDto('alice'))).rejects.toThrow(
        'Respond to your current match first',
      );
      expect(prisma.queue).toHaveLength(0);
    });

    it('allows re-queueing once the old match has resolved', async () => {
      prisma.seedSession({
        userAId: 'alice',
        userBId: 'bob',
        status: 'DECLINED',
      });
      await expect(
        service.joinQueue(joinDto('alice')),
      ).resolves.toBeUndefined();
    });

    it('pushes the new queue depth to every waiter, not just the joiner', async () => {
      await service.joinQueue(joinDto('alice', { activity: 'chat' }));
      emitter.emitQueueStats.mockClear();
      await service.joinQueue(
        joinDto('bob', { activity: 'chat', campus: 'campus-b' }),
      );

      // The headline count is everyone searching, so a join anywhere changes
      // the number on every searching screen — including alice's.
      const notified = emitter.emitQueueStats.mock.calls.map((c) => c[0]);
      expect(notified).toContain('bob');
      expect(notified).toContain('alice');
    });

    it('tells each waiter how many share their own activity', async () => {
      await service.joinQueue(joinDto('alice', { activity: 'chat' }));
      await service.joinQueue(
        joinDto('carol', { activity: 'gaming', campus: 'campus-b' }),
      );
      emitter.emitQueueStats.mockClear();
      await service.joinQueue(
        joinDto('bob', { activity: 'chat', campus: 'campus-b' }),
      );

      const byUser = new Map(
        emitter.emitQueueStats.mock.calls.map((c) => [c[0], c[1]]),
      );
      // Three people searching in total; two of them for 'chat'.
      expect(byUser.get('alice')).toMatchObject({ count: 3, sameActivity: 2 });
      expect(byUser.get('carol')).toMatchObject({ count: 3, sameActivity: 1 });
    });
  });

  // ── Matching ───────────────────────────────────────────────────────────────

  describe('tryMatch', () => {
    it('pairs two compatible users and tells both, with the same match id', async () => {
      await service.joinQueue(joinDto('alice'));
      await service.joinQueue(joinDto('bob'));

      expect(prisma.sessions).toHaveLength(1);
      expect(prisma.queue).toHaveLength(0);
      expect(emitter.emitMatchFound).toHaveBeenCalledTimes(2);

      const [[aliceId, alicePayload], [bobId, bobPayload]] =
        emitter.emitMatchFound.mock.calls;
      expect([aliceId, bobId].sort()).toEqual(['alice', 'bob']);
      expect(alicePayload.matchId).toBe(bobPayload.matchId);
      // Each side is shown the *other* person.
      expect(alicePayload.candidate.id).not.toBe(alicePayload.matchId);
      expect(
        [alicePayload.candidate.id, bobPayload.candidate.id].sort(),
      ).toEqual(['alice', 'bob']);
    });

    it('sends an absolute deadline so a slow client cannot desync its countdown', async () => {
      await service.joinQueue(joinDto('alice'));
      await service.joinQueue(joinDto('bob'));
      const payload = emitter.emitMatchFound.mock.calls[0][1];
      expect(payload.expiresAt).toBeGreaterThan(Date.now());
      expect(payload.timer).toBe(30);
    });

    it('never matches across activities — the one hard requirement', async () => {
      await service.joinQueue(joinDto('alice'));
      await service.joinQueue(joinDto('carol', { activity: 'gaming' }));
      expect(prisma.sessions).toHaveLength(0);
    });

    it('holds out for a compatible partner before settling for a distant one', async () => {
      // Same activity, different campus: matchable, but not immediately —
      // the opening threshold expects better than this.
      await service.joinQueue(joinDto('alice'));
      await service.joinQueue(joinDto('bob', { campus: 'campus-b' }));
      expect(prisma.sessions).toHaveLength(0);
    });

    it('relaxes the non-critical parameters once someone has waited', async () => {
      // The same cross-campus pair, five minutes into the wait. Campus,
      // area, GPS and time preference are all preferences — none of them may
      // leave a willing user searching indefinitely.
      const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
      prisma.seedQueueEntry('bob', {
        campus: 'campus-b',
        joinedAt: fiveMinutesAgo,
      });

      await service.joinQueue(joinDto('alice'));

      expect(prisma.sessions).toHaveLength(1);
      expect(emitter.emitMatchFound).toHaveBeenCalledTimes(2);
    });

    it('matches across time preferences — "now" and "30min" are compatible', async () => {
      await service.joinQueue(joinDto('alice', { timePreference: 'now' }));
      await service.joinQueue(joinDto('bob', { timePreference: '30min' }));
      expect(prisma.sessions).toHaveLength(1);
    });

    it('does not let a missing location block an otherwise strong match', async () => {
      // Alice shared her area and GPS, Bob shared nothing. Withholding a
      // location must not read as being far away.
      await service.joinQueue(
        joinDto('alice', {
          area: 'library',
          gps: { latitude: 27.6, longitude: 77.6 },
        }),
      );
      await service.joinQueue(joinDto('bob'));
      expect(prisma.sessions).toHaveLength(1);
    });

    it('ignores an expired candidate rather than matching a ghost', async () => {
      prisma.seedQueueEntry('bob', { expiresAt: new Date(Date.now() - 1000) });
      await service.joinQueue(joinDto('alice'));
      expect(prisma.sessions).toHaveLength(0);
    });

    it('picks the higher-scoring candidate over the merely-available one', async () => {
      // Seeded directly so both candidates are waiting before alice searches.
      prisma.seedQueueEntry('carol');
      prisma.seedQueueEntry('bob', { area: 'library' });
      await service.joinQueue(joinDto('alice', { area: 'library' }));

      expect(prisma.sessions).toHaveLength(1);
      const session = prisma.sessions[0];
      expect([session.userAId, session.userBId].sort()).toEqual([
        'alice',
        'bob',
      ]);
    });

    /**
     * Ties now favour the longest wait rather than guaranteeing it.
     *
     * Two candidates a point apart are not meaningfully different — the score
     * is an estimate with a shrinkage term in it — and resolving that gap the
     * same way every time is how one person ends up being offered to
     * everybody. So the ranker draws inside the tie band, weighted by wait.
     * The deterministic ordering, which is what a human debugging a pairing
     * reads, is still strictly ordered; that is what this pins.
     */
    it('puts the longest waiter first in the deterministic ordering', async () => {
      prisma.seedQueueEntry('carol', {
        joinedAt: new Date(Date.now() - 60_000),
      });
      prisma.seedQueueEntry('bob', { joinedAt: new Date(Date.now() - 1_000) });
      prisma.seedQueueEntry('alice');

      const { order } = await service.explainRankingFor('alice');
      expect(order.map((o) => o.userId)).toEqual(['carol', 'bob']);
    });

    it('still pairs with one of the tied candidates, not with nobody', async () => {
      prisma.seedQueueEntry('carol', {
        joinedAt: new Date(Date.now() - 60_000),
      });
      prisma.seedQueueEntry('bob', { joinedAt: new Date(Date.now() - 1_000) });
      await service.joinQueue(joinDto('alice'));

      const session = prisma.sessions[0];
      expect(session).toBeDefined();
      const pair = [session.userAId, session.userBId].sort();
      expect(pair).toContain('alice');
      expect(['bob', 'carol']).toContain(pair.find((id) => id !== 'alice'));
    });

    it('favours the longest waiter across repeated draws', async () => {
      // Statistical rather than absolute, because the draw is weighted, not
      // ordered: an occasional pairing with the fresher candidate is the
      // diversification working, not a fairness bug.
      let carolWins = 0;
      for (let run = 0; run < 40; run += 1) {
        prisma = freshPrisma();
        service = buildService();
        prisma.seedQueueEntry('carol', {
          joinedAt: new Date(Date.now() - 10 * 60_000),
        });
        prisma.seedQueueEntry('bob', { joinedAt: new Date(Date.now() - 1_000) });
        await service.joinQueue(joinDto('alice'));
        const session = prisma.sessions[0];
        const other = [session.userAId, session.userBId].find(
          (id: string) => id !== 'alice',
        );
        if (other === 'carol') carolWins += 1;
      }
      expect(carolWins).toBeGreaterThan(20);
    });

    it('never matches users who have blocked each other, in either direction', async () => {
      prisma.addBlock('bob', 'alice');
      await service.joinQueue(joinDto('alice'));
      await service.joinQueue(joinDto('bob'));
      expect(prisma.sessions).toHaveLength(0);
    });

    it('does not re-serve someone the user just declined', async () => {
      prisma.seedSession({
        userAId: 'alice',
        userBId: 'bob',
        status: 'DECLINED',
      });
      await service.joinQueue(joinDto('alice'));
      await service.joinQueue(joinDto('bob'));
      expect(
        prisma.sessions.filter((s) => s.status === 'PENDING'),
      ).toHaveLength(0);
    });

    it('falls through to the next candidate when a pair claim loses its race', async () => {
      prisma.seedQueueEntry('bob');
      prisma.seedQueueEntry('carol');
      prisma.seedQueueEntry('alice');

      // The first claim attempt finds bob already taken by a concurrent match.
      let first = true;
      prisma.onTransaction = () => {
        if (!first) return;
        first = false;
        prisma.queue = prisma.queue.filter((e) => e.userId !== 'bob');
      };

      await service.tryMatch('alice');

      expect(prisma.sessions).toHaveLength(1);
      expect(
        [prisma.sessions[0].userAId, prisma.sessions[0].userBId].sort(),
      ).toEqual(['alice', 'carol']);
    });

    it('creates no session at all when every claim is lost', async () => {
      prisma.seedQueueEntry('bob');
      prisma.seedQueueEntry('alice');
      prisma.onTransaction = () => {
        prisma.queue = prisma.queue.filter((e) => e.userId !== 'bob');
      };

      await service.tryMatch('alice');
      expect(prisma.sessions).toHaveLength(0);
    });

    it('stores both sides’ requests on the session so either can be re-queued later', async () => {
      await service.joinQueue(
        joinDto('alice', { area: 'library', optionalDetail: 'Physics' }),
      );
      await service.joinQueue(joinDto('bob', { area: 'hostel' }));

      const session = prisma.sessions[0];
      expect(session.snapshotA).toMatchObject({
        activity: 'study',
        campus: 'campus-a',
      });
      expect(session.snapshotB).toMatchObject({
        activity: 'study',
        campus: 'campus-a',
      });
    });
  });

  // ── Authorization ──────────────────────────────────────────────────────────

  describe('respondToMatch authorization', () => {
    it('rejects an unknown match id', async () => {
      await expect(
        service.respondToMatch('alice', 'nope', 'accept'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('refuses a user who is not part of the match, even with a valid id', async () => {
      const session = prisma.seedSession({ userAId: 'alice', userBId: 'bob' });
      await expect(
        service.respondToMatch('carol', session.id, 'accept'),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(messages.createInstantMatchConversation).not.toHaveBeenCalled();
    });

    it('refuses a match that already resolved', async () => {
      const session = prisma.seedSession({
        userAId: 'alice',
        userBId: 'bob',
        status: 'ACCEPTED',
      });
      await expect(
        service.respondToMatch('alice', session.id, 'accept'),
      ).rejects.toThrow('Match is no longer active');
    });

    it('refuses — and expires — a match whose deadline has already passed', async () => {
      const session = prisma.seedSession({
        userAId: 'alice',
        userBId: 'bob',
        expiresAt: new Date(Date.now() - 1),
        snapshotA: snapshot(),
        snapshotB: snapshot(),
      });
      await expect(
        service.respondToMatch('alice', session.id, 'accept'),
      ).rejects.toThrow('Match is no longer active');
      expect(prisma.sessions[0].status).toBe('EXPIRED');
      expect(messages.createInstantMatchConversation).not.toHaveBeenCalled();
    });
  });

  // ── Accepting ──────────────────────────────────────────────────────────────

  describe('accept', () => {
    let sessionId: string;

    beforeEach(async () => {
      await service.joinQueue(joinDto('alice'));
      await service.joinQueue(joinDto('bob'));
      sessionId = prisma.sessions[0].id;
      emitter.emitMatchAccepted.mockClear();
    });

    it('waits for the second side before opening a conversation', async () => {
      await service.respondToMatch('alice', sessionId, 'accept');
      expect(messages.createInstantMatchConversation).not.toHaveBeenCalled();
      expect(emitter.emitMatchAccepted).not.toHaveBeenCalled();
      expect(prisma.sessions[0].status).toBe('PENDING');
    });

    it('refuses to finalize when a participant lost eligibility while pending', async () => {
      // The guard on `match:respond` vouches only for the caller. Bob's
      // verification is revoked after the pair was matched, so the second
      // accept must not hand them a chat the messaging layer would then
      // refuse every send in.
      verificationAccess.getEligibilityMap.mockResolvedValue(
        new Map([
          ['alice', true],
          ['bob', false],
        ]),
      );

      await service.respondToMatch('alice', sessionId, 'accept');
      await service.respondToMatch('bob', sessionId, 'accept');

      expect(messages.createInstantMatchConversation).not.toHaveBeenCalled();
      expect(prisma.sessions[0].status).toBe('EXPIRED');
      expect(emitter.emitMatchAccepted).not.toHaveBeenCalled();
    });

    it('opens exactly one conversation and notifies both once both accept', async () => {
      await service.respondToMatch('alice', sessionId, 'accept');
      await service.respondToMatch('bob', sessionId, 'accept');

      expect(messages.createInstantMatchConversation).toHaveBeenCalledTimes(1);
      expect(prisma.sessions[0].status).toBe('ACCEPTED');
      expect(emitter.emitMatchAccepted).toHaveBeenCalledTimes(2);
      // Each side is told who they matched with and how to reach the chat,
      // so "Open chat" works without having seen the match:found event.
      expect(emitter.emitMatchAccepted).toHaveBeenCalledWith(
        'alice',
        expect.objectContaining({
          matchId: 's3',
          chatId: 'pub-conv-1',
          internalId: 'int-conv-1',
          candidate: expect.objectContaining({ id: 'bob' }),
        }),
      );
      expect(emitter.emitMatchAccepted).toHaveBeenCalledWith(
        'bob',
        expect.objectContaining({
          matchId: 's3',
          chatId: 'pub-conv-1',
          internalId: 'int-conv-1',
          candidate: expect.objectContaining({ id: 'alice' }),
        }),
      );
    });

    it('stores the internal conversation id, not the routable public one', async () => {
      await service.respondToMatch('alice', sessionId, 'accept');
      await service.respondToMatch('bob', sessionId, 'accept');
      expect(prisma.sessions[0].conversationId).toBe('int-conv-1');
    });

    it('is idempotent — a duplicate accept does not open a second conversation', async () => {
      await service.respondToMatch('alice', sessionId, 'accept');
      await service.respondToMatch('alice', sessionId, 'accept');
      await service.respondToMatch('bob', sessionId, 'accept');
      await expect(
        service.respondToMatch('bob', sessionId, 'accept'),
      ).rejects.toThrow('Match is no longer active');

      expect(messages.createInstantMatchConversation).toHaveBeenCalledTimes(1);
      expect(emitter.emitMatchAccepted).toHaveBeenCalledTimes(2);
    });

    it('creates only one conversation when both sides accept simultaneously', async () => {
      await Promise.all([
        service.respondToMatch('alice', sessionId, 'accept'),
        service.respondToMatch('bob', sessionId, 'accept'),
      ]);
      expect(messages.createInstantMatchConversation).toHaveBeenCalledTimes(1);
      expect(emitter.emitMatchAccepted).toHaveBeenCalledTimes(2);
    });

    it('rolls the match back to PENDING when the chat service fails, instead of stranding it', async () => {
      messages.createInstantMatchConversation.mockRejectedValueOnce(
        new Error('db down'),
      );
      await service.respondToMatch('alice', sessionId, 'accept');
      await expect(
        service.respondToMatch('bob', sessionId, 'accept'),
      ).rejects.toThrow('Could not open your chat — try again');

      expect(prisma.sessions[0].status).toBe('PENDING');
      expect(emitter.emitMatchAccepted).not.toHaveBeenCalled();

      // …and a retry then succeeds.
      await service.respondToMatch('bob', sessionId, 'accept');
      expect(prisma.sessions[0].status).toBe('ACCEPTED');
      expect(emitter.emitMatchAccepted).toHaveBeenCalledTimes(2);
    });
  });

  // ── Declining ──────────────────────────────────────────────────────────────

  describe('decline', () => {
    let sessionId: string;

    beforeEach(async () => {
      await service.joinQueue(joinDto('alice'));
      await service.joinQueue(joinDto('bob'));
      sessionId = prisma.sessions[0].id;
      emitter.emitMatchDeclined.mockClear();
      emitter.emitSearchResumed.mockClear();
    });

    it('closes the match and tells both sides, with different wording each', async () => {
      await service.respondToMatch('alice', sessionId, 'decline');

      expect(prisma.sessions[0].status).toBe('DECLINED');
      expect(emitter.emitMatchDeclined).toHaveBeenCalledTimes(2);
      const byUser = Object.fromEntries(emitter.emitMatchDeclined.mock.calls);
      expect(byUser.alice.reason).toMatch(/you passed/i);
      expect(byUser.alice.requeued).toBe(false);
      expect(byUser.bob.reason).toMatch(/unavailable/i);
    });

    it('puts the declined user back in the queue server-side, without their client asking', async () => {
      await service.respondToMatch('alice', sessionId, 'decline');

      expect(prisma.queue.map((e) => e.userId)).toEqual(['bob']);
      expect(emitter.emitSearchResumed).toHaveBeenCalledWith('bob');
      expect(emitter.emitSearchResumed).not.toHaveBeenCalledWith('alice');
    });

    it('does not re-queue when there is no stored request to replay', async () => {
      const legacy = prisma.seedSession({
        userAId: 'alice',
        userBId: 'carol',
        snapshotB: null,
      });
      await service.respondToMatch('alice', legacy.id, 'decline');

      expect(prisma.queue.map((e) => e.userId)).not.toContain('carol');
      const byUser = Object.fromEntries(emitter.emitMatchDeclined.mock.calls);
      expect(byUser.carol.requeued).toBe(false);
    });

    it('notifies each side once when both decline at the same instant', async () => {
      await Promise.all([
        service.respondToMatch('alice', sessionId, 'decline').catch(() => {}),
        service.respondToMatch('bob', sessionId, 'decline').catch(() => {}),
      ]);
      expect(emitter.emitMatchDeclined).toHaveBeenCalledTimes(2);
    });

    it('does not immediately re-pair the same two people after a decline', async () => {
      await service.respondToMatch('alice', sessionId, 'decline');
      await service.joinQueue(joinDto('alice'));
      expect(
        prisma.sessions.filter((s) => s.status === 'PENDING'),
      ).toHaveLength(0);
    });
  });

  // ── Expiry ─────────────────────────────────────────────────────────────────

  describe('expireStale', () => {
    it('drops queue entries past their TTL', async () => {
      prisma.seedQueueEntry('alice', {
        expiresAt: new Date(Date.now() - 1000),
      });
      prisma.seedQueueEntry('bob');
      await service.expireStale();
      expect(prisma.queue.map((e) => e.userId)).toEqual(['bob']);
    });

    it('expires a timed-out match and puts both users back to searching', async () => {
      prisma.seedSession({
        userAId: 'alice',
        userBId: 'bob',
        expiresAt: new Date(Date.now() - 1000),
        snapshotA: snapshot(),
        snapshotB: snapshot(),
      });

      await service.expireStale();

      expect(prisma.sessions[0].status).toBe('EXPIRED');
      expect(emitter.emitMatchDeclined).toHaveBeenCalledTimes(2);
      expect(emitter.emitSearchResumed.mock.calls.flat().sort()).toEqual([
        'alice',
        'bob',
      ]);
    });

    it('leaves a still-live match alone', async () => {
      prisma.seedSession({ userAId: 'alice', userBId: 'bob' });
      await service.expireStale();
      expect(prisma.sessions[0].status).toBe('PENDING');
      expect(emitter.emitMatchDeclined).not.toHaveBeenCalled();
    });

    it('notifies once when two sweeps overlap, so replicas do not double-fire', async () => {
      prisma.seedSession({
        userAId: 'alice',
        userBId: 'bob',
        expiresAt: new Date(Date.now() - 1000),
        snapshotA: snapshot(),
        snapshotB: snapshot(),
      });

      await Promise.all([service.expireStale(), service.expireStale()]);
      expect(emitter.emitMatchDeclined).toHaveBeenCalledTimes(2); // once per user
    });

    it('re-pairs the two expired users only after the cooldown, not instantly', async () => {
      prisma.seedSession({
        userAId: 'alice',
        userBId: 'bob',
        expiresAt: new Date(Date.now() - 1000),
        snapshotA: snapshot(),
        snapshotB: snapshot(),
      });
      await service.expireStale();
      expect(
        prisma.sessions.filter((s) => s.status === 'PENDING'),
      ).toHaveLength(0);
      expect(prisma.queue.map((e) => e.userId).sort()).toEqual([
        'alice',
        'bob',
      ]);
    });
  });

  // ── Cancel ─────────────────────────────────────────────────────────────────

  describe('cancelQueue', () => {
    it('removes the entry and refreshes the bucket for everyone else', async () => {
      await service.joinQueue(joinDto('alice', { activity: 'chat' }));
      await service.joinQueue(
        joinDto('carol', { activity: 'chat', campus: 'campus-b' }),
      );
      emitter.emitQueueStats.mockClear();

      await service.cancelQueue('alice');
      expect(prisma.queue.map((e) => e.userId)).toEqual(['carol']);
    });

    it('is a no-op for a user who is not queued', async () => {
      await expect(service.cancelQueue('alice')).resolves.toBeUndefined();
      expect(emitter.emitQueueStats).not.toHaveBeenCalled();
    });
  });

  // ── Stats ──────────────────────────────────────────────────────────────────

  describe('getQueueStats', () => {
    it("counts everyone searching, not just the viewer's activity", async () => {
      prisma.seedQueueEntry('alice');
      prisma.seedQueueEntry('bob');
      prisma.seedQueueEntry('carol', { activity: 'gaming' });
      // Campus and time preference no longer partition the queue either.
      prisma.seedQueueEntry('dave', {
        campus: 'campus-b',
        timePreference: 'today',
      });

      const stats = await service.getQueueStats('study');
      expect(stats.count).toBe(4);
    });

    it("reports how many of them share the viewer's activity", async () => {
      prisma.seedQueueEntry('alice');
      prisma.seedQueueEntry('bob');
      prisma.seedQueueEntry('carol', { activity: 'gaming' });

      expect((await service.getQueueStats('study')).sameActivity).toBe(2);
      expect((await service.getQueueStats('gaming')).sameActivity).toBe(1);
      expect((await service.getQueueStats('coffee')).sameActivity).toBe(0);
    });

    it('omits the activity breakdown when no activity is asked about', async () => {
      prisma.seedQueueEntry('alice');
      const stats = await service.getQueueStats();
      expect(stats.count).toBe(1);
      expect(stats.sameActivity).toBe(0);
    });

    it('excludes expired entries from the count', async () => {
      prisma.seedQueueEntry('alice');
      prisma.seedQueueEntry('bob', { expiresAt: new Date(Date.now() - 1) });
      expect((await service.getQueueStats('study')).count).toBe(1);
    });

    it('reports a sane wait for an empty queue instead of NaN', async () => {
      const stats = await service.getQueueStats('study');
      expect(stats).toEqual({ count: 0, sameActivity: 0, avgWaitSecs: 60 });
    });

    it('derives the average wait from how long people have actually waited', async () => {
      prisma.seedQueueEntry('alice', {
        joinedAt: new Date(Date.now() - 200_000),
      });
      prisma.seedQueueEntry('bob', {
        joinedAt: new Date(Date.now() - 100_000),
      });
      const stats = await service.getQueueStats('study');
      expect(stats.avgWaitSecs).toBeGreaterThanOrEqual(140);
      expect(stats.avgWaitSecs).toBeLessThanOrEqual(160);
    });
  });

  // ── Resync ─────────────────────────────────────────────────────────────────

  describe('getStateFor', () => {
    it('reports a clean slate for an idle user', async () => {
      expect(await service.getStateFor('alice')).toEqual({
        queued: null,
        pendingMatch: null,
        recentMatch: null,
        stats: null,
      });
    });

    it('restores an in-progress search after a reload', async () => {
      await service.joinQueue(
        joinDto('alice', { area: 'library', optionalDetail: 'Physics' }),
      );
      const state = await service.getStateFor('alice');

      expect(state.queued).toMatchObject({
        activity: 'study',
        timePreference: 'now',
        area: 'library',
        optionalDetail: 'Physics',
      });
      expect(state.stats?.count).toBe(1);
      expect(state.pendingMatch).toBeNull();
    });

    it('restores a live match, showing the other person and the real deadline', async () => {
      await service.joinQueue(joinDto('alice'));
      await service.joinQueue(joinDto('bob'));

      const state = await service.getStateFor('alice');
      expect(state.pendingMatch?.candidate.id).toBe('bob');
      expect(state.pendingMatch?.matchId).toBe(prisma.sessions[0].id);
      expect(state.pendingMatch?.expiresAt).toBe(
        prisma.sessions[0].expiresAt.getTime(),
      );
    });

    it('does not resurrect a match that already expired', async () => {
      prisma.seedSession({
        userAId: 'alice',
        userBId: 'bob',
        expiresAt: new Date(Date.now() - 1),
      });
      expect((await service.getStateFor('alice')).pendingMatch).toBeNull();
    });

    it('treats an expired queue entry as not searching', async () => {
      prisma.seedQueueEntry('alice', { expiresAt: new Date(Date.now() - 1) });
      const state = await service.getStateFor('alice');
      expect(state.queued).toBeNull();
      expect(state.stats).toBeNull();
    });
  });

  // ── Recent match ───────────────────────────────────────────────────────────

  describe('getRecentMatchFor', () => {
    const accepted = (overrides = {}) =>
      prisma.seedSession({
        userAId: 'alice',
        userBId: 'bob',
        status: 'ACCEPTED',
        conversationId: 'int-1',
        ...overrides,
      });

    it('returns nothing when the user has never matched', async () => {
      expect(await service.getRecentMatchFor('alice')).toBeNull();
    });

    it('surfaces the other person and a routable chat id after a mutual accept', async () => {
      prisma.seedConversation('int-1');
      accepted();

      const recent = await service.getRecentMatchFor('alice');
      expect(recent?.candidate.id).toBe('bob');
      expect(recent?.candidate.displayName).toBe('BOB');
      expect(recent?.chatId).toBe('pub-int-1');
      expect(recent?.activity).toBe('study');
    });

    it('shows each side the other one', async () => {
      prisma.seedConversation('int-1');
      accepted();
      expect((await service.getRecentMatchFor('bob'))?.candidate.id).toBe(
        'alice',
      );
    });

    it('ignores matches that were declined or expired', async () => {
      prisma.seedSession({
        userAId: 'alice',
        userBId: 'bob',
        status: 'DECLINED',
      });
      prisma.seedSession({
        userAId: 'alice',
        userBId: 'carol',
        status: 'EXPIRED',
      });
      expect(await service.getRecentMatchFor('alice')).toBeNull();
    });

    it('drops a match older than the chat it opened', async () => {
      prisma.seedConversation('int-1');
      accepted({ createdAt: new Date(Date.now() - 25 * 60 * 60 * 1000) });
      expect(await service.getRecentMatchFor('alice')).toBeNull();
    });

    it('still shows the pairing when the conversation has expired, but offers no link', async () => {
      prisma.seedConversation('int-1', {
        expiresAt: new Date(Date.now() - 1000),
      });
      accepted();

      const recent = await service.getRecentMatchFor('alice');
      expect(recent?.candidate.id).toBe('bob');
      expect(recent?.chatId).toBeNull();
    });

    it('returns the newest match when there have been several', async () => {
      prisma.seedConversation('int-1');
      prisma.seedConversation('int-2');
      accepted({ createdAt: new Date(Date.now() - 60_000) });
      accepted({
        userBId: 'carol',
        conversationId: 'int-2',
        createdAt: new Date(),
      });

      expect((await service.getRecentMatchFor('alice'))?.candidate.id).toBe(
        'carol',
      );
    });

    it('is included in the resync snapshot', async () => {
      prisma.seedConversation('int-1');
      accepted();
      expect(
        (await service.getStateFor('alice')).recentMatch?.candidate.id,
      ).toBe('bob');
    });
  });

  // ── Degraded transport ─────────────────────────────────────────────────────

  // ── Who is searching ───────────────────────────────────────────────────────

  describe('getSearchingNow', () => {
    it('returns the live queue rows, with the detail each person actually gave', async () => {
      prisma.seedQueueEntry('bob', {
        activity: 'coffee',
        timePreference: '30min',
        area: 'cafeteria',
        optionalDetail: 'the one near the gate',
      });

      const [person, ...rest] = await service.getSearchingNow('alice');

      expect(rest).toHaveLength(0);
      expect(person).toEqual({
        user: expect.objectContaining({ id: 'bob', displayName: 'BOB' }),
        activity: 'coffee',
        timePreference: '30min',
        area: 'cafeteria',
        optionalDetail: 'the one near the gate',
        joinedAt: expect.any(Number),
      });
    });

    it('leaves what nobody filled in as null rather than inventing it', async () => {
      prisma.seedQueueEntry('bob');
      const [person] = await service.getSearchingNow('alice');
      expect(person.area).toBeNull();
      expect(person.optionalDetail).toBeNull();
    });

    it('never lists the viewer themselves', async () => {
      prisma.seedQueueEntry('alice');
      prisma.seedQueueEntry('bob');
      const people = await service.getSearchingNow('alice');
      expect(people.map((p) => p.user.id)).toEqual(['bob']);
    });

    it('applies the same block rule matching applies', async () => {
      prisma.addBlock('alice', 'bob');
      prisma.seedQueueEntry('bob');
      prisma.seedQueueEntry('carol');
      const people = await service.getSearchingNow('alice');
      expect(people.map((p) => p.user.id)).toEqual(['carol']);
    });

    it('drops entries that have expired out of the queue', async () => {
      prisma.seedQueueEntry('bob', { expiresAt: new Date(Date.now() - 1000) });
      prisma.seedQueueEntry('carol');
      const people = await service.getSearchingNow('alice');
      expect(people.map((p) => p.user.id)).toEqual(['carol']);
    });

    it('leaves out unverified accounts', async () => {
      prisma.seedUser('dave', { verificationStatus: 'PENDING' });
      prisma.seedQueueEntry('dave');
      prisma.seedQueueEntry('bob');
      const people = await service.getSearchingNow('alice');
      expect(people.map((p) => p.user.id)).toEqual(['bob']);
    });

    it('stops listing someone the moment they cancel', async () => {
      await service.joinQueue(joinDto('bob'));
      expect(await service.getSearchingNow('alice')).toHaveLength(1);

      await service.cancelQueue('bob');
      expect(await service.getSearchingNow('alice')).toHaveLength(0);
    });

    it('follows a change of activity rather than showing the old one', async () => {
      await service.joinQueue(joinDto('bob'));
      await service.joinQueue(joinDto('bob', { activity: 'coffee' }));

      const people = await service.getSearchingNow('alice');
      expect(people).toHaveLength(1);
      expect(people[0].activity).toBe('coffee');
    });

    it('drops both people once they are paired off the queue', async () => {
      await service.joinQueue(joinDto('bob'));
      await service.joinQueue(joinDto('carol'));
      expect(prisma.sessions).toHaveLength(1);
      expect(await service.getSearchingNow('alice')).toHaveLength(0);
    });

    it('tells everyone the queue moved whenever it does', async () => {
      await service.joinQueue(joinDto('bob'));
      expect(emitter.emitQueueChanged).toHaveBeenCalled();

      emitter.emitQueueChanged.mockClear();
      await service.cancelQueue('bob');
      expect(emitter.emitQueueChanged).toHaveBeenCalled();
    });
  });

  // ── Ranking feedback ───────────────────────────────────────────────────────

  /**
   * The behavioural half of the ranker, end to end through the service: a
   * pass has to be attributed when it happens, read back per candidate, and
   * spend its influence on the person who made it rather than on both sides.
   *
   * The sessions here are stamped two hours old on purpose. Inside the
   * 30-minute re-match cooldown the pair is hard-excluded by the candidate
   * query and never reaches the scorer at all, so anything about *ranking*
   * has to be asserted from outside that window.
   */
  describe('feedback from passes', () => {
    const hoursAgo = (n: number) => new Date(Date.now() - n * 60 * 60 * 1000);

    const rankOf = async (userId: string, candidateId: string) => {
      const result = await service.explainRankingFor(userId);
      const row = result.candidates.find((c) => c.userId === candidateId);
      if (!row) throw new Error(`${candidateId} was not ranked for ${userId}`);
      return { ...row, feedback: row.feedback ?? null };
    };

    it('records which side passed, so the pass can be attributed later', async () => {
      await service.joinQueue(joinDto('alice'));
      await service.joinQueue(joinDto('bob'));
      const sessionId = prisma.sessions[0].id;

      await service.respondToMatch('alice', sessionId, 'decline');

      const session = prisma.sessions.find((s) => s.id === sessionId)!;
      expect(session.status).toBe('DECLINED');
      expect(session.declinedById).toBe('alice');
    });

    it('ranks someone this user passed on below someone they have not', async () => {
      prisma.seedSession({
        userAId: 'alice',
        userBId: 'bob',
        status: 'DECLINED',
        declinedById: 'alice',
        createdAt: hoursAgo(2),
      });
      prisma.seedQueueEntry('alice');
      prisma.seedQueueEntry('bob');
      prisma.seedQueueEntry('carol');

      const passed = await rankOf('alice', 'bob');
      const fresh = await rankOf('alice', 'carol');

      expect(passed.feedback?.declinedByMe).toBe(1);
      expect(passed.score).toBeLessThan(fresh.score);
    });

    it('drops them further with every repeat pass', async () => {
      prisma.seedQueueEntry('alice');
      prisma.seedQueueEntry('bob');

      prisma.seedSession({
        userAId: 'alice',
        userBId: 'bob',
        status: 'DECLINED',
        declinedById: 'alice',
        createdAt: hoursAgo(3),
      });
      const afterOne = (await rankOf('alice', 'bob')).score;

      prisma.seedSession({
        userAId: 'bob',
        userBId: 'alice',
        status: 'DECLINED',
        declinedById: 'alice',
        createdAt: hoursAgo(2),
      });
      const afterTwo = (await rankOf('alice', 'bob')).score;

      expect(afterTwo).toBeLessThan(afterOne);
    });

    it('charges the pass to the person who made it, not to both sides', async () => {
      prisma.seedSession({
        userAId: 'alice',
        userBId: 'bob',
        status: 'DECLINED',
        declinedById: 'alice',
        createdAt: hoursAgo(2),
      });
      prisma.seedQueueEntry('alice');
      prisma.seedQueueEntry('bob');

      const forAlice = await rankOf('alice', 'bob');
      const forBob = await rankOf('bob', 'alice');

      expect(forAlice.feedback?.declinedByMe).toBe(1);
      expect(forBob.feedback?.declinedByThem).toBe(1);
      // Being passed on is the milder signal of the two.
      expect(forBob.score).toBeGreaterThan(forAlice.score);
    });

    it('does not invent a pass for a decline recorded before attribution existed', async () => {
      prisma.seedSession({
        userAId: 'alice',
        userBId: 'bob',
        status: 'DECLINED',
        declinedById: null,
        createdAt: hoursAgo(2),
      });
      prisma.seedQueueEntry('alice');
      prisma.seedQueueEntry('bob');

      const row = await rankOf('alice', 'bob');
      expect(row.feedback?.declinedByMe).toBe(0);
      expect(row.feedback?.declinedByThem).toBe(0);
      // Read for what it is: a pairing that did not happen.
      expect(row.feedback?.expired).toBe(1);
    });

    it('stops offering a pairing after three passes, and says so', async () => {
      for (const n of [4, 3, 2]) {
        prisma.seedSession({
          userAId: 'alice',
          userBId: 'bob',
          status: 'DECLINED',
          declinedById: 'alice',
          createdAt: hoursAgo(n),
        });
      }
      prisma.seedQueueEntry('alice');
      prisma.seedQueueEntry('bob');
      prisma.seedQueueEntry('carol');

      const result = await service.explainRankingFor('alice');
      expect(
        result.candidates.find((c) => c.userId === 'bob')?.skipped,
      ).toBe(true);
      expect(result.order.map((o) => o.userId)).toEqual(['carol']);
    });

    it('will not pair two people the skip is holding apart', async () => {
      for (const n of [4, 3, 2]) {
        prisma.seedSession({
          userAId: 'alice',
          userBId: 'bob',
          status: 'DECLINED',
          declinedById: 'alice',
          createdAt: hoursAgo(n),
        });
      }
      prisma.seedQueueEntry('bob');
      await service.joinQueue(joinDto('alice'));

      expect(prisma.sessions.filter((s) => s.status === 'PENDING')).toHaveLength(
        0,
      );
    });

    it('lifts a candidate the user follows, and both of them further', async () => {
      prisma.seedQueueEntry('alice');
      prisma.seedQueueEntry('bob');
      prisma.seedQueueEntry('carol');
      prisma.addFollow('alice', 'bob');
      prisma.addFollow('bob', 'alice');

      const mutual = await rankOf('alice', 'bob');
      const stranger = await rankOf('alice', 'carol');
      expect(mutual.score).toBeGreaterThan(stranger.score);
    });

    it('lifts a candidate who shares a community', async () => {
      prisma.seedQueueEntry('alice');
      prisma.seedQueueEntry('bob');
      prisma.seedQueueEntry('carol');
      prisma.addCommunityMember('alice', 'chess-club');
      prisma.addCommunityMember('bob', 'chess-club');

      const shared = await rankOf('alice', 'bob');
      const stranger = await rankOf('alice', 'carol');
      expect(shared.score).toBeGreaterThan(stranger.score);
    });

    it('explains every candidate it ranked', async () => {
      prisma.seedQueueEntry('alice');
      prisma.seedQueueEntry('bob');

      const result = await service.explainRankingFor('alice');
      expect(result.queued).toBe(true);
      expect(result.candidates[0].explanation).toContain('coverage=');
      expect(result.candidates[0].detail.signals.length).toBeGreaterThan(0);
    });

    it('ranks nothing for someone who is not in the queue', async () => {
      const result = await service.explainRankingFor('alice');
      expect(result.queued).toBe(false);
      expect(result.candidates).toEqual([]);
    });
  });

  it('completes a match even when no socket gateway is attached', async () => {
    setRealtimeGatewayRef(null);
    await service.joinQueue(joinDto('alice'));
    await service.joinQueue(joinDto('bob'));
    expect(prisma.sessions).toHaveLength(1);
  });
});

/**
 * Stands in for BlocksService, reading the fake Prisma's seeded block rows so
 * the block-aware matching tests still exercise real exclusion behaviour after
 * matching was consolidated onto the shared service.
 */
function blocksStubFor(prisma: any) {
  const excluded = (userId: string): string[] =>
    (prisma.blocks as any[])
      .filter((b) => b.blockerId === userId || b.blockedId === userId)
      .map((b) => (b.blockerId === userId ? b.blockedId : b.blockerId));

  return {
    getExcludedUserIds: async (userId: string) => excluded(userId),
    isBlocked: async (a: string, b: string) => excluded(a).includes(b),
    filterBlockedUsers: async (userId: string, ids: string[]) => {
      const set = new Set(excluded(userId));
      return ids.filter((id) => !set.has(id));
    },
    injectBlockFilter: async (_userId: string, where: any) => where,
    invalidateBlockCache: async () => {},
  } as any;
}
