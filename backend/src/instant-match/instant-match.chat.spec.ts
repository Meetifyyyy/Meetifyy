import { ForbiddenException } from '@nestjs/common';
import {
  InstantMatchService,
  setRealtimeGatewayRef,
} from './instant-match.service';
import { PrismaFake } from './testing/prisma-fake';
import { createVerificationAccessMock } from '../common/verification/testing/verification-access.mock';

/**
 * The dedicated 24h Instant Match chat.
 *
 * The product rule these all serve: the chat ends permanently when either
 * user leaves or the window closes, and the *backend* is what enforces that.
 * A client's countdown is presentation; a client's disabled input is a
 * courtesy. Every test here is written from the server's point of view,
 * because that is the only place the guarantee can actually live.
 */
describe('Instant Match chat lifecycle', () => {
  let prisma: PrismaFake;
  let service: InstantMatchService;
  let emitter: any;
  let messages: any;

  const HOUR = 60 * 60 * 1000;

  /** An accepted match with a live chat, as `acceptSession` leaves it. */
  const seedChat = (over: Record<string, any> = {}) => {
    const row = {
      id: 'm1',
      userAId: 'alice',
      userBId: 'bob',
      activity: 'study',
      status: 'ACCEPTED',
      aAccepted: true,
      bAccepted: true,
      conversationId: 'conv-1',
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
      chatStatus: 'ACTIVE',
      chatExpiresAt: new Date(Date.now() + 24 * HOUR),
      endedById: null,
      endedAt: null,
      matchReason: 'study',
      snapshotA: null,
      snapshotB: null,
      ...over,
    };
    prisma.sessions.push(row);
    return row;
  };

  beforeEach(() => {
    prisma = new PrismaFake();
    prisma.seedUser('alice');
    prisma.seedUser('bob');
    messages = {
      createInstantMatchConversation: jest.fn(),
      registerInstantMatchGuard: jest.fn(),
    };
    emitter = {
      emitMatchFound: jest.fn(),
      emitMatchAccepted: jest.fn(),
      emitMatchDeclined: jest.fn(),
      emitSearchResumed: jest.fn(),
      emitQueueStats: jest.fn(),
      emitInstantMatchChatEnded: jest.fn(),
    };
    setRealtimeGatewayRef(emitter);
    service = new InstantMatchService(
      prisma as any,
      messages,
      blocksStubFor(prisma),
      createVerificationAccessMock() as any,
    );
  });

  afterEach(() => setRealtimeGatewayRef(null));

  // ── Active state ───────────────────────────────────────────────────────────

  describe('getActiveChatSession', () => {
    it('returns the live chat for either participant', async () => {
      seedChat();
      expect(await service.getActiveChatSession('alice')).toMatchObject({
        id: 'm1',
      });
      expect(await service.getActiveChatSession('bob')).toMatchObject({
        id: 'm1',
      });
    });

    it('returns nothing for someone who is not in it', async () => {
      seedChat();
      expect(await service.getActiveChatSession('carol')).toBeNull();
    });

    it('ignores a match that never opened a chat', async () => {
      seedChat({ conversationId: null });
      expect(await service.getActiveChatSession('alice')).toBeNull();
    });
  });

  // ── Leaving ────────────────────────────────────────────────────────────────

  describe('leaving', () => {
    it('records who left and when', async () => {
      seedChat();
      const { ended } = await service.leaveChatSession('alice');

      expect(ended).toBe(true);
      expect(prisma.sessions[0]).toMatchObject({
        chatStatus: 'ENDED_BY_USER',
        endedById: 'alice',
      });
      expect(prisma.sessions[0].endedAt).toBeInstanceOf(Date);
    });

    it('tells each side what happened from their own point of view', async () => {
      seedChat();
      await service.leaveChatSession('alice');

      const byUser = new Map(
        emitter.emitInstantMatchChatEnded.mock.calls.map((c: any[]) => [
          c[0],
          c[1],
        ]),
      );
      // The distinction the UI turns into two different screens — computing
      // it here means the client never has to get an id comparison right.
      expect(byUser.get('alice')).toMatchObject({
        endReason: 'you_left',
        isActive: false,
      });
      expect(byUser.get('bob')).toMatchObject({
        endReason: 'they_left',
        isActive: false,
      });
    });

    it('leaves no active chat behind for either user', async () => {
      seedChat();
      await service.leaveChatSession('alice');

      expect(await service.getActiveChatSession('alice')).toBeNull();
      expect(await service.getActiveChatSession('bob')).toBeNull();
    });

    it('refuses a stranger holding a match id', async () => {
      seedChat();
      await expect(service.leaveChatSession('carol', 'm1')).rejects.toThrow(
        ForbiddenException,
      );
      expect(prisma.sessions[0].chatStatus).toBe('ACTIVE');
    });

    describe('when both users leave at once', () => {
      it('records exactly one leaver', async () => {
        seedChat();
        await Promise.all([
          service.leaveChatSession('alice'),
          service.leaveChatSession('bob'),
        ]);

        // The conditional update is the gate: whoever loses the race must not
        // overwrite the winner's record of who walked away.
        expect(prisma.sessions[0].chatStatus).toBe('ENDED_BY_USER');
        expect(['alice', 'bob']).toContain(prisma.sessions[0].endedById);
        expect(
          prisma.sessions.filter((s: any) => s.chatStatus === 'ENDED_BY_USER'),
        ).toHaveLength(1);
      });

      it('notifies once, not twice per user', async () => {
        seedChat();
        await Promise.all([
          service.leaveChatSession('alice'),
          service.leaveChatSession('bob'),
        ]);
        // One transition, one notification per participant — a second
        // "they left" banner would be a visible bug.
        expect(emitter.emitInstantMatchChatEnded).toHaveBeenCalledTimes(2);
      });
    });

    it('is idempotent under a double tap', async () => {
      seedChat();
      const first = await service.leaveChatSession('alice');
      const second = await service.leaveChatSession('alice');

      expect(first.ended).toBe(true);
      // The second call did nothing, but still answers with the true state
      // rather than an error — from the user's side the chat did end.
      expect(second.ended).toBe(false);
      expect(second.session).toMatchObject({
        endReason: 'you_left',
        isActive: false,
      });
      expect(emitter.emitInstantMatchChatEnded).toHaveBeenCalledTimes(2);
    });
  });

  // ── Expiry ─────────────────────────────────────────────────────────────────

  describe('expiry', () => {
    it('treats a chat past its window as gone, even before the sweep runs', async () => {
      seedChat({ chatExpiresAt: new Date(Date.now() - 1000) });

      // The lazy reconcile: an offline user returning must never be handed a
      // chat the clock says is dead and the row still calls alive.
      expect(await service.getActiveChatSession('alice')).toBeNull();
      expect(prisma.sessions[0].chatStatus).toBe('EXPIRED');
    });

    it('reports expiry as its own ending, distinct from someone leaving', async () => {
      seedChat({ chatExpiresAt: new Date(Date.now() - 1000) });
      const state = await service.getChatStateFor('alice');

      expect(state).toMatchObject({
        status: 'EXPIRED',
        endReason: 'expired',
        isActive: false,
      });
      expect(state?.endedById).toBeNull();
    });

    it('does not re-expire a chat someone already left', async () => {
      seedChat({
        chatStatus: 'ENDED_BY_USER',
        endedById: 'bob',
        endedAt: new Date(),
      });
      await service.expireStaleChats();

      expect(prisma.sessions[0].chatStatus).toBe('ENDED_BY_USER');
      expect(prisma.sessions[0].endedById).toBe('bob');
    });

    it('sweeps every chat whose window has closed', async () => {
      seedChat({ chatExpiresAt: new Date(Date.now() - 1000) });
      seedChat({
        id: 'm2',
        userAId: 'carol',
        userBId: 'dave',
        chatExpiresAt: new Date(Date.now() - 1),
      });
      seedChat({ id: 'm3', userAId: 'erin', userBId: 'frank' });

      expect(await service.expireStaleChats()).toBe(2);
      expect(prisma.sessions.map((s: any) => s.chatStatus)).toEqual([
        'EXPIRED',
        'EXPIRED',
        'ACTIVE',
      ]);
    });
  });

  // ── Returning to the app ───────────────────────────────────────────────────

  describe('state on return', () => {
    it('shows the remaining user that the other person left', async () => {
      seedChat();
      await service.leaveChatSession('alice');

      // Bob may have been offline and missed the event entirely; the row is
      // what tells him, not the socket.
      expect(await service.getChatStateFor('bob')).toMatchObject({
        endReason: 'they_left',
        endedById: 'alice',
        isActive: false,
      });
    });

    it('does not show the leaver their old match as active', async () => {
      seedChat();
      await service.leaveChatSession('alice');
      expect(await service.getChatStateFor('alice')).toMatchObject({
        endReason: 'you_left',
        isActive: false,
      });
    });

    it('carries the deadline and the match reason for the chat header', async () => {
      seedChat();
      const state = await service.getChatStateFor('alice');
      expect(state).toMatchObject({
        matchReason: 'study',
        otherUserId: 'bob',
        isActive: true,
      });
      expect(state?.expiresAt).toBeGreaterThan(Date.now());
    });

    it('reports nothing at all when the user has never matched', async () => {
      expect(await service.getChatStateFor('alice')).toBeNull();
    });
  });

  // ── One match at a time ────────────────────────────────────────────────────

  describe('one active match per user', () => {
    const joinDto = (userId: string) => ({
      userId,
      campus: 'campus-a',
      activity: 'study',
      timePreference: 'now',
      optionalDetail: null,
      area: null,
      gps: null,
    });

    it('refuses to queue a user who already has a live chat', async () => {
      seedChat();
      // Two live chats cannot both be "your Instant Match" — the UI models
      // exactly one, and the product rule says exactly one.
      await expect(service.joinQueue(joinDto('alice') as any)).rejects.toThrow(
        /already have an Instant Match/i,
      );
      expect(prisma.queue).toHaveLength(0);
    });

    it('lets them search again once they leave', async () => {
      seedChat();
      await service.leaveChatSession('alice');
      await expect(
        service.joinQueue(joinDto('alice') as any),
      ).resolves.toBeUndefined();
      expect(prisma.queue).toHaveLength(1);
    });

    it('lets them search again once the window closes', async () => {
      seedChat({ chatExpiresAt: new Date(Date.now() - 1) });
      await expect(
        service.joinQueue(joinDto('alice') as any),
      ).resolves.toBeUndefined();
      expect(prisma.queue).toHaveLength(1);
    });
  });

  // ── Teardown ───────────────────────────────────────────────────────────────

  /**
   * The rule these serve: an ended session's transcript is *gone*, not hidden.
   *
   * Hiding it on the client left the rows queryable by anything that reached
   * the conversation directly, which is how two people who matched, talked,
   * ended the session and matched again were dropped back into the previous
   * conversation with the previous messages still in it.
   */
  describe('when a session ends', () => {
    const seedChatWithMessages = () => {
      const session = seedChat();
      prisma.seedConversation('conv-1', { status: 'ACTIVE' });
      prisma.messages.push(
        { id: 'msg-1', conversationId: 'conv-1', senderId: 'alice' },
        { id: 'msg-2', conversationId: 'conv-1', senderId: 'bob' },
        // A message in someone else's conversation, to prove the delete is
        // scoped to this session's chat and not to the pair.
        { id: 'msg-other', conversationId: 'conv-2', senderId: 'alice' },
      );
      prisma.participants.push(
        { userId: 'alice', conversationId: 'conv-1', unreadCount: 3 },
        { userId: 'bob', conversationId: 'conv-1', unreadCount: 1 },
      );
      return session;
    };

    it('deletes the messages of the session that ended, and only those', async () => {
      seedChatWithMessages();

      await service.leaveChatSession('alice');

      expect(prisma.messages.map((m) => m.id)).toEqual(['msg-other']);
    });

    it('closes the conversation so no window-based query still calls it live', async () => {
      seedChatWithMessages();

      await service.leaveChatSession('alice');

      const conv = prisma.conversations.find((c) => c.id === 'conv-1');
      expect(conv).toMatchObject({ status: 'ENDED' });
      expect(conv?.expiresAt?.getTime()).toBeLessThanOrEqual(Date.now());
    });

    it('clears both participants\' unread counts, so no badge outlives the session', async () => {
      seedChatWithMessages();

      await service.leaveChatSession('alice');

      expect(prisma.participants.map((p) => p.unreadCount)).toEqual([0, 0]);
    });

    it('tears the chat down the same way when the window closes', async () => {
      seedChatWithMessages();
      prisma.sessions[0].chatExpiresAt = new Date(Date.now() - 1);

      await service.getChatStateFor('alice');

      expect(prisma.messages.map((m) => m.id)).toEqual(['msg-other']);
      expect(prisma.conversations[0].status).toBe('ENDED');
    });
  });

  // ── Read authorization ─────────────────────────────────────────────────────

  describe('canReadChat', () => {
    it('allows a participant while the session is live', async () => {
      seedChat();
      expect(await service.canReadChat('alice', 'conv-1')).toBe(true);
    });

    it('refuses a non-participant who knows the conversation id', async () => {
      seedChat();
      expect(await service.canReadChat('carol', 'conv-1')).toBe(false);
    });

    it('refuses both sides once someone has left', async () => {
      seedChat();
      await service.leaveChatSession('alice');

      // This is the safeguard that makes a stale client harmless: whatever a
      // tab still holds, the history it asks for comes back empty.
      expect(await service.canReadChat('alice', 'conv-1')).toBe(false);
      expect(await service.canReadChat('bob', 'conv-1')).toBe(false);
    });

    it('refuses once the window has closed, and records the expiry', async () => {
      seedChat({ chatExpiresAt: new Date(Date.now() - 1) });
      expect(await service.canReadChat('alice', 'conv-1')).toBe(false);
      expect(prisma.sessions[0].chatStatus).toBe('EXPIRED');
    });

    it('refuses a conversation with no session behind it', async () => {
      expect(await service.canReadChat('alice', 'conv-ghost')).toBe(false);
    });
  });

  // ── Unread ─────────────────────────────────────────────────────────────────

  describe('unread count', () => {
    it('reports the viewer\'s own count for the live session', async () => {
      seedChat();
      prisma.participants.push(
        { userId: 'alice', conversationId: 'conv-1', unreadCount: 2 },
        { userId: 'bob', conversationId: 'conv-1', unreadCount: 0 },
      );

      expect(await service.getChatStateFor('alice')).toMatchObject({
        unreadCount: 2,
      });
      expect(await service.getChatStateFor('bob')).toMatchObject({
        unreadCount: 0,
      });
    });

    it('reports none for a session that has ended', async () => {
      seedChat();
      prisma.seedConversation('conv-1', { status: 'ACTIVE' });
      prisma.participants.push({
        userId: 'bob',
        conversationId: 'conv-1',
        unreadCount: 5,
      });

      await service.leaveChatSession('alice');

      // Both halves matter: the row was zeroed by the teardown, and an ended
      // state never carries a count regardless.
      expect(await service.getChatStateFor('bob')).toMatchObject({
        isActive: false,
        unreadCount: 0,
      });
    });
  });

  // ── Write authorization ────────────────────────────────────────────────────

  describe('assertCanSendInChat', () => {
    it('allows a participant inside a live chat', async () => {
      seedChat();
      await expect(
        service.assertCanSendInChat('alice', 'conv-1'),
      ).resolves.toBeUndefined();
    });

    it('refuses a non-participant who knows the conversation id', async () => {
      seedChat();
      await expect(
        service.assertCanSendInChat('carol', 'conv-1'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('refuses both sides once someone has left', async () => {
      seedChat();
      await service.leaveChatSession('alice');

      // The stale-tab case: neither client may write, whatever its own UI
      // still believes.
      await expect(
        service.assertCanSendInChat('alice', 'conv-1'),
      ).rejects.toThrow(/left/i);
      await expect(
        service.assertCanSendInChat('bob', 'conv-1'),
      ).rejects.toThrow(/left/i);
    });

    it('refuses a message that arrives after the window closes', async () => {
      seedChat({ chatExpiresAt: new Date(Date.now() - 1) });
      // Sent one millisecond late by a client whose countdown had not ticked
      // over yet: the row decides, not the sender.
      await expect(
        service.assertCanSendInChat('alice', 'conv-1'),
      ).rejects.toThrow(/expired/i);
      expect(prisma.sessions[0].chatStatus).toBe('EXPIRED');
    });

    it('refuses a conversation with no session behind it', async () => {
      await expect(
        service.assertCanSendInChat('alice', 'conv-ghost'),
      ).rejects.toThrow(ForbiddenException);
    });
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
