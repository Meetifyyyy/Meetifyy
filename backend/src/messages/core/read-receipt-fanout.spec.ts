import {
  readReceiptAudiences,
  type ReadReceiptParticipant,
} from './read-receipt-fanout';

/**
 * The per-member computation this replaced, kept verbatim as the oracle: for
 * every member, filter the rest of the roster and work out the answer. The new
 * one-pass version must give every member exactly this answer.
 */
function oracle(
  participants: readonly ReadReceiptParticipant[],
  readerId: string,
): Map<string, { isAllRead: boolean; minOtherReadAt: string | null }> {
  const out = new Map<
    string,
    { isAllRead: boolean; minOtherReadAt: string | null }
  >();
  for (const p of participants) {
    if (p.userId === readerId) continue;
    const others = participants.filter((item) => item.userId !== p.userId);
    const otherReadTimestamps = others
      .filter(
        (item) =>
          item.user?.settings?.readReceipts !== false &&
          item.lastReadAt != null,
      )
      .map((item) => new Date(item.lastReadAt!).getTime());
    const isAllRead =
      otherReadTimestamps.length > 0 &&
      otherReadTimestamps.length === others.length;
    const minOtherReadAt = isAllRead ? Math.min(...otherReadTimestamps) : 0;
    out.set(p.userId, {
      isAllRead,
      minOtherReadAt: minOtherReadAt
        ? new Date(minOtherReadAt).toISOString()
        : null,
    });
  }
  return out;
}

/** Deterministic pseudo-random roster: ties, missing reads, receipts off. */
function roster(size: number, seed: number): ReadReceiptParticipant[] {
  let state = seed;
  const next = () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648;
  };
  const base = Date.UTC(2026, 10, 13, 12, 0, 0);
  return Array.from({ length: size }, (_, i) => {
    const r = next();
    const receipts = r < 0.1 ? false : r < 0.15 ? null : true;
    const hasRead = next() > 0.15;
    // Few distinct times, so ties (including at the minimum) are common.
    const time = new Date(base + Math.floor(next() * 5) * 60_000);
    return {
      userId: `u${i}`,
      lastReadAt: hasRead ? (next() > 0.5 ? time : time.toISOString()) : null,
      user: next() > 0.05 ? { settings: { readReceipts: receipts } } : null,
    };
  });
}

function flatten(
  participants: readonly ReadReceiptParticipant[],
  readerId: string,
) {
  const got = new Map<
    string,
    { isAllRead: boolean; minOtherReadAt: string | null }
  >();
  for (const a of readReceiptAudiences(participants, readerId)) {
    for (const id of a.userIds) {
      expect(got.has(id)).toBe(false);
      got.set(id, { isAllRead: a.isAllRead, minOtherReadAt: a.minOtherReadAt });
    }
  }
  return got;
}

describe('readReceiptAudiences', () => {
  it.each([1, 2, 3, 10, 300])(
    'gives every member of a %i-member roster the same answer as the per-member computation',
    (size) => {
      for (let seed = 1; seed <= 40; seed += 1) {
        const members = roster(size, seed * 7919 + size);
        const reader = members[seed % size].userId;
        expect(flatten(members, reader)).toEqual(oracle(members, reader));
      }
    },
  );

  it('handles everyone having read at the same moment (all tied at the minimum)', () => {
    const at = new Date(Date.UTC(2026, 10, 13));
    const members = ['a', 'b', 'c', 'd'].map((userId) => ({
      userId,
      lastReadAt: at,
      user: { settings: { readReceipts: true } },
    }));
    expect(flatten(members, 'a')).toEqual(oracle(members, 'a'));
  });

  it('never tells the reader about their own read', () => {
    const members = roster(10, 42);
    const ids = readReceiptAudiences(members, 'u3').flatMap((a) => a.userIds);
    expect(ids).not.toContain('u3');
    expect(ids).toHaveLength(9);
  });

  it('needs at most three events for a 300-member group, instead of 299', () => {
    for (let seed = 1; seed <= 20; seed += 1) {
      const members = roster(300, seed);
      const audiences = readReceiptAudiences(members, members[0].userId);
      expect(audiences.length).toBeLessThanOrEqual(3);
      const told = audiences.reduce((n, a) => n + a.userIds.length, 0);
      expect(told).toBe(299);
    }
  });

  it('tells nobody anything in a conversation with only the reader', () => {
    const members = roster(1, 5);
    expect(readReceiptAudiences(members, members[0].userId)).toEqual([]);
  });
});
