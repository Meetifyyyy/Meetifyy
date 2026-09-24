import { BlocksService } from '../blocks.service';
import type { Stub } from '../../common/testing/stub';

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

  const mock = {
    getExcludedUserIds: jest.fn((userId: string) =>
      Promise.resolve(excludedFor(userId)),
    ),
    getBlockedByUserIds: jest.fn((userId: string) =>
      Promise.resolve(outgoingFor(userId)),
    ),
    isBlocked: jest.fn((a: string, b: string) =>
      Promise.resolve(a !== b && excludedFor(a).includes(b)),
    ),
    hasBlocked: jest.fn((a: string, b: string) =>
      Promise.resolve(a !== b && outgoingFor(a).includes(b)),
    ),
    getBlockDirection: jest.fn((userId: string, otherId: string) =>
      Promise.resolve({
        isBlocked: excludedFor(userId).includes(otherId),
        blockedByMe: outgoingFor(userId).includes(otherId),
        // Looked up, not derived: a mutual block makes both true, and deriving
        // "them" from "not me" reported it as one-way.
        blockedByThem: outgoingFor(otherId).includes(userId),
      }),
    ),
    filterBlockedUsers: jest.fn((userId: string, ids: string[]) => {
      if (!userId) return Promise.resolve(ids);
      const set = new Set(excludedFor(userId));
      return Promise.resolve(ids.filter((id) => !set.has(id)));
    }),
    injectBlockFilter: jest.fn(
      <T extends { AND?: unknown }>(
        userId: string | null | undefined,
        where: T,
        field = 'id',
      ): Promise<T> => {
        if (!userId) return Promise.resolve(where);
        const excluded = excludedFor(userId);
        if (excluded.length === 0) return Promise.resolve(where);
        const existing = where.AND;
        const and: unknown[] = Array.isArray(existing)
          ? [...(existing as unknown[])]
          : existing
            ? [existing]
            : [];
        and.push({ [field]: { notIn: excluded } });
        return Promise.resolve({ ...where, AND: and });
      },
    ),
    listBlockedContacts: jest.fn(() => Promise.resolve([])),
    removeBlock: jest.fn(() => Promise.resolve({ count: 1 })),
    invalidateBlockCache: jest.fn(() => Promise.resolve()),
  } satisfies Stub<BlocksService>;
  return mock as typeof mock & BlocksService;
}

/** Ready-made Nest provider for the double above. */
export const blocksServiceMockProvider = (
  blocks: { blockerId: string; blockedId: string }[] = [],
) => ({ provide: BlocksService, useValue: createBlocksServiceMock(blocks) });
