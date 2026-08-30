import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { VerificationStatus } from '@prisma/client';
import { DmService } from './dm/dm.service';
import { PrismaService } from '../prisma/prisma.service';
import { PresenceService } from '../presence/presence.service';
import { DomainEventService } from '../events/domain-event.service';
import { MentionsService } from '../mentions/mentions.service';
import { blocksServiceMockProvider } from '../users/testing/blocks.service.mock';
import { VerificationAccessService } from '../common/verification/verification-access.service';

/**
 * Messaging requires BOTH participants of a DM to be currently VERIFIED, and
 * the rule has to live below the transports: the REST controller has a guard,
 * but the Socket.IO `message:send` handler does not, an offline queue replays
 * long after the composer was rendered, and a stale tab still holds a
 * conversation id it was allowed to open an hour ago.
 *
 * These tests exercise the real policy service against the shared messaging
 * base class, so they fail if either the rule or the choke point moves.
 */
describe('messaging — both participants must be verified', () => {
  const ME = 'user-me';
  const THEM = 'user-them';

  let service: DmService;
  let prisma: any;

  const buildWith = async (statuses: Record<string, VerificationStatus>) => {
    prisma = {
      conversation: {
        findUnique: jest.fn(async () => ({
          id: 'conv-internal',
          publicId: 'conv-public',
          name: null,
          type: 'DM',
          participants: [
            { userId: ME, isMuted: false },
            { userId: THEM, isMuted: false },
          ],
        })),
        findFirst: jest.fn(async () => null),
      },
      conversationParticipant: { findMany: jest.fn(async () => []) },
      user: {
        findMany: jest.fn(async ({ where }: any) =>
          where.id.in
            .filter((id: string) => statuses[id])
            .map((id: string) => ({ id, verificationStatus: statuses[id] })),
        ),
        findUnique: jest.fn(async ({ where }: any) =>
          statuses[where.id]
            ? { id: where.id, verificationStatus: statuses[where.id] }
            : null,
        ),
      },
      message: { create: jest.fn() },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        VerificationAccessService,
        blocksServiceMockProvider(),
        DmService,
        { provide: PrismaService, useValue: prisma },
        { provide: PresenceService, useValue: { getPresence: jest.fn() } },
        { provide: DomainEventService, useValue: { emit: jest.fn() } },
        {
          provide: MentionsService,
          useValue: { sanitize: jest.fn(async () => []) },
        },
      ],
    }).compile();

    service = module.get(DmService);
    module.get(VerificationAccessService).invalidateAll();
  };

  const send = () => service.sendMessage(ME, 'conv-public', { text: 'hi' });

  it('refuses the send when the recipient is not verified', async () => {
    await buildWith({
      [ME]: VerificationStatus.VERIFIED,
      [THEM]: VerificationStatus.PENDING,
    });
    await expect(send()).rejects.toThrow(ForbiddenException);
    // Refused before anything was written.
    expect(prisma.message.create).not.toHaveBeenCalled();
  });

  it('refuses the send when the sender is not verified', async () => {
    await buildWith({
      [ME]: VerificationStatus.UNVERIFIED,
      [THEM]: VerificationStatus.VERIFIED,
    });
    await expect(send()).rejects.toThrow(
      'Account verification is required to perform this action.',
    );
    expect(prisma.message.create).not.toHaveBeenCalled();
  });

  it('does not disclose which side failed when it is the other person', async () => {
    await buildWith({
      [ME]: VerificationStatus.VERIFIED,
      [THEM]: VerificationStatus.REJECTED,
    });
    await expect(send()).rejects.toThrow(
      'This user is not available for messaging.',
    );
  });

  it('gets past the verification gate once both sides are verified', async () => {
    await buildWith({
      [ME]: VerificationStatus.VERIFIED,
      [THEM]: VerificationStatus.VERIFIED,
    });
    // The send proceeds past the gate and fails later, on the deliberately
    // unstubbed persistence — which is the assertion: the refusal above came
    // from verification, not from the incomplete Prisma double.
    await expect(send()).rejects.not.toThrow(
      'This user is not available for messaging.',
    );
  });
});

/**
 * A thread reached by a deep link, or one that has scrolled past the first page
 * of the conversation list, is not in that list — so the client had no way to
 * resolve the other participant and left the composer enabled until a send came
 * back refused. History is the one response every open thread fetches, so the
 * verdict travels on it.
 */
describe('conversation history carries the send verdict', () => {
  const ME = 'user-me';
  const THEM = 'user-them';

  const buildService = async (statuses: Record<string, VerificationStatus>) => {
    const prisma: any = {
      conversation: {
        findUnique: jest.fn(async () => ({
          id: 'conv-internal',
          type: 'DM',
          participants: [{ userId: ME }, { userId: THEM }],
        })),
        findFirst: jest.fn(async () => null),
      },
      conversationParticipant: {
        findFirst: jest.fn(async () => ({
          userId: ME,
          lastReadAt: null,
          clearedAt: null,
          leftAt: null,
        })),
        findMany: jest.fn(async () => [
          { userId: ME, lastReadAt: null, clearedAt: null, leftAt: null },
          { userId: THEM, lastReadAt: null, clearedAt: null, leftAt: null },
        ]),
      },
      deletedMessage: { findMany: jest.fn(async () => []) },
      message: { findMany: jest.fn(async () => []) },
      user: {
        findMany: jest.fn(async ({ where }: any) =>
          where.id.in
            .filter((id: string) => statuses[id])
            .map((id: string) => ({ id, verificationStatus: statuses[id] })),
        ),
        findUnique: jest.fn(async ({ where }: any) =>
          statuses[where.id]
            ? { id: where.id, verificationStatus: statuses[where.id] }
            : null,
        ),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        VerificationAccessService,
        blocksServiceMockProvider(),
        DmService,
        { provide: PrismaService, useValue: prisma },
        { provide: PresenceService, useValue: { getPresence: jest.fn() } },
        { provide: DomainEventService, useValue: { emit: jest.fn() } },
        {
          provide: MentionsService,
          useValue: { sanitize: jest.fn(async () => []) },
        },
      ],
    }).compile();

    module.get(VerificationAccessService).invalidateAll();
    return module.get(DmService);
  };

  it('reports false when the other participant is not verified', async () => {
    const service = await buildService({
      [ME]: VerificationStatus.VERIFIED,
      [THEM]: VerificationStatus.PENDING,
    });
    const history = await service.getConversationHistory('conv-internal', ME);
    expect(history.canSendMessages).toBe(false);
  });

  it('reports true when both sides are verified', async () => {
    const service = await buildService({
      [ME]: VerificationStatus.VERIFIED,
      [THEM]: VerificationStatus.VERIFIED,
    });
    const history = await service.getConversationHistory('conv-internal', ME);
    expect(history.canSendMessages).toBe(true);
  });

  it('reports false for an anonymous read rather than defaulting to allowed', async () => {
    const service = await buildService({
      [ME]: VerificationStatus.VERIFIED,
      [THEM]: VerificationStatus.VERIFIED,
    });
    const history = await service.getConversationHistory('conv-internal');
    expect(history.canSendMessages).toBe(false);
  });
});
