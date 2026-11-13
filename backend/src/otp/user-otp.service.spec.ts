import { BadRequestException, HttpException } from '@nestjs/common';
import { UserOtpPurpose, type UserOtp } from '@prisma/client';
import { UserOtpService } from './user-otp.service';
import { stub } from '../common/testing/stub';
import type { PrismaService } from '../prisma/prisma.service';
import type { RedisService } from '../redis/redis.service';

/** A stored code. `requestIp` is only present when the service passed one. */
type OtpRow = Omit<UserOtp, 'requestIp' | 'target' | 'collegeId'> & {
  requestIp?: string | null;
  target?: string | null;
  collegeId?: string | null;
};
type UserPurposeKey = { userId: string; purpose: UserOtpPurpose };
import {
  OTP_MAX_ATTEMPTS,
  OTP_RESEND_COOLDOWN_MS,
  OTP_SEND_LIMIT_PER_HOUR,
  OTP_TTL_MS,
  OTP_VERIFY_LIMIT_PER_IP,
} from './user-otp.constants';

/**
 * The security core of the deletion and recovery flows.
 *
 * The fake below stores rows in a Map keyed the same way the real unique
 * constraint is — `userId:purpose` — because that constraint is what enforces
 * "a new code invalidates the previous one". A fake that allowed two rows per
 * key would make that property untestable.
 */
