import { BadRequestException, HttpException } from '@nestjs/common';
import { UserOtpPurpose } from '@prisma/client';
import { UserOtpService } from './user-otp.service';
import {
  OTP_MAX_ATTEMPTS,
  OTP_RESEND_COOLDOWN_MS,
  OTP_TTL_MS,
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
  let rows: Map<string, any>;
  let prisma: any;

  const key = (userId: string, purpose: string) => `${userId}:${purpose}`;

  beforeEach(() => {
    rows = new Map();
    let seq = 0;

    prisma = {
      userOtp: {
        upsert: jest.fn(async ({ where, create, update }: any) => {
          const k = key(
            where.userId_purpose.userId,
            where.userId_purpose.purpose,
          );
          const existing = rows.get(k);
          const row = existing
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
          return row;
        }),
        findUnique: jest.fn(async ({ where }: any) => {
          if (where.userId_purpose) {
            return (
              rows.get(
                key(where.userId_purpose.userId, where.userId_purpose.purpose),
              ) ?? null
            );
          }
          return null;
        }),
        update: jest.fn(async ({ where, data }: any) => {
          for (const row of rows.values()) {
            if (row.id !== where.id) continue;
            if (data.attempts?.increment)
              row.attempts += data.attempts.increment;
            return row;
          }
          return null;
        }),
        updateMany: jest.fn(async ({ where, data }: any) => {
          let count = 0;
          for (const row of rows.values()) {
            if (row.id !== where.id) continue;
            // Honours `consumedAt: null` — this is the single-use guarantee.
            if (where.consumedAt === null && row.consumedAt !== null) continue;
            Object.assign(row, data);
            count += 1;
          }
          return { count };
        }),
        deleteMany: jest.fn(async ({ where }: any) => {
          let count = 0;
          for (const [k, row] of [...rows.entries()]) {
            if (row.userId !== where.userId) continue;
            if (where.purpose && row.purpose !== where.purpose) continue;
            rows.delete(k);
            count += 1;
          }
          return { count };
        }),
      },
    };

    // No Redis: the IP and hourly limits fail open by design, which leaves the
    // database-backed guards (cooldown, attempt ceiling) under test here.
    service = new UserOtpService(prisma, { getClient: () => null } as any);
  });

  const issued = () => rows.get(key(USER, DELETION));
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
      for (let i = 0; i < 12; i++) {
        clearCooldown();
        seen.add((await service.issue(USER, DELETION)).code);
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
        .catch((e) => e.getResponse());

      await service.issue(USER, DELETION);
      const wrongCode = await service
        .verify(USER, DELETION, '000000')
        .catch((e) => e.getResponse());

      expect(noCode.code).toBe('OTP_INVALID');
      expect(wrongCode.code).toBe('OTP_INVALID');
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
      const err: any = await service.issue(USER, DELETION).catch((e) => e);
      expect(err.getStatus()).toBe(429);
      expect(err.getResponse()).toMatchObject({ code: 'OTP_COOLDOWN' });
      expect(err.getResponse().retryAfterSeconds).toBeGreaterThan(0);
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
});
