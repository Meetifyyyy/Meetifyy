import type { MatchSession } from '@prisma/client';
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
import { createVerificationAccessMock } from '../common/verification/testing/verification-access.mock';
import { relaxedThreshold, scoreMutual, scorePair } from './matching/engine';
import { flipFeedback, type SideContext } from './matching/signals';
import { FEATURE_VERSION } from './matching/features';

/**
 * Phase 1 of the Instant Match learning plan
 * (docs/private/backend-optimization/E7_MATCHING_ALGORITHM_REVIEW.md): a
 * two-sided score, the skip rule both ways, a thin pool relaxing faster, the
 * sweep re-trying long waiters, and the data a learned ranker will need.
 */
describe('Instant Match learning plan, phase 1', () => {
  const MIN = 60_000;
  const side = (over: Partial<SideContext> = {}): SideContext => ({
    campus: 'college-a',
    activity: 'study',
    timePreference: 'now',
    interests: ['music'],
    ...over,
  });

  describe('a two-sided score', () => {
    const passed = {
      accepted: 0,
      declinedByMe: 1,
      declinedByThem: 0,
      expired: 0,
      lastPairedAt: Date.now() - 2 * 60 * MIN,
    };

    it('is the lower of the two views', () => {
      const a = side();
      const b = side({ interests: ['music', 'chess'] });
      const mutual = scoreMutual(a, b, { feedback: passed });
      const mine = scorePair(a, b, { feedback: passed }).score;
      const theirs = scorePair(b, a, { feedback: flipFeedback(passed) }).score;
      expect(mutual.detail.score).toBe(Math.min(mine, theirs));
      expect([mutual.ab, mutual.ba]).toEqual([mine, theirs]);
    });

    it('is the same whoever searches', () => {
      const a = side();
      const b = side({ interests: ['music', 'chess'] });
      expect(scoreMutual(a, b, { feedback: passed }).detail.score).toBe(
        scoreMutual(b, a, { feedback: flipFeedback(passed) }).detail.score,
      );
    });
  });

  describe('the bar relaxes faster when few could be matched', () => {
    it('falls in half the time with two candidates, and keeps three minutes when busy', () => {
      expect(relaxedThreshold(90_000, 2)).toBe(0);
      expect(relaxedThreshold(90_000, 4)).toBeCloseTo(62 / 3, 5);
      expect(relaxedThreshold(90_000, 40)).toBe(31);
      expect(relaxedThreshold(90_000)).toBe(31);
    });
  });

  describe('in the service', () => {
    let prisma: PrismaFake;
    let service: InstantMatchService;
    let emitter: ReturnType<typeof createEmitterMock>;

    beforeEach(() => {
      prisma = new PrismaFake();
      emitter = createEmitterMock();
      setRealtimeGatewayRef(emitter);
      for (const id of ['alice', 'bob', 'carol'])
        prisma.seedUser(id, { interests: ['music'] });
      service = new InstantMatchService(
        prisma.asService(),
        stub<MessagesService>({
          registerInstantMatchGuard: jest.fn(),
          createInstantMatchConversation: jest.fn(() =>
            Promise.resolve({
              id: 'pub-c',
              internalId: 'conv-c',
              expiresAt: Date.now() + 86_400_000,
            }),
          ),
        }),
        blocksStubFor(prisma),
        createVerificationAccessMock(),
      );
      service.rankingOptions = { deterministic: true };
    });

    it('skips a pairing the OTHER person passed on three times, whoever searches', async () => {
      for (const hours of [5, 4, 3]) {
        prisma.seedSession({
          userAId: 'alice',
          userBId: 'bob',
          status: 'DECLINED',
          declinedById: 'alice',
          createdAt: new Date(Date.now() - hours * 60 * MIN),
        });
      }
      prisma.seedQueueEntry('alice', {
        joinedAt: new Date(Date.now() - 10 * MIN),
      });
      prisma.seedQueueEntry('bob', {
        joinedAt: new Date(Date.now() - 10 * MIN),
      });

      // Bob searches; alice is the one who kept passing.
      await expect(service.tryMatch('bob')).resolves.toBe(false);
      expect(
        prisma.sessions.filter((s) => s.status === 'PENDING'),
      ).toHaveLength(0);
    });

    it('the sweep pairs people who have waited, without anyone new joining', async () => {
      // Different colleges: below the opening bar, so no pairing at join.
      prisma.seedAffiliation('bob', 'college-b');
      prisma.seedQueueEntry('alice', {
        joinedAt: new Date(Date.now() - 5 * MIN),
      });
      prisma.seedQueueEntry('bob', {
        joinedAt: new Date(Date.now() - 5 * MIN),
      });

      await service.expireStale();

      expect(prisma.sessions).toHaveLength(1);
      expect(emitter.emitMatchFound).toHaveBeenCalledTimes(2);
    });

    it('the sweep leaves people who have only just joined to the join itself', async () => {
      prisma.seedAffiliation('bob', 'college-b');
      prisma.seedQueueEntry('alice', {
        joinedAt: new Date(Date.now() - 5_000),
      });
      prisma.seedQueueEntry('bob', { joinedAt: new Date(Date.now() - 5_000) });

      await service.expireStale();

      expect(prisma.sessions).toHaveLength(0);
    });

    it('records what a ranked pairing was judged on — values and weights, never the raw inputs', async () => {
      prisma.seedQueueEntry('alice', {
        latitude: 12.97123,
        longitude: 77.59456,
        area: 'library',
      });
      prisma.seedQueueEntry('bob', {
        latitude: 12.97124,
        longitude: 77.59457,
        area: 'library',
      });

      await service.tryMatch('alice');

      const [session] = prisma.sessions;
      const features = session.features as Record<string, unknown>;
      expect(features).toMatchObject({
        v: FEATURE_VERSION,
        source: 'ranker',
        picked: 'lead',
        poolSize: 1,
      });
      const [, found] = emitter.emitMatchFound.mock.calls[0];
      expect(features.score).toBe(found.compatibility);
      const signals = features.signals as Record<
        string,
        { value: number | null; weight: number }
      >;
      expect(Object.keys(signals).sort()).toContain('proximity');
      expect(signals.campus).toEqual({
        value: 1,
        weight: expect.any(Number) as number,
      });
      // No coordinates, campus, area or other raw input anywhere in the row.
      const raw = JSON.stringify(features);
      for (const leak of [
        '12.97',
        '77.59',
        'college-a',
        'library',
        'campus-a',
      ]) {
        expect(raw).not.toContain(leak);
      }
    });

    it('records a direct request as such', async () => {
      prisma.seedQueueEntry('alice');
      prisma.seedQueueEntry('bob');
      await service.requestMatch('alice', 'bob');
      expect(prisma.sessions[0].features).toMatchObject({
        source: 'request',
        threshold: null,
        picked: null,
      });
    });

    it('counts each side’s messages when the chat ends, before they are deleted', async () => {
      const chat: MatchSession = prisma.seedSession({
        id: 'm1',
        userAId: 'alice',
        userBId: 'bob',
        status: 'ACCEPTED',
        aAccepted: true,
        bAccepted: true,
        conversationId: 'conv-1',
        chatExpiresAt: new Date(Date.now() + 60 * MIN),
      });
      prisma.seedConversation('conv-1', { status: 'ACTIVE' });
      prisma.messages.push(
        { id: 'x1', conversationId: 'conv-1', senderId: 'alice' },
        { id: 'x2', conversationId: 'conv-1', senderId: 'alice' },
        { id: 'x3', conversationId: 'conv-1', senderId: 'bob' },
        { id: 'y1', conversationId: 'conv-other', senderId: 'alice' },
      );

      await service.leaveChatSession('bob', chat.id);

      expect(prisma.sessions[0]).toMatchObject({
        aMessageCount: 2,
        bMessageCount: 1,
      });
      expect(prisma.messages.map((m) => m.id)).toEqual(['y1']);
    });
  });
});
