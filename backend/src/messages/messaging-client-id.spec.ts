import { MessagingCoreService } from './core/messaging-core.service';
import { stub } from '../common/testing/stub';
import type { PrismaService } from '../prisma/prisma.service';
import type { PresenceService } from '../presence/presence.service';
import type { DomainEventService } from '../events/domain-event.service';
import type { MentionsService } from '../mentions/mentions.service';
import type { BlocksService } from '../users/blocks.service';
import type { VerificationAccessService } from '../common/verification/verification-access.service';
import type { RateLimitService } from '../common/rate-limit/rate-limit.service';

/**
 * A retried send through the DM / group REST routes delivers one message.
 *
 * Those routes land in `MessagingCoreService.sendMessage`, which used to
 * neither look for nor store `clientMessageId` — unlike the socket path — so
 * every retry of a send whose response was lost inserted another copy, and
 * notified anyone it mentioned again.
 */
describe('MessagingCoreService — one message per client id', () => {
  const ME = 'me-1';
  const CONV = 'conv-1';

  const sender = {
    id: ME,
    username: 'me',
    displayName: 'Me',
    avatar: null,
    accountStatus: 'ACTIVE',
    deletedAt: null,
  };
  const row = (id: string) => ({
    id,
    conversationId: CONV,
    senderId: ME,
    createdAt: new Date('2026-10-01T12:00:00Z'),
    payload: { text: 'hi' },
    state: 'NORMAL',
    type: 'TEXT',
    replyTo: null,
    sender,
  });

  let service: MessagingCoreService;
  let findFirst: jest.Mock;
  let create: jest.Mock;
  let transaction: jest.Mock;
  let persistAndNotify: jest.Mock;

  beforeEach(() => {
    findFirst = jest.fn(() => Promise.resolve(null));
    create = jest.fn(() => 'create-op');
    transaction = jest.fn(() => Promise.resolve([row('new-msg')]));
    persistAndNotify = jest.fn(() => Promise.resolve());
    const prisma = {
      conversation: {
        findUnique: jest.fn(() =>
          Promise.resolve({
            id: CONV,
            publicId: CONV,
            name: null,
            type: 'DM',
            participants: [
              {
                userId: ME,
                isMuted: false,
                user: { accountStatus: 'ACTIVE', deletedAt: null },
              },
              {
                userId: 'them',
                isMuted: false,
                user: { accountStatus: 'ACTIVE', deletedAt: null },
              },
            ],
          }),
        ),
        update: jest.fn(() => 'update-op'),
      },
      conversationParticipant: { updateMany: jest.fn(() => 'participants-op') },
      message: { findFirst, create },
      $transaction: transaction,
    };

    service = new MessagingCoreService(
      stub<PrismaService>(prisma),
      stub<PresenceService>({
        getPresenceMany: jest.fn(() => Promise.resolve(new Map())),
      }),
      stub<DomainEventService>({ emit: jest.fn() }),
      stub<MentionsService>({
        sanitize: jest.fn(() =>
          Promise.resolve([{ userId: 'them', username: 'them' }]),
        ),
        persistAndNotify,
      }),
      stub<BlocksService>({
        getExcludedUserIds: jest.fn(() => Promise.resolve([])),
        getBlockedByUserIds: jest.fn(() => Promise.resolve([])),
      }),
      stub<VerificationAccessService>({
        isEnforcementEnabled: () => false,
        assertCanMessageInConversation: jest.fn(() => Promise.resolve()),
        isEligibleStatus: () => true,
      }),
      stub<RateLimitService>({
        consumeAll: jest.fn(() => Promise.resolve({ allowed: true })),
        consume: jest.fn(() => Promise.resolve({ allowed: true })),
      }),
    );
    service.resolveConversationId = jest.fn(() => Promise.resolve(CONV));
  });

  it('returns the original for a retry and writes nothing', async () => {
    findFirst.mockImplementation(
      (args: { where: { clientMessageId?: string } }) =>
        Promise.resolve(
          args.where.clientMessageId === 'c-1' ? row('first-msg') : null,
        ),
    );
    const res = await service.sendMessage(ME, CONV, {
      text: 'hi',
      clientId: 'c-1',
    });
    expect(res.id).toBe('first-msg');
    expect(transaction).not.toHaveBeenCalled();
    expect(persistAndNotify).not.toHaveBeenCalled();
    // Nobody is notified a second time by the controller's fan-out.
    expect(res.recipientIds).toEqual([]);
    expect(res.unmutedRecipientIds).toEqual([]);
  });

  it('stores the client id on a first send, so a retry can find it', async () => {
    const res = await service.sendMessage(ME, CONV, {
      text: 'hi',
      clientId: 'c-2',
    });
    expect(res.id).toBe('new-msg');
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ clientMessageId: 'c-2' }) as unknown,
      }),
    );
  });

  it('still sends normally without a client id', async () => {
    const res = await service.sendMessage(ME, CONV, { text: 'hi' });
    expect(res.id).toBe('new-msg');
    expect(transaction).toHaveBeenCalledTimes(1);
  });
});
