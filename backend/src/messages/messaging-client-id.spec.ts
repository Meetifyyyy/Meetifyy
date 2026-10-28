import { Prisma } from '@prisma/client';
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
  let emit: jest.Mock<Promise<void>, [string, unknown, string[]?]>;
  let blockedByMe: string[];

  beforeEach(() => {
    findFirst = jest.fn(() => Promise.resolve(null));
    create = jest.fn(() => 'create-op');
    transaction = jest.fn(() => Promise.resolve([row('new-msg')]));
    persistAndNotify = jest.fn(() => Promise.resolve());
    emit = jest.fn((_type: string, _data: unknown, _targets?: string[]) =>
      Promise.resolve(),
    );
    blockedByMe = [];
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
                deletedAt: null,
                user: { accountStatus: 'ACTIVE', deletedAt: null },
              },
              // They hid the chat; a new message brings it back for them.
              {
                userId: 'them',
                isMuted: false,
                deletedAt: new Date('2026-09-30T00:00:00Z'),
                user: { accountStatus: 'ACTIVE', deletedAt: null },
              },
            ],
          }),
        ),
        update: jest.fn(() => 'update-op'),
      },
      conversationParticipant: {
        updateMany: jest.fn(() => 'participants-op'),
        // The in-transaction membership re-check (see sendMessageOnce).
        update: jest.fn(() => 'membership-op'),
      },
      message: { findFirst, create },
      $transaction: transaction,
    };

    service = new MessagingCoreService(
      stub<PrismaService>(prisma),
      stub<PresenceService>({
        getPresenceMany: jest.fn(() => Promise.resolve(new Map())),
      }),
      stub<DomainEventService>({ emit }),
      stub<MentionsService>({
        sanitize: jest.fn(() =>
          Promise.resolve([{ userId: 'them', username: 'them' }]),
        ),
        persistAndNotify,
      }),
      stub<BlocksService>({
        getExcludedUserIds: jest.fn(() => Promise.resolve(blockedByMe)),
        getBlockedByUserIds: jest.fn(() => Promise.resolve(blockedByMe)),
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

  it('has the members a send brings back join its rooms; a retry announces nothing', async () => {
    const revivals = () =>
      emit.mock.calls.filter(([type]) => type === 'conversation:revived');
    await service.sendMessage(ME, CONV, { text: 'hi', clientId: 'c-9' });
    expect(revivals()).toEqual([
      [
        'conversation:revived',
        {
          conversationId: CONV,
          publicId: CONV,
          internalId: CONV,
          userIds: ['them'],
        },
        ['them'],
      ],
    ]);

    emit.mockClear();
    findFirst.mockImplementation(() => Promise.resolve(row('new-msg')));
    await service.sendMessage(ME, CONV, { text: 'hi', clientId: 'c-9' });
    expect(revivals()).toEqual([]);
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

  it('returns a message that already landed even if the thread has since closed', async () => {
    // The ack was lost, then the sender blocked the recipient. The retry must
    // still get its message back, not "Not delivered" for a delivered message.
    findFirst.mockImplementation(
      (args: { where: { clientMessageId?: string } }) =>
        Promise.resolve(
          args.where.clientMessageId === 'c-3' ? row('landed') : null,
        ),
    );
    blockedByMe = ['them'];
    const res = await service.sendMessage(ME, CONV, {
      text: 'hi',
      clientId: 'c-3',
    });
    expect(res.id).toBe('landed');
    expect(transaction).not.toHaveBeenCalled();
  });

  it('still refuses a NEW send into a closed thread', async () => {
    blockedByMe = ['them'];
    await expect(
      service.sendMessage(ME, CONV, { text: 'hi', clientId: 'c-4' }),
    ).rejects.toThrow();
  });

  it('refuses a send whose sender was removed while it was in flight', async () => {
    // The membership check before the transaction passed; the removal then
    // committed, so the in-transaction re-check matches no row (P2025) and
    // the insert rolls back with it.
    transaction.mockImplementationOnce(() =>
      Promise.reject(
        new Prisma.PrismaClientKnownRequestError('No record found', {
          code: 'P2025',
          clientVersion: 'test',
        }),
      ),
    );
    await expect(
      service.sendMessage(ME, CONV, { text: 'hi', clientId: 'c-6' }),
    ).rejects.toMatchObject({ response: { code: 'NOT_A_MEMBER' } });
    expect(persistAndNotify).not.toHaveBeenCalled();
  });

  it('refuses a client id already used in another conversation, instead of looping', async () => {
    findFirst.mockImplementation(() =>
      Promise.resolve({ ...row('elsewhere'), conversationId: 'other-conv' }),
    );
    await expect(
      service.sendMessage(ME, CONV, { text: 'hi', clientId: 'c-5' }),
    ).rejects.toThrow('Message id already used');
    expect(transaction).not.toHaveBeenCalled();
  });
});
