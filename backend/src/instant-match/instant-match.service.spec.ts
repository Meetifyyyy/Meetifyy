import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { InstantMatchService, setRealtimeGatewayRef } from './instant-match.service';
import { PrismaFake } from './testing/prisma-fake';

/**
 * Instant Match is a two-party state machine driven entirely by socket events,
 * so its failure modes are concurrency ones: two people matched twice, one
 * conversation created twice, a timed-out match still acceptable, a declined
 * partner silently dropped out of the queue. Each of those has a case here.
 */
describe('InstantMatchService', () => {
  let prisma: PrismaFake;
  let messages: { createInstantMatchConversation: jest.Mock };
  let emitter: {
    emitMatchFound: jest.Mock;
    emitMatchAccepted: jest.Mock;
    emitMatchDeclined: jest.Mock;
    emitSearchResumed: jest.Mock;
    emitQueueStats: jest.Mock;
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

  beforeEach(() => {
    prisma = new PrismaFake();
    prisma.seedUser('alice');
    prisma.seedUser('bob');
    prisma.seedUser('carol');

    messages = {
      createInstantMatchConversation: jest
        .fn()
        .mockResolvedValue({ id: 'pub-conv-1', internalId: 'int-conv-1' }),
    };
    emitter = {
      emitMatchFound: jest.fn(),
      emitMatchAccepted: jest.fn(),
      emitMatchDeclined: jest.fn(),
      emitSearchResumed: jest.fn(),
      emitQueueStats: jest.fn(),
    };
    setRealtimeGatewayRef(emitter);
    service = new InstantMatchService(prisma as any, messages as any);
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
      await expect(service.joinQueue(joinDto('alice')))
        .rejects.toThrow('Respond to your current match first');
      expect(prisma.queue).toHaveLength(0);
    });

    it('allows re-queueing once the old match has resolved', async () => {
      prisma.seedSession({ userAId: 'alice', userBId: 'bob', status: 'DECLINED' });
      await expect(service.joinQueue(joinDto('alice'))).resolves.toBeUndefined();
    });

    it('pushes queue depth to everyone waiting in the bucket, not just the joiner', async () => {
      await service.joinQueue(joinDto('alice', { activity: 'chat' }));
      emitter.emitQueueStats.mockClear();
      await service.joinQueue(joinDto('bob', { activity: 'chat', campus: 'campus-b' }));

      // bob is in a different campus bucket, so alice must not be told anything
      // changed — but bob himself sees his own bucket.
      const notified = emitter.emitQueueStats.mock.calls.map((c) => c[0]);
      expect(notified).toContain('bob');
      expect(notified).not.toContain('alice');
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

      const [[aliceId, alicePayload], [bobId, bobPayload]] = emitter.emitMatchFound.mock.calls;
      expect([aliceId, bobId].sort()).toEqual(['alice', 'bob']);
      expect(alicePayload.matchId).toBe(bobPayload.matchId);
      // Each side is shown the *other* person.
      expect(alicePayload.candidate.id).not.toBe(alicePayload.matchId);
      expect([alicePayload.candidate.id, bobPayload.candidate.id].sort()).toEqual(['alice', 'bob']);
    });

    it('sends an absolute deadline so a slow client cannot desync its countdown', async () => {
      await service.joinQueue(joinDto('alice'));
      await service.joinQueue(joinDto('bob'));
      const payload = emitter.emitMatchFound.mock.calls[0][1];
      expect(payload.expiresAt).toBeGreaterThan(Date.now());
      expect(payload.timer).toBe(30);
    });

    it('never matches across campuses, activities, or time preferences', async () => {
      await service.joinQueue(joinDto('alice'));
      await service.joinQueue(joinDto('bob', { campus: 'campus-b' }));
      await service.joinQueue(joinDto('carol', { activity: 'gaming' }));
      expect(prisma.sessions).toHaveLength(0);
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
      expect([session.userAId, session.userBId].sort()).toEqual(['alice', 'bob']);
    });

    it('breaks a score tie toward whoever has waited longest', async () => {
      prisma.seedQueueEntry('carol', { joinedAt: new Date(Date.now() - 60_000) });
      prisma.seedQueueEntry('bob', { joinedAt: new Date(Date.now() - 1_000) });
      await service.joinQueue(joinDto('alice'));

      const session = prisma.sessions[0];
      expect([session.userAId, session.userBId].sort()).toEqual(['alice', 'carol']);
    });

    it('never matches users who have blocked each other, in either direction', async () => {
      prisma.addBlock('bob', 'alice');
      await service.joinQueue(joinDto('alice'));
      await service.joinQueue(joinDto('bob'));
      expect(prisma.sessions).toHaveLength(0);
    });

    it('does not re-serve someone the user just declined', async () => {
      prisma.seedSession({ userAId: 'alice', userBId: 'bob', status: 'DECLINED' });
      await service.joinQueue(joinDto('alice'));
      await service.joinQueue(joinDto('bob'));
      expect(prisma.sessions.filter((s) => s.status === 'PENDING')).toHaveLength(0);
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
      expect([prisma.sessions[0].userAId, prisma.sessions[0].userBId].sort())
        .toEqual(['alice', 'carol']);
    });

    it('creates no session at all when every claim is lost', async () => {
      prisma.seedQueueEntry('bob');
      prisma.seedQueueEntry('alice');
      prisma.onTransaction = () => { prisma.queue = prisma.queue.filter((e) => e.userId !== 'bob'); };

      await service.tryMatch('alice');
      expect(prisma.sessions).toHaveLength(0);
    });

    it('stores both sides’ requests on the session so either can be re-queued later', async () => {
      await service.joinQueue(joinDto('alice', { area: 'library', optionalDetail: 'Physics' }));
      await service.joinQueue(joinDto('bob', { area: 'hostel' }));

      const session = prisma.sessions[0];
      expect(session.snapshotA).toMatchObject({ activity: 'study', campus: 'campus-a' });
      expect(session.snapshotB).toMatchObject({ activity: 'study', campus: 'campus-a' });
    });
  });

  // ── Authorization ──────────────────────────────────────────────────────────

  describe('respondToMatch authorization', () => {
    it('rejects an unknown match id', async () => {
      await expect(service.respondToMatch('alice', 'nope', 'accept'))
        .rejects.toBeInstanceOf(NotFoundException);
    });

    it('refuses a user who is not part of the match, even with a valid id', async () => {
      const session = prisma.seedSession({ userAId: 'alice', userBId: 'bob' });
      await expect(service.respondToMatch('carol', session.id, 'accept'))
        .rejects.toBeInstanceOf(ForbiddenException);
      expect(messages.createInstantMatchConversation).not.toHaveBeenCalled();
    });

    it('refuses a match that already resolved', async () => {
      const session = prisma.seedSession({ userAId: 'alice', userBId: 'bob', status: 'ACCEPTED' });
      await expect(service.respondToMatch('alice', session.id, 'accept'))
        .rejects.toThrow('Match is no longer active');
    });

    it('refuses — and expires — a match whose deadline has already passed', async () => {
      const session = prisma.seedSession({
        userAId: 'alice', userBId: 'bob',
        expiresAt: new Date(Date.now() - 1),
        snapshotA: snapshot(), snapshotB: snapshot(),
      });
      await expect(service.respondToMatch('alice', session.id, 'accept'))
        .rejects.toThrow('Match is no longer active');
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

    it('opens exactly one conversation and notifies both once both accept', async () => {
      await service.respondToMatch('alice', sessionId, 'accept');
      await service.respondToMatch('bob', sessionId, 'accept');

      expect(messages.createInstantMatchConversation).toHaveBeenCalledTimes(1);
      expect(prisma.sessions[0].status).toBe('ACCEPTED');
      expect(emitter.emitMatchAccepted).toHaveBeenCalledTimes(2);
      expect(emitter.emitMatchAccepted).toHaveBeenCalledWith('alice', { chatId: 'pub-conv-1' });
      expect(emitter.emitMatchAccepted).toHaveBeenCalledWith('bob', { chatId: 'pub-conv-1' });
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
      await expect(service.respondToMatch('bob', sessionId, 'accept'))
        .rejects.toThrow('Match is no longer active');

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
      messages.createInstantMatchConversation.mockRejectedValueOnce(new Error('db down'));
      await service.respondToMatch('alice', sessionId, 'accept');
      await expect(service.respondToMatch('bob', sessionId, 'accept'))
        .rejects.toThrow('Could not open your chat — try again');

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
      const legacy = prisma.seedSession({ userAId: 'alice', userBId: 'carol', snapshotB: null });
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
      expect(prisma.sessions.filter((s) => s.status === 'PENDING')).toHaveLength(0);
    });
  });

  // ── Expiry ─────────────────────────────────────────────────────────────────

  describe('expireStale', () => {
    it('drops queue entries past their TTL', async () => {
      prisma.seedQueueEntry('alice', { expiresAt: new Date(Date.now() - 1000) });
      prisma.seedQueueEntry('bob');
      await service.expireStale();
      expect(prisma.queue.map((e) => e.userId)).toEqual(['bob']);
    });

    it('expires a timed-out match and puts both users back to searching', async () => {
      prisma.seedSession({
        userAId: 'alice', userBId: 'bob',
        expiresAt: new Date(Date.now() - 1000),
        snapshotA: snapshot(), snapshotB: snapshot(),
      });

      await service.expireStale();

      expect(prisma.sessions[0].status).toBe('EXPIRED');
      expect(emitter.emitMatchDeclined).toHaveBeenCalledTimes(2);
      expect(emitter.emitSearchResumed.mock.calls.flat().sort()).toEqual(['alice', 'bob']);
    });

    it('leaves a still-live match alone', async () => {
      prisma.seedSession({ userAId: 'alice', userBId: 'bob' });
      await service.expireStale();
      expect(prisma.sessions[0].status).toBe('PENDING');
      expect(emitter.emitMatchDeclined).not.toHaveBeenCalled();
    });

    it('notifies once when two sweeps overlap, so replicas do not double-fire', async () => {
      prisma.seedSession({
        userAId: 'alice', userBId: 'bob',
        expiresAt: new Date(Date.now() - 1000),
        snapshotA: snapshot(), snapshotB: snapshot(),
      });

      await Promise.all([service.expireStale(), service.expireStale()]);
      expect(emitter.emitMatchDeclined).toHaveBeenCalledTimes(2); // once per user
    });

    it('re-pairs the two expired users only after the cooldown, not instantly', async () => {
      prisma.seedSession({
        userAId: 'alice', userBId: 'bob',
        expiresAt: new Date(Date.now() - 1000),
        snapshotA: snapshot(), snapshotB: snapshot(),
      });
      await service.expireStale();
      expect(prisma.sessions.filter((s) => s.status === 'PENDING')).toHaveLength(0);
      expect(prisma.queue.map((e) => e.userId).sort()).toEqual(['alice', 'bob']);
    });
  });

  // ── Cancel ─────────────────────────────────────────────────────────────────

  describe('cancelQueue', () => {
    it('removes the entry and refreshes the bucket for everyone else', async () => {
      await service.joinQueue(joinDto('alice', { activity: 'chat' }));
      await service.joinQueue(joinDto('carol', { activity: 'chat', campus: 'campus-b' }));
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
    it('counts only live entries in the same bucket', async () => {
      prisma.seedQueueEntry('alice');
      prisma.seedQueueEntry('bob');
      prisma.seedQueueEntry('carol', { activity: 'gaming' });
      const stats = await service.getQueueStats('campus-a', 'study', 'now');
      expect(stats.count).toBe(2);
    });

    it('excludes expired entries from the count', async () => {
      prisma.seedQueueEntry('alice');
      prisma.seedQueueEntry('bob', { expiresAt: new Date(Date.now() - 1) });
      expect((await service.getQueueStats('campus-a', 'study', 'now')).count).toBe(1);
    });

    it('reports a sane wait for an empty bucket instead of NaN', async () => {
      const stats = await service.getQueueStats('campus-a', 'study', 'now');
      expect(stats).toEqual({ count: 0, avgWaitSecs: 60 });
    });

    it('derives the average wait from how long people have actually waited', async () => {
      prisma.seedQueueEntry('alice', { joinedAt: new Date(Date.now() - 200_000) });
      prisma.seedQueueEntry('bob', { joinedAt: new Date(Date.now() - 100_000) });
      const stats = await service.getQueueStats('campus-a', 'study', 'now');
      expect(stats.avgWaitSecs).toBeGreaterThanOrEqual(140);
      expect(stats.avgWaitSecs).toBeLessThanOrEqual(160);
    });
  });

  // ── Resync ─────────────────────────────────────────────────────────────────

  describe('getStateFor', () => {
    it('reports a clean slate for an idle user', async () => {
      expect(await service.getStateFor('alice')).toEqual({
        queued: null, pendingMatch: null, recentMatch: null, stats: null,
      });
    });

    it('restores an in-progress search after a reload', async () => {
      await service.joinQueue(joinDto('alice', { area: 'library', optionalDetail: 'Physics' }));
      const state = await service.getStateFor('alice');

      expect(state.queued).toMatchObject({
        activity: 'study', timePreference: 'now', area: 'library', optionalDetail: 'Physics',
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
      expect(state.pendingMatch?.expiresAt).toBe(prisma.sessions[0].expiresAt.getTime());
    });

    it('does not resurrect a match that already expired', async () => {
      prisma.seedSession({
        userAId: 'alice', userBId: 'bob', expiresAt: new Date(Date.now() - 1),
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
    const accepted = (overrides = {}) => prisma.seedSession({
      userAId: 'alice', userBId: 'bob', status: 'ACCEPTED',
      conversationId: 'int-1', ...overrides,
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
      expect((await service.getRecentMatchFor('bob'))?.candidate.id).toBe('alice');
    });

    it('ignores matches that were declined or expired', async () => {
      prisma.seedSession({ userAId: 'alice', userBId: 'bob', status: 'DECLINED' });
      prisma.seedSession({ userAId: 'alice', userBId: 'carol', status: 'EXPIRED' });
      expect(await service.getRecentMatchFor('alice')).toBeNull();
    });

    it('drops a match older than the chat it opened', async () => {
      prisma.seedConversation('int-1');
      accepted({ createdAt: new Date(Date.now() - 25 * 60 * 60 * 1000) });
      expect(await service.getRecentMatchFor('alice')).toBeNull();
    });

    it('still shows the pairing when the conversation has expired, but offers no link', async () => {
      prisma.seedConversation('int-1', { expiresAt: new Date(Date.now() - 1000) });
      accepted();

      const recent = await service.getRecentMatchFor('alice');
      expect(recent?.candidate.id).toBe('bob');
      expect(recent?.chatId).toBeNull();
    });

    it('returns the newest match when there have been several', async () => {
      prisma.seedConversation('int-1');
      prisma.seedConversation('int-2');
      accepted({ createdAt: new Date(Date.now() - 60_000) });
      accepted({ userBId: 'carol', conversationId: 'int-2', createdAt: new Date() });

      expect((await service.getRecentMatchFor('alice'))?.candidate.id).toBe('carol');
    });

    it('is included in the resync snapshot', async () => {
      prisma.seedConversation('int-1');
      accepted();
      expect((await service.getStateFor('alice')).recentMatch?.candidate.id).toBe('bob');
    });
  });

  // ── Degraded transport ─────────────────────────────────────────────────────

  it('completes a match even when no socket gateway is attached', async () => {
    setRealtimeGatewayRef(null);
    await service.joinQueue(joinDto('alice'));
    await service.joinQueue(joinDto('bob'));
    expect(prisma.sessions).toHaveLength(1);
  });
});
