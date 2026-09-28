import { ForbiddenException } from '@nestjs/common';
import { MessagingCoreService } from './core/messaging-core.service';
import { stub } from '../common/testing/stub';
import type { PrismaService } from '../prisma/prisma.service';
import type { PresenceService } from '../presence/presence.service';
import type { DomainEventService } from '../events/domain-event.service';
import type { MentionsService } from '../mentions/mentions.service';
import type { BlocksService } from '../users/blocks.service';
import type { VerificationAccessService } from '../common/verification/verification-access.service';
import type { StudentYearPolicyService } from '../common/student-year/student-year-policy.service';
import type { RateLimitService } from '../common/rate-limit/rate-limit.service';

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

  /** What a refusal carries, as far as the client reads it. */
  type ErrorWithResponse = { getResponse?: () => { code?: string } };

  let service: MessagingCoreService;
  let prisma: {
    conversation: { findUnique: jest.Mock };
    message: { findFirst: jest.Mock; create?: jest.Mock };
  };
  let participants: ReturnType<typeof buildParticipant>[];

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
        findUnique: jest.fn(() =>
          Promise.resolve({
            id: CONV,
            publicId: CONV,
            name: null,
            type: 'DM',
            participants,
          }),
        ),
      },
      message: { findFirst: jest.fn(() => Promise.resolve(null)) },
    };

    service = new MessagingCoreService(
      stub<PrismaService>(prisma),
      stub<PresenceService>({
        getPresenceMany: jest.fn(() => Promise.resolve(new Map())),
      }),
      stub<DomainEventService>({ emit: jest.fn() }),
      stub<MentionsService>({ sanitize: jest.fn(() => Promise.resolve([])) }),
      stub<BlocksService>({
        getExcludedUserIds: jest.fn(() => Promise.resolve([])),
        getBlockedByUserIds: jest.fn(() => Promise.resolve([])),
      }),
      stub<VerificationAccessService>({
        isEnforcementEnabled: () => false,
        assertCanMessageInConversation: jest.fn(() => Promise.resolve()),
        isEligibleStatus: () => true,
      }),
      // First-year isolation is not what this fixture exercises; always allow.
      stub<StudentYearPolicyService>({
        isEnforcementEnabled: () => false,
        assertCanInteract: jest.fn(() => Promise.resolve()),
      }),
      // Rate limiting is not what this fixture exercises; always allow.
      stub<RateLimitService>({
        consumeAll: jest.fn(() => Promise.resolve({ allowed: true })),
        consume: jest.fn(() => Promise.resolve({ allowed: true })),
      }),
    );

    // The conversation id resolves to itself in this fixture.
    service.resolveConversationId = jest.fn(() => Promise.resolve(CONV));
  });

  it.each(['PENDING_DELETION', 'DELETED'])(
    'refuses a direct message when the only other participant is %s',
    async (status) => {
      participants[1] = buildParticipant(THEM, status);

      await expect(
        service.sendMessage(ME, CONV, { text: 'hello?' }),
      ).rejects.toThrow(ForbiddenException);
    },
  );

  it('carries a machine-readable code so the client can show the right notice', async () => {
    participants[1] = buildParticipant(THEM, 'DELETED');
    try {
      await service.sendMessage(ME, CONV, { text: 'hi' });
      throw new Error('should have been refused');
    } catch (err: unknown) {
      expect((err as ErrorWithResponse).getResponse?.()).toMatchObject({
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
      }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('refuses before any row is written', async () => {
    participants[1] = buildParticipant(THEM, 'DELETED');
    prisma.message.create = jest.fn();
    await service.sendMessage(ME, CONV, { text: 'hi' }).catch(() => {});
    expect(prisma.message.create).not.toHaveBeenCalled();
  });

  it('still allows a direct message to an active recipient', async () => {
    // Proves the gate is the deletion state and not an unconditional refusal.
    await service
      .sendMessage(ME, CONV, { text: 'hi' })
      .catch((err: unknown) => {
        expect(
          (err as ErrorWithResponse | undefined)?.getResponse?.()?.code,
        ).not.toBe('RECIPIENT_UNAVAILABLE');
      });
  });
});
