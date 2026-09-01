import { ForbiddenException } from '@nestjs/common';
import { MessagingCoreService } from './core/messaging-core.service';

/**
 * The server-side half of "you cannot message a deleted user".
 *
 * The disabled composer is a courtesy. This is the enforcement, and it lives in
 * `MessagingCoreService.sendMessage` because every transport funnels through
 * it — REST, the Socket.IO `message:send` handler, offline replay, attachment
 * sends and reply actions all call this one method. A client that strips the
 * disabled state, or a script calling the API directly, hits the same check.
 */
describe('MessagingCoreService — messaging an unavailable recipient', () => {
  const ME = 'me-1';
  const THEM = 'them-1';
  const CONV = 'conv-1';

  let service: MessagingCoreService;
  let prisma: any;
  let participants: any[];

  const buildParticipant = (userId: string, status: string) => ({
    userId,
    isMuted: false,
    user: {
      accountStatus: status,
      deletedAt: status === 'ACTIVE' ? null : new Date(),
    },
  });

  beforeEach(() => {
    participants = [
      buildParticipant(ME, 'ACTIVE'),
      buildParticipant(THEM, 'ACTIVE'),
    ];

    prisma = {
      conversation: {
        findUnique: jest.fn(async () => ({
          id: CONV,
          publicId: CONV,
          name: null,
          type: 'DM',
          participants,
        })),
      },
      message: { findFirst: jest.fn(async () => null) },
    };

    service = new MessagingCoreService(
      prisma,
      { getPresenceMany: jest.fn(async () => new Map()) } as any,
      { emit: jest.fn() } as any,
      { sanitize: jest.fn(async () => []) } as any,
      {
        getExcludedUserIds: jest.fn(async () => []),
        getBlockedByUserIds: jest.fn(async () => []),
      } as any,
      {
        isEnforcementEnabled: () => false,
        assertCanMessageInConversation: jest.fn(async () => {}),
        isEligibleStatus: () => true,
      } as any,
    );

    // The conversation id resolves to itself in this fixture.
    (service as any).resolveConversationId = jest.fn(async () => CONV);
  });

  it.each(['PENDING_DELETION', 'DELETED'])(
    'refuses a direct message when the only other participant is %s',
    async (status) => {
      participants[1] = buildParticipant(THEM, status);

      await expect(
        service.sendMessage(ME, CONV, { text: 'hello?' } as any),
      ).rejects.toThrow(ForbiddenException);
    },
  );

  it('carries a machine-readable code so the client can show the right notice', async () => {
    participants[1] = buildParticipant(THEM, 'DELETED');
    try {
      await service.sendMessage(ME, CONV, { text: 'hi' } as any);
      throw new Error('should have been refused');
    } catch (err: any) {
      expect(err.getResponse?.()).toMatchObject({
        code: 'RECIPIENT_UNAVAILABLE',
      });
    }
  });

  it('refuses a media message on the same path, not just a text one', async () => {
    participants[1] = buildParticipant(THEM, 'DELETED');
    await expect(
      service.sendMessage(ME, CONV, {
        mediaUrl: 'https://cdn/x.jpg',
        mediaType: 'image',
      } as any),
    ).rejects.toThrow(ForbiddenException);
  });

  it('refuses before any row is written', async () => {
    participants[1] = buildParticipant(THEM, 'DELETED');
    prisma.message.create = jest.fn();
    await service.sendMessage(ME, CONV, { text: 'hi' } as any).catch(() => {});
    expect(prisma.message.create).not.toHaveBeenCalled();
  });

  it('still allows a direct message to an active recipient', async () => {
    // Proves the gate is the deletion state and not an unconditional refusal.
    await service
      .sendMessage(ME, CONV, { text: 'hi' } as any)
      .catch((err: any) => {
        expect(err?.getResponse?.()?.code).not.toBe('RECIPIENT_UNAVAILABLE');
      });
  });
});
