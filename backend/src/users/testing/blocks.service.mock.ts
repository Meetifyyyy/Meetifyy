import { BlocksService } from '../blocks.service';

/**
 * Test double for BlocksService.
 *
 * Every service that filters by block depends on this, so a single shared
 * double means adding a method to BlocksService does not break a dozen
 * unrelated specs one by one.
 *
 * Pass `blocks` to simulate real block rows; omit it for the common "nobody is
 * blocked" case. Mutual semantics are modelled faithfully — a block is returned
 * for both the blocker and the blocked.
 */
export function createBlocksServiceMock(
  blocks: { blockerId: string; blockedId: string }[] = [],
) {
  const excludedFor = (userId: string): string[] =>
    blocks
      .filter((b) => b.blockerId === userId || b.blockedId === userId)
      .map((b) => (b.blockerId === userId ? b.blockedId : b.blockerId));

  const outgoingFor = (userId: string): string[] =>
    blocks.filter((b) => b.blockerId === userId).map((b) => b.blockedId);

  return {
    getExcludedUserIds: jest.fn(async (userId: string) => excludedFor(userId)),
    getBlockedByUserIds: jest.fn(async (userId: string) => outgoingFor(userId)),
    isBlocked: jest.fn(async (a: string, b: string) => a !== b && excludedFor(a).includes(b)),
    hasBlocked: jest.fn(async (a: string, b: string) => a !== b && outgoingFor(a).includes(b)),
    getBlockDirection: jest.fn(async (userId: string, otherId: string) => {
      const isBlocked = excludedFor(userId).includes(otherId);
      const blockedByMe = outgoingFor(userId).includes(otherId);
      return { isBlocked, blockedByMe, blockedByThem: isBlocked && !blockedByMe };
    }),
    filterBlockedUsers: jest.fn(async (userId: string, ids: string[]) => {
      if (!userId) return ids;
      const set = new Set(excludedFor(userId));
      return ids.filter((id) => !set.has(id));
    }),
    injectBlockFilter: jest.fn(async (userId: string, where: any, field = 'id') => {
      if (!userId) return where;
      const excluded = excludedFor(userId);
      if (excluded.length === 0) return where;
      const existing = where.AND;
      const and = Array.isArray(existing) ? [...existing] : existing ? [existing] : [];
      and.push({ [field]: { notIn: excluded } });
      return { ...where, AND: and };
    }),
    listBlockedContacts: jest.fn(async () => []),
    removeBlock: jest.fn(async () => ({ count: 1 })),
    invalidateBlockCache: jest.fn(async () => {}),
  };
}

/** Ready-made Nest provider for the double above. */
export const blocksServiceMockProvider = (
  blocks: { blockerId: string; blockedId: string }[] = [],
) => ({ provide: BlocksService, useValue: createBlocksServiceMock(blocks) });
