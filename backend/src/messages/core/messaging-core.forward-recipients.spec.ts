import { MessagingCoreService } from './messaging-core.service';
import { stub } from '../../common/testing/stub';
import type { PrismaService } from '../../prisma/prisma.service';
import type { BlocksService } from '../../users/blocks.service';

/**
 * Who a forwarded message is pushed to.
 *
 * Leaving or being removed from a group sets `leftAt` and leaves `deletedAt`
 * null, so a list built from `deletedAt: null` alone kept former members in
 * and their devices kept receiving forwarded content.
 */
describe('MessagingCoreService.getBatchUnblockedAndUnmutedParticipants', () => {
  const CONV = 'conv-1';
  const SENDER = 'sender';

  type Row = {
    userId: string;
    isMuted: boolean;
    leftAt: Date | null;
    deletedAt: Date | null;
  };
  type Where = { conversationId: string; deletedAt?: null; leftAt?: null };

  const rows: Row[] = [
    { userId: SENDER, isMuted: false, leftAt: null, deletedAt: null },
    { userId: 'active', isMuted: false, leftAt: null, deletedAt: null },
    { userId: 'muted', isMuted: true, leftAt: null, deletedAt: null },
    { userId: 'former', isMuted: false, leftAt: new Date(), deletedAt: null },
  ];

  const build = () => {
    // Applies the where clause it is given, so the former member only drops
    // out if the query actually asks for active rows.
    const findMany = jest.fn(({ where }: { where: Where }) =>
      Promise.resolve(
        rows.filter(
          (r) =>
            (where.deletedAt !== null || r.deletedAt === null) &&
            (where.leftAt !== null || r.leftAt === null),
        ),
      ),
    );
    const service = Object.create(
      MessagingCoreService.prototype,
    ) as MessagingCoreService;
    Object.assign(service, {
      prisma: stub<PrismaService>({ conversationParticipant: { findMany } }),
      blocksService: stub<BlocksService>({
        filterBlockedUsers: (_sender: string, ids: string[]) =>
          Promise.resolve(ids),
      }),
      resolveConversationId: jest.fn(() => Promise.resolve(CONV)),
    });
    return { service, findMany };
  };

  it('asks only for participants who are still members', async () => {
    const { service, findMany } = build();

    await service.getBatchUnblockedAndUnmutedParticipants(CONV, SENDER);

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { conversationId: CONV, deletedAt: null, leftAt: null },
      }),
    );
  });

  it('leaves a former member out of the recipients', async () => {
    const { service } = build();

    const { recipientIds, unmutedRecipientIds } =
      await service.getBatchUnblockedAndUnmutedParticipants(CONV, SENDER);

    expect(recipientIds).toEqual(['active', 'muted']);
    expect(recipientIds).not.toContain('former');
    expect(unmutedRecipientIds).toEqual(['active']);
  });
});
