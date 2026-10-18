import type { UserOtp, UserOtpPurpose } from '@prisma/client';

/** A stored code, as the fake keeps it. */
export type FakeOtpRow = UserOtp;

type Key = { userId: string; purpose: UserOtpPurpose };

/**
 * An in-memory `prisma.userOtp`, keyed like the real `(userId, purpose)`
 * unique constraint, honouring `consumedAt: null` in `updateMany` (the
 * single-use guarantee). Enough for UserOtpService to run for real in specs
 * of the flows built on it.
 */
export function createUserOtpStore() {
  const rows = new Map<string, FakeOtpRow>();
  let seq = 0;
  const k = (key: Key) => `${key.userId}:${key.purpose}`;

  const model = {
    upsert: jest.fn(
      (args: {
        where: { userId_purpose: Key };
        create: Partial<FakeOtpRow> &
          Pick<FakeOtpRow, 'userId' | 'purpose' | 'codeHash' | 'expiresAt'>;
        update: Partial<FakeOtpRow>;
      }) => {
        const id = k(args.where.userId_purpose);
        const existing = rows.get(id);
        const row: FakeOtpRow = existing
          ? { ...existing, ...args.update }
          : {
              id: `otp-${++seq}`,
              attempts: 0,
              consumedAt: null,
              createdAt: new Date(),
              requestIp: null,
              target: null,
              collegeId: null,
              ...args.create,
            };
        rows.set(id, row);
        return Promise.resolve(row);
      },
    ),
    findUnique: jest.fn((args: { where: { userId_purpose: Key } }) =>
      Promise.resolve(rows.get(k(args.where.userId_purpose)) ?? null),
    ),
    update: jest.fn(
      (args: {
        where: { id: string };
        data: { attempts?: { increment?: number } };
      }) => {
        for (const row of rows.values()) {
          if (row.id !== args.where.id) continue;
          row.attempts += args.data.attempts?.increment ?? 0;
          return Promise.resolve(row);
        }
        return Promise.resolve(null);
      },
    ),
    updateMany: jest.fn(
      (args: {
        where: { id: string; consumedAt?: null };
        data: Partial<FakeOtpRow>;
      }) => {
        let count = 0;
        for (const row of rows.values()) {
          if (row.id !== args.where.id) continue;
          if (args.where.consumedAt === null && row.consumedAt !== null) {
            continue;
          }
          Object.assign(row, args.data);
          count += 1;
        }
        return Promise.resolve({ count });
      },
    ),
    deleteMany: jest.fn(
      (args: { where: { userId: string; purpose?: UserOtpPurpose } }) => {
        let count = 0;
        for (const [id, row] of [...rows.entries()]) {
          if (row.userId !== args.where.userId) continue;
          if (args.where.purpose && row.purpose !== args.where.purpose) {
            continue;
          }
          rows.delete(id);
          count += 1;
        }
        return Promise.resolve({ count });
      },
    ),
  };

  return {
    model,
    rows,
    get: (userId: string, purpose: UserOtpPurpose) =>
      rows.get(k({ userId, purpose })),
  };
}