describe('UserOtpService', () => {
  const USER = 'user-1';
  const OTHER = 'user-2';
  const DELETION = UserOtpPurpose.ACCOUNT_DELETION;
  const RECOVERY = UserOtpPurpose.ACCOUNT_RECOVERY;

  let service: UserOtpService;
  let rows: Map<string, OtpRow>;
  let prisma: { userOtp: Record<string, jest.Mock> };

  const key = (userId: string, purpose: string) => `${userId}:${purpose}`;

  beforeEach(() => {
    rows = new Map();
    let seq = 0;

    prisma = {
      userOtp: {
        upsert: jest.fn(
          ({
            where,
            create,
            update,
          }: {
            where: { userId_purpose: UserPurposeKey };
            create: Pick<
              OtpRow,
              'userId' | 'purpose' | 'codeHash' | 'expiresAt'
            > &
              Partial<OtpRow>;
            update: Partial<OtpRow>;
          }) => {
            const k = key(
              where.userId_purpose.userId,
              where.userId_purpose.purpose,
            );
            const existing = rows.get(k);
            const row: OtpRow = existing
              ? {
                  ...existing,
                  ...update,
                  attempts: update.attempts ?? existing.attempts,
                }
              : {
                  id: `otp-${++seq}`,
                  attempts: 0,
                  consumedAt: null,
                  createdAt: new Date(),
                  ...create,
                };
            rows.set(k, row);
            return Promise.resolve(row);
          },
        ),
        findUnique: jest.fn(
          ({ where }: { where: { userId_purpose?: UserPurposeKey } }) => {
            if (where.userId_purpose) {
              return Promise.resolve(
                rows.get(
                  key(
                    where.userId_purpose.userId,
                    where.userId_purpose.purpose,
                  ),
                ) ?? null,
              );
            }
            return Promise.resolve(null);
          },
        ),
        update: jest.fn(
          ({
            where,
            data,
          }: {
            where: { id: string };
            data: { attempts?: { increment?: number } };
          }) => {
            for (const row of rows.values()) {
              if (row.id !== where.id) continue;
              if (data.attempts?.increment)
                row.attempts += data.attempts.increment;
              return Promise.resolve(row);
            }
            return Promise.resolve(null);
          },
        ),
        updateMany: jest.fn(
          ({
            where,
            data,
          }: {
            where: {
              id: string;
              consumedAt?: null;
              expiresAt?: { gt: Date };
              attempts?: { lt: number };
            };
            data: Partial<Omit<OtpRow, 'attempts'>> & {
              attempts?: { increment: number };
            };
          }) => {
            let count = 0;
            for (const row of rows.values()) {
              if (row.id !== where.id) continue;
              // Honours `consumedAt: null` — this is the single-use guarantee.
              if (where.consumedAt === null && row.consumedAt !== null)
                continue;
              // And the same conditions the real WHERE clause carries, because
              // the attempt ceiling is enforced by them, not in process.
              if (where.expiresAt && !(row.expiresAt > where.expiresAt.gt))
                continue;
              if (where.attempts && !(row.attempts < where.attempts.lt))
                continue;
              const { attempts, ...rest } = data;
              Object.assign(row, rest);
              if (attempts) row.attempts += attempts.increment;
              count += 1;
            }
            return Promise.resolve({ count });
          },
        ),
        deleteMany: jest.fn(
          ({
            where,
          }: {
            where: { userId: string; purpose?: UserOtpPurpose };
          }) => {
            let count = 0;
            for (const [k, row] of [...rows.entries()]) {
              if (row.userId !== where.userId) continue;
              if (where.purpose && row.purpose !== where.purpose) continue;
              rows.delete(k);
              count += 1;
            }
            return Promise.resolve({ count });
          },
        ),
      },
    };

    // No Redis: the IP and hourly limits are counted in memory (see the
    // 'rate limits without Redis' suite), so the database-backed guards
    // (cooldown, attempt ceiling) are what the rest of this suite exercises.
    service = new UserOtpService(
      stub<PrismaService>(prisma),
      stub<RedisService>({ getClient: () => null }),
    );
  });

  const issued = () => rows.get(key(USER, DELETION))!;
  /** Rewinds the stored row so the cooldown no longer applies. */
  const clearCooldown = (userId = USER, purpose: string = DELETION) => {
    const row = rows.get(key(userId, purpose));
    if (row)
      row.createdAt = new Date(Date.now() - OTP_RESEND_COOLDOWN_MS - 1000);
  };

  describe('generation', () => {
    it('mints a six-digit numeric code with the configured lifetime', async () => {
      const before = Date.now();
      const { code, expiresAt } = await service.issue(USER, DELETION);

      expect(code).toMatch(/^\d{6}$/);
      expect(expiresAt.getTime() - before).toBeGreaterThan(OTP_TTL_MS - 5_000);
      expect(expiresAt.getTime() - before).toBeLessThanOrEqual(
        OTP_TTL_MS + 1_000,
      );
    });

    it('never stores the code in plaintext', async () => {
      const { code } = await service.issue(USER, DELETION);
      const stored = issued();
      expect(stored.codeHash).not.toContain(code);
      expect(stored.codeHash).toMatch(/^[0-9a-f]{64}$/);
      expect(JSON.stringify(stored)).not.toContain(code);
    });

    it('keys the hash with a server secret, so the digest is not reversible from the table alone', async () => {
      // A bare SHA-256 of six digits is brute-forceable in milliseconds by
      // anyone holding the table. The key is the entire defence, so this pins
      // down that the stored value is NOT the unkeyed digest.
      const crypto = await import('crypto');
      const { code } = await service.issue(USER, DELETION);
      const plainDigest = crypto
        .createHash('sha256')
        .update(code)
        .digest('hex');
      expect(issued().codeHash).not.toBe(plainDigest);
    });

    it('produces different codes across issuances', async () => {
      const seen = new Set<string>();
      // A different user each time: one user's sends are capped per hour.
      for (let i = 0; i < 12; i++) {
        seen.add((await service.issue(`user-gen-${i}`, DELETION)).code);
      }
      // A constant or near-constant generator would collapse this set.
      expect(seen.size).toBeGreaterThan(6);
    });
  });

  describe('verification', () => {
    it('accepts the correct code exactly once', async () => {
      const { code } = await service.issue(USER, DELETION);

      await expect(
        service.verify(USER, DELETION, code),
      ).resolves.toBeUndefined();
      // Replay: the same correct code must not work twice.
      await expect(service.verify(USER, DELETION, code)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rejects a wrong code and burns an attempt', async () => {
      await service.issue(USER, DELETION);
      await expect(service.verify(USER, DELETION, '000000')).rejects.toThrow(
        BadRequestException,
      );
      expect(issued().attempts).toBe(1);
    });

    it('stops accepting anything after the attempt ceiling, even the right code', async () => {
      const { code } = await service.issue(USER, DELETION);
      for (let i = 0; i < OTP_MAX_ATTEMPTS; i++) {
        await service.verify(USER, DELETION, '000000').catch(() => {});
      }
      await expect(service.verify(USER, DELETION, code)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rejects an expired code', async () => {
      const { code } = await service.issue(USER, DELETION);
      issued().expiresAt = new Date(Date.now() - 1000);
      await expect(service.verify(USER, DELETION, code)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rejects a code minted for a different purpose', async () => {
      // Without this, a code emailed to confirm a deletion could be replayed to
      // cancel one — the two flows are reachable by the same session.
      const { code } = await service.issue(USER, DELETION);
      await expect(service.verify(USER, RECOVERY, code)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rejects a code minted for a different user', async () => {
      const { code } = await service.issue(USER, DELETION);
      clearCooldown(OTHER, DELETION);
      await service.issue(OTHER, DELETION);
      await expect(service.verify(OTHER, DELETION, code)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('invalidates the previous code when a new one is issued', async () => {
      const first = await service.issue(USER, DELETION);
      clearCooldown();
      const second = await service.issue(USER, DELETION);

      expect(second.code).not.toBe(first.code);
      await expect(service.verify(USER, DELETION, first.code)).rejects.toThrow(
        BadRequestException,
      );
      await expect(
        service.verify(USER, DELETION, second.code),
      ).resolves.toBeUndefined();
    });

    it('gives a fresh attempt budget with a fresh code', async () => {
      // Otherwise a user who fat-fingered five times could never recover, since
      // requesting a new code would land on an already-exhausted row.
      await service.issue(USER, DELETION);
      for (let i = 0; i < OTP_MAX_ATTEMPTS; i++) {
        await service.verify(USER, DELETION, '000000').catch(() => {});
      }
      clearCooldown();
      const { code } = await service.issue(USER, DELETION);
      await expect(
        service.verify(USER, DELETION, code),
      ).resolves.toBeUndefined();
    });

    it('answers "no code exists" and "wrong code" identically', async () => {
      // Otherwise the endpoint becomes an oracle for whether an account has a
      // deletion pending — readable by anyone holding the session.
      const noCode = await service
        .verify(USER, DELETION, '123456')
        .catch((e: HttpException) => e.getResponse());

      await service.issue(USER, DELETION);
      const wrongCode = await service
        .verify(USER, DELETION, '000000')
        .catch((e: HttpException) => e.getResponse());

      expect((noCode as { code: string }).code).toBe('OTP_INVALID');
      expect((wrongCode as { code: string }).code).toBe('OTP_INVALID');
    });

    it('rejects a malformed hash without throwing', async () => {
      await service.issue(USER, DELETION);
      issued().codeHash = 'not-hex';
      await expect(service.verify(USER, DELETION, '123456')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('resend cooldown', () => {
    it('refuses a second send inside the cooldown window', async () => {
      await service.issue(USER, DELETION);
      await expect(service.issue(USER, DELETION)).rejects.toThrow(
        HttpException,
      );
    });

    it('reports the cooldown as a 429 with a retry hint', async () => {
      await service.issue(USER, DELETION);
      const err = (await service
        .issue(USER, DELETION)
        .catch((e: unknown) => e)) as HttpException;
      expect(err.getStatus()).toBe(429);
      expect(err.getResponse()).toMatchObject({ code: 'OTP_COOLDOWN' });
      expect(
        (err.getResponse() as { retryAfterSeconds: number }).retryAfterSeconds,
      ).toBeGreaterThan(0);
    });

    it('allows a send once the window has passed', async () => {
      await service.issue(USER, DELETION);
      clearCooldown();
      await expect(service.issue(USER, DELETION)).resolves.toBeDefined();
    });

    it('is enforced from the stored row, not from Redis', async () => {
      // The cheapest abuse to attempt is hammering resend, so that guard must
      // not disappear when an optional dependency is unavailable — and Redis is
      // absent throughout this suite.
      await service.issue(USER, DELETION);
      await expect(service.issue(USER, DELETION)).rejects.toThrow(
        HttpException,
      );
    });

    it('tracks cooldowns per purpose', async () => {
      await service.issue(USER, DELETION);
      await expect(service.issue(USER, RECOVERY)).resolves.toBeDefined();
    });
  });

  describe('invalidation', () => {
    it('invalidateAll drops every purpose for the user', async () => {
      await service.issue(USER, DELETION);
      await service.issue(USER, RECOVERY);
      await service.invalidateAll(USER);
      expect(rows.size).toBe(0);
    });

    it('invalidate drops only the named purpose', async () => {
      const del = await service.issue(USER, DELETION);
      await service.issue(USER, RECOVERY);
      await service.invalidate(USER, RECOVERY);

      expect(rows.has(key(USER, RECOVERY))).toBe(false);
      await expect(
        service.verify(USER, DELETION, del.code),
      ).resolves.toBeUndefined();
    });
  });

  describe('challenge state', () => {
    it('never exposes the code or its hash', async () => {
      await service.issue(USER, DELETION);
      const state = await service.getChallengeState(USER, DELETION);
      expect(JSON.stringify(state)).not.toContain(issued().codeHash);
      expect(state).toMatchObject({
        attemptsRemaining: OTP_MAX_ATTEMPTS,
      });
      expect(state?.expiresAt).toBeDefined();
      expect(state?.resendAvailableAt).toBeDefined();
    });

    it('reports nothing once the code is consumed or expired', async () => {
      const { code } = await service.issue(USER, DELETION);
      await service.verify(USER, DELETION, code);
      expect(await service.getChallengeState(USER, DELETION)).toBeNull();
    });
  });
  describe('bound codes (college and personal email)', () => {
    const COLLEGE = UserOtpPurpose.COLLEGE_EMAIL;
    const bound = () => rows.get(key(USER, COLLEGE))!;
    const errorCode = (e: HttpException) =>
      (e.getResponse() as { code: string }).code;

    it('returns the address and college the code was bound to, once', async () => {
      const { code } = await service.issue(USER, COLLEGE, {
        target: 'a@college.edu',
        collegeId: 'c1',
      });
      await expect(service.verifyBound(USER, COLLEGE, code)).resolves.toEqual({
        target: 'a@college.edu',
        collegeId: 'c1',
      });
      // Replay of a consumed code.
      const replay = await service
        .verifyBound(USER, COLLEGE, code)
        .catch((e: HttpException) => e);
      expect(errorCode(replay as HttpException)).toBe('invalid_code');
    });

    it('rebinds on reissue, so an old code cannot apply a new address or vice versa', async () => {
      const first = await service.issue(USER, COLLEGE, {
        target: 'a@college.edu',
        collegeId: 'c1',
      });
      clearCooldown(USER, COLLEGE);
      const second = await service.issue(USER, COLLEGE, {
        target: 'b@college.edu',
        collegeId: 'c1',
      });
      await expect(
        service.verifyBound(USER, COLLEGE, first.code),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.verifyBound(USER, COLLEGE, second.code),
      ).resolves.toMatchObject({ target: 'b@college.edu' });
    });

    it('names an expired code', async () => {
      const { code } = await service.issue(USER, COLLEGE, {
        target: 'a@x.edu',
      });
      bound().expiresAt = new Date(Date.now() - 1000);
      const err = await service
        .verifyBound(USER, COLLEGE, code)
        .catch((e: HttpException) => e);
      expect(errorCode(err as HttpException)).toBe('expired_code');
    });

    it('names a wrong code, then the exhausted budget', async () => {
      const { code } = await service.issue(USER, COLLEGE, {
        target: 'a@x.edu',
      });
      const wrong = code === '000000' ? '111111' : '000000';
      const first = await service
        .verifyBound(USER, COLLEGE, wrong)
        .catch((e: HttpException) => e);
      expect(errorCode(first as HttpException)).toBe('invalid_code');
      for (let i = 1; i < OTP_MAX_ATTEMPTS - 1; i++) {
        await service.verifyBound(USER, COLLEGE, wrong).catch(() => {});
      }
      const last = await service
        .verifyBound(USER, COLLEGE, wrong)
        .catch((e: HttpException) => e);
      expect(errorCode(last as HttpException)).toBe('too_many_attempts');
      // Even the right code is refused now.
      const after = await service
        .verifyBound(USER, COLLEGE, code)
        .catch((e: HttpException) => e);
      expect(errorCode(after as HttpException)).toBe('too_many_attempts');
    });

    it('bounds PARALLEL guesses to the attempt ceiling, not just sequential ones', async () => {
      const { code } = await service.issue(USER, DELETION);
      const wrong = code === '000000' ? '111111' : '000000';

      // The fake resolves synchronously per call, so interleave the awaits the
      // way concurrent requests would: every request reads the row first.
      const settled = await Promise.allSettled(
        Array.from({ length: 20 }, () => service.verify(USER, DELETION, wrong)),
      );

      expect(settled.every((r) => r.status === 'rejected')).toBe(true);
      // The counter never goes past the ceiling, however many requests raced.
      expect(issued().attempts).toBeLessThanOrEqual(OTP_MAX_ATTEMPTS);
      // The claim is made by a conditional update, which is what makes it atomic.
      expect(prisma.userOtp.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            attempts: { lt: OTP_MAX_ATTEMPTS },
          }) as unknown,
        }),
      );
    });

    it('does not compare the hash once the budget is spent by a concurrent request', async () => {
      const { code } = await service.issue(USER, DELETION);
      // Another request spent the last attempt between our read and our claim.
      prisma.userOtp.findUnique.mockImplementationOnce(() => {
        const snapshot = { ...issued() };
        issued().attempts = OTP_MAX_ATTEMPTS;
        return Promise.resolve(snapshot);
      });
      await expect(service.verify(USER, DELETION, code)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(issued().consumedAt).toBeNull();
    });

    it('keeps the deletion flow uniform: no binding, OTP_INVALID only', async () => {
      const { code } = await service.issue(USER, DELETION);
      issued().expiresAt = new Date(Date.now() - 1000);
      const err = await service
        .verify(USER, DELETION, code)
        .catch((e: HttpException) => e);
      expect(errorCode(err as HttpException)).toBe('OTP_INVALID');
      expect(issued().target ?? null).toBeNull();
    });

    it('exposes a live bound challenge without the code', async () => {
      await service.issue(USER, COLLEGE, {
        target: 'a@college.edu',
        collegeId: 'c1',
      });
      const state = await service.getBoundChallenge(USER, COLLEGE);
      expect(state).toMatchObject({ target: 'a@college.edu', collegeId: 'c1' });
      expect(JSON.stringify(state)).not.toContain(bound().codeHash);
    });
  });

  describe('rate limits without Redis', () => {
    /** A Redis client whose every command fails, as during an outage. */
    const brokenClient = () => ({
      incr: jest.fn(() => Promise.reject(new Error('Command timed out'))),
      expire: jest.fn(() => Promise.reject(new Error('Command timed out'))),
      ttl: jest.fn(() => Promise.reject(new Error('Command timed out'))),
    });

    const serviceWith = (client: object | null) =>
      new UserOtpService(
        stub<PrismaService>(prisma),
        stub<RedisService>({ getClient: () => client as never }),
      );

    const code = (e: unknown) =>
      ((e as HttpException).getResponse() as { code?: string }).code;

    const variants: Array<[string, () => object | null]> = [
      ['no Redis client', () => null],
      ['a Redis outage', brokenClient],
    ];

    it.each(variants)(
      'caps code sends per hour with %s instead of dropping the limit',
      async (_name, client) => {
        const svc = serviceWith(client());
        for (let i = 0; i < OTP_SEND_LIMIT_PER_HOUR; i++) {
          await svc.issue(USER, DELETION);
          clearCooldown();
        }
        const err = await svc.issue(USER, DELETION).catch((e: unknown) => e);
        expect(err).toBeInstanceOf(HttpException);
        expect((err as HttpException).getStatus()).toBe(429);
        expect(code(err)).toBe('OTP_RATE_LIMITED');
      },
    );

    it.each(variants)(
      'caps verification attempts per IP with %s',
      async (_name, client) => {
        const svc = serviceWith(client());
        await svc.issue(USER, DELETION);
        for (let i = 0; i < OTP_VERIFY_LIMIT_PER_IP; i++) {
          // Wrong codes: each is refused by the code check, never by the limit.
          const err = await svc
            .verify(USER, DELETION, '000000', { ip: '203.0.113.5' })
            .catch((e: unknown) => e);
          expect(code(err)).toBe('OTP_INVALID');
        }
        const limited = await svc
          .verify(USER, DELETION, '000000', { ip: '203.0.113.5' })
          .catch((e: unknown) => e);
        expect((limited as HttpException).getStatus()).toBe(429);
        expect(code(limited)).toBe('OTP_RATE_LIMITED');
        expect(
          (
            (limited as HttpException).getResponse() as {
              retryAfterSeconds: number;
            }
          ).retryAfterSeconds,
        ).toBeGreaterThan(0);
      },
    );

    it('does not refuse an ordinary first request while Redis is down', async () => {
      const svc = serviceWith(brokenClient());
      await expect(svc.issue(USER, DELETION)).resolves.toBeDefined();
    });

    it('keeps separate in-memory budgets per address', async () => {
      const svc = serviceWith(null);
      await svc.issue(USER, DELETION);
      for (let i = 0; i < OTP_VERIFY_LIMIT_PER_IP; i++) {
        await svc
          .verify(USER, DELETION, '000000', { ip: '203.0.113.5' })
          .catch(() => undefined);
      }
      const other = await svc
        .verify(USER, DELETION, '000000', { ip: '203.0.113.6' })
        .catch((e: unknown) => e);
      expect(code(other)).toBe('OTP_INVALID');
    });

    it('uses the shared counter, and not the in-memory one, while Redis answers', async () => {
      const incr = jest.fn(() => Promise.resolve(OTP_SEND_LIMIT_PER_HOUR + 1));
      const client = {
        incr,
        expire: jest.fn(() => Promise.resolve(1)),
        ttl: jest.fn(() => Promise.resolve(1200)),
      };
      const svc = serviceWith(client);
      const err = await svc.issue(USER, DELETION).catch((e: unknown) => e);
      expect(code(err)).toBe('OTP_RATE_LIMITED');
      expect(
        (err as HttpException).getResponse() as { retryAfterSeconds: number },
      ).toMatchObject({ retryAfterSeconds: 1200 });
      expect(incr).toHaveBeenCalledTimes(1);
    });
  });
});
