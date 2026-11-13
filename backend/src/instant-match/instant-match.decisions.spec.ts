import { Prisma } from '@prisma/client';
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

/**
 * The owner's Instant Match decisions of 2026-11-13 (D2, D3, D4; D1 and D5
 * are pinned in instant-match.service.spec.ts): the roster ranked for each
 * viewer, a person who keeps passing sinking instead of being blocked, and
 * the campus signal read from the verified college.
 */
describe('Instant Match decisions', () => {
  let prisma: PrismaFake;
  let service: InstantMatchService;
  const MIN = 60_000;

  const queue = (
    userId: string,
    over: Partial<Parameters<PrismaFake['seedQueueEntry']>[1]> = {},
  ) => prisma.seedQueueEntry(userId, over);
  const roster = async (viewer: string) =>
    (await service.getSearchingNow(viewer)).map((e) => e.user.username);

  beforeEach(() => {
    prisma = new PrismaFake();
    setRealtimeGatewayRef(createEmitterMock());
    service = new InstantMatchService(
      prisma.asService(),
      stub<MessagesService>({ registerInstantMatchGuard: jest.fn() }),
      blocksStubFor(prisma),
      createVerificationAccessMock(),
    );
    prisma.seedUser('viewer', {
      interests: ['music', 'chess'],
      course: 'B.Tech',
      branch: 'CSE',
      passingYear: 2027,
    });
  });

  describe('D2: the roster is ranked for the viewer', () => {
    it('puts the more compatible person first, not the one who joined first', async () => {
      prisma.seedUser('stranger', {
        interests: ['hiking'],
        course: 'B.A.',
        branch: 'History',
        passingYear: 2030,
      });
      prisma.seedAffiliation('stranger', 'college-z');
      prisma.seedUser('kindred', {
        interests: ['music', 'chess'],
        course: 'B.Tech',
        branch: 'CSE',
        passingYear: 2027,
      });
      queue('stranger', { joinedAt: new Date(Date.now() - 20 * MIN) });
      queue('kindred', { joinedAt: new Date(Date.now() - 1 * MIN) });

      expect(await roster('viewer')).toEqual(['kindred', 'stranger']);
    });

    it('puts people searching for the viewer’s own activity first', async () => {
      prisma.seedUser('gamer', { interests: ['music', 'chess'] });
      prisma.seedUser('studier', { interests: ['hiking'] });
      queue('viewer', { activity: 'study' });
      queue('gamer', { activity: 'gaming' });
      queue('studier', { activity: 'study' });

      expect((await roster('viewer'))[0]).toBe('studier');
    });

    it('shows a newcomer at once after the queue changes (the shared list is refreshed)', async () => {
      prisma.seedUser('first');
      queue('first');
      expect(await roster('viewer')).toEqual(['first']);

      prisma.seedUser('second');
      await service.joinQueue({
        userId: 'second',
        campus: 'campus-a',
        activity: 'gaming',
        timePreference: 'today',
        optionalDetail: null,
        area: null,
        gps: null,
      });

      expect((await roster('viewer')).sort()).toEqual(['first', 'second']);
    });

    it('keeps the card (with the id a request needs) in the same shape', async () => {
      prisma.seedUser('kindred');
      queue('kindred');
      const [entry] = await service.getSearchingNow('viewer');
      expect(entry.user).toMatchObject({ id: 'kindred', username: 'kindred' });
      expect(entry).toMatchObject({
        activity: 'study',
        timePreference: 'now',
        optionalDetail: null,
        area: null,
      });
      expect(typeof entry.joinedAt).toBe('number');
    });
  });

  describe('D3: someone who passed on the viewer sinks instead of being blocked', () => {
    const passedOnViewer = (by: string, times: number) => {
      for (let i = 0; i < times; i += 1) {
        prisma.seedSession({
          userAId: 'viewer',
          userBId: by,
          status: 'DECLINED',
          declinedById: by,
          // Outside the 30-minute cooldown, inside the feedback window.
          createdAt: new Date(Date.now() - (2 + i) * 60 * MIN),
          snapshotA: Prisma.DbNull as unknown as null,
          snapshotB: Prisma.DbNull as unknown as null,
        });
      }
    };

    it('drops further each time, but stays listed and can still be asked', async () => {
      prisma.seedUser('kindred', {
        interests: ['music', 'chess'],
        course: 'B.Tech',
        branch: 'CSE',
        passingYear: 2027,
      });
      prisma.seedUser('plain');
      queue('kindred');
      queue('plain');
      expect(await roster('viewer')).toEqual(['kindred', 'plain']);

      // One pass: the score barely moves (rapport is one signal of twelve),
      // but the visibility drop takes them below a weaker match.
      passedOnViewer('kindred', 1);
      expect(await roster('viewer')).toEqual(['plain', 'kindred']);

      // Not hidden, not blocked: a request still goes through.
      queue('viewer');
      await expect(
        service.requestMatch('viewer', 'kindred'),
      ).resolves.toBeUndefined();
    });
  });

  describe('D4: the campus signal is the verified college, not the typed text', () => {
    const campusSignal = async (other: string) => {
      const explained = await service.explainRankingFor('viewer');
      const row = explained.candidates.find((c) => c.userId === other);
      return row?.detail.signals.find((s) => s.key === 'campus')?.value;
    };

    beforeEach(() => {
      queue('viewer', { campus: 'campus-a' });
      prisma.seedUser('other');
    });

    it('typing the same campus earns nothing when the colleges differ', async () => {
      prisma.seedAffiliation('other', 'college-b');
      queue('other', { campus: 'campus-a' });
      await expect(campusSignal('other')).resolves.toBe(0.15);
    });

    it('the same verified college counts, whatever was typed', async () => {
      queue('other', { campus: 'somewhere else entirely' });
      await expect(campusSignal('other')).resolves.toBe(1);
    });

    it('a revoked affiliation is no campus evidence at all', async () => {
      prisma.seedAffiliation('other', 'college-a', { revokedAt: new Date() });
      queue('other', { campus: 'campus-a' });
      await expect(campusSignal('other')).resolves.toBeNull();
    });
  });
});
