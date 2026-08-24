import { NotFoundException } from '@nestjs/common';
import { BlocksService } from './blocks.service';

/**
 * Covers the three helpers every other service is expected to filter through.
 *
 * Each test uses distinct user ids: BlocksService caches per user in a static
 * map, so reusing an id across tests would serve a previous test's answer.
 */
describe('BlocksService', () => {
  const makeService = (blocks: { blockerId: string; blockedId: string }[]) => {
    const prisma = {
      block: {
        findMany: jest.fn(async ({ where }: any) => {
          // getBlockedByUserIds asks for one direction; the mutual read uses OR.
          if (where.OR) {
            const userId = where.OR[0].blockerId;
            return blocks.filter((b) => b.blockerId === userId || b.blockedId === userId);
          }
          return blocks.filter((b) => b.blockerId === where.blockerId);
        }),
        deleteMany: jest.fn(async ({ where }: any) => ({
          count: blocks.filter(
            (b) => b.blockerId === where.blockerId && b.blockedId === where.blockedId,
          ).length,
        })),
      },
    };
    return new BlocksService(prisma as any);
  };

  describe('isBlocked', () => {
    it('is true for the user who pressed block', async () => {
      const service = makeService([{ blockerId: 'a1', blockedId: 'b1' }]);
      expect(await service.isBlocked('a1', 'b1')).toBe(true);
    });

    it('is true for the blocked user too — the effect is mutual', async () => {
      const service = makeService([{ blockerId: 'a2', blockedId: 'b2' }]);
      expect(await service.isBlocked('b2', 'a2')).toBe(true);
    });

    it('is false between unrelated users', async () => {
      const service = makeService([{ blockerId: 'a3', blockedId: 'b3' }]);
      expect(await service.isBlocked('a3', 'c3')).toBe(false);
    });

    it('never reports a user as blocking themselves', async () => {
      const service = makeService([]);
      expect(await service.isBlocked('a4', 'a4')).toBe(false);
    });
  });

  describe('filterBlockedUsers', () => {
    it('drops both directions and keeps the caller ordering', async () => {
      const service = makeService([
        { blockerId: 'a5', blockedId: 'b5' },
        { blockerId: 'c5', blockedId: 'a5' },
      ]);
      expect(await service.filterBlockedUsers('a5', ['d5', 'b5', 'e5', 'c5'])).toEqual(['d5', 'e5']);
    });

    it('passes the list straight through for an anonymous viewer', async () => {
      const service = makeService([{ blockerId: 'a6', blockedId: 'b6' }]);
      expect(await service.filterBlockedUsers(null, ['a6', 'b6'])).toEqual(['a6', 'b6']);
    });
  });

  describe('future surfaces that must not bypass the service', () => {
    // Marked todo so it shows up in every run as an unmet obligation rather
    // than quietly disappearing. Turn it into a real test when the endpoint
    // lands. See audit finding 6.6.
    it.todo('community member search — must use filterBlockedUsers when implemented');
  });

  describe('injectBlockFilter', () => {
    it('composes with an existing constraint on the same field instead of replacing it', async () => {
      const service = makeService([{ blockerId: 'a7', blockedId: 'b7' }]);
      const where = await service.injectBlockFilter('a7', { id: { not: 'a7' }, accountStatus: 'ACTIVE' }, 'id');

      // The self-exclusion must survive: assigning onto `id` would have dropped it.
      expect(where.id).toEqual({ not: 'a7' });
      expect(where.AND).toEqual([{ id: { notIn: ['b7'] } }]);
    });

    it('appends to an existing AND rather than overwriting it', async () => {
      const service = makeService([{ blockerId: 'a8', blockedId: 'b8' }]);
      const where = await service.injectBlockFilter('a8', { AND: [{ deletedAt: null }] }, 'authorId');
      expect(where.AND).toEqual([{ deletedAt: null }, { authorId: { notIn: ['b8'] } }]);
    });

    it('leaves the query untouched when there is nothing to exclude', async () => {
      const service = makeService([]);
      const input = { deletedAt: null };
      expect(await service.injectBlockFilter('a9', input, 'authorId')).toEqual(input);
    });

    it('leaves the query untouched for an anonymous viewer', async () => {
      const service = makeService([{ blockerId: 'a10', blockedId: 'b10' }]);
      const input = { deletedAt: null };
      expect(await service.injectBlockFilter(undefined, input, 'authorId')).toEqual(input);
    });
  });

  describe('directional helpers', () => {
    it('hasBlocked is true only for the side that placed the block', async () => {
      const service = makeService([{ blockerId: 'a20', blockedId: 'b20' }]);
      expect(await service.hasBlocked('a20', 'b20')).toBe(true);
      // b20 never blocked anyone — offering them an Unblock button would be
      // both wrong and a disclosure.
      expect(await service.hasBlocked('b20', 'a20')).toBe(false);
    });

    it('getBlockDirection separates blockedByMe from blockedByThem', async () => {
      const service = makeService([{ blockerId: 'a21', blockedId: 'b21' }]);

      expect(await service.getBlockDirection('a21', 'b21')).toEqual({
        isBlocked: true,
        blockedByMe: true,
        blockedByThem: false,
      });
      expect(await service.getBlockDirection('b21', 'a21')).toEqual({
        isBlocked: true,
        blockedByMe: false,
        blockedByThem: true,
      });
    });

    it('reports no block in either direction for unrelated users', async () => {
      const service = makeService([]);
      expect(await service.getBlockDirection('a22', 'b22')).toEqual({
        isBlocked: false,
        blockedByMe: false,
        blockedByThem: false,
      });
    });
  });

  describe('removeBlock', () => {
    it('removes a block that exists', async () => {
      const service = makeService([{ blockerId: 'a23', blockedId: 'b23' }]);
      await expect(service.removeBlock('a23', 'b23')).resolves.toEqual({ count: 1 });
    });

    it('throws rather than reporting success for a block that was never made', async () => {
      const service = makeService([]);
      // deleteMany reports count 0 happily; returning success would make the
      // endpoint an oracle for "did I block this person?".
      await expect(service.removeBlock('a24', 'b24')).rejects.toThrow(NotFoundException);
    });

    it('will not let the blocked party lift a block placed on them', async () => {
      const service = makeService([{ blockerId: 'a25', blockedId: 'b25' }]);
      await expect(service.removeBlock('b25', 'a25')).rejects.toThrow(NotFoundException);
    });
  });
});
