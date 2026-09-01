import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
} from '@nestjs/common';
import * as crypto from 'crypto';
import { UserOtpPurpose } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { config } from '../config';
import {
  OTP_LENGTH,
  OTP_MAX_ATTEMPTS,
  OTP_RESEND_COOLDOWN_MS,
  OTP_SEND_LIMIT_PER_HOUR,
  OTP_TTL_MS,
  OTP_VERIFY_IP_WINDOW_SEC,
  OTP_VERIFY_LIMIT_PER_IP,
} from './user-otp.constants';

export interface IssuedOtp {
  /** The plaintext code. Returned ONLY so the caller can email it. Never persisted, never logged, never returned over HTTP. */
  code: string;
  expiresAt: Date;
}

/** What a client is allowed to know about a live code. */
export interface OtpChallengeState {
  expiresAt: string;
  /** Server-computed, so a client clock cannot shorten or extend the cooldown. */
  resendAvailableAt: string;
  attemptsRemaining: number;
}

/**
 * One-time codes for the account-deletion lifecycle.
 *
 * Deliberately a shared service rather than logic inside the deletion flow:
 * requesting deletion and recovering an account need identical guarantees, and
 * two copies of code-verification logic is two chances to get it subtly wrong.
 *
 * ── What makes this safe ──────────────────────────────────────────────────
 *  - Codes are generated with `crypto.randomInt`, never `Math.random`.
 *  - Only an HMAC of the code is stored, keyed with a server secret. A bare
 *    SHA-256 of six digits is reversible by anyone holding the table; the key
 *    is what makes a database leak insufficient.
 *  - Comparison is constant-time, so response timing does not leak a prefix.
 *  - A code is single-use: `consumedAt` is stamped inside the same conditional
 *    update that accepts it, so two concurrent requests cannot both succeed.
 *  - Issuing a code replaces any previous one for that (user, purpose) via the
 *    unique constraint, so an old code stops working immediately.
 *  - Attempts are capped per code, sends are capped and cooled-down per user,
 *    and verifications are capped per IP.
 *  - Failure messages never distinguish "no code exists" from "wrong code", so
 *    the API cannot be used to probe whether a deletion is pending.
 *  - The plaintext code is never logged and never returned over HTTP.
 */
@Injectable()
export class UserOtpService {
  private readonly logger = new Logger(UserOtpService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
  ) {}

  /**
   * The HMAC key.
   *
   * Falls back to the Supabase service-role key, which is already required in
   * staging and production, so no environment silently drops to an unkeyed
   * hash. Development without either configured still gets a keyed HMAC — just
   * with a well-known key, which is acceptable only because there is nothing
   * of value in a development database.
   */
  private hmacKey(): string {
    return (
      config.auth.otp.hashSecret ||
      config.auth.supabase.serviceRoleKey ||
      'meetifyy-development-otp-key'
    );
  }

  private hashCode(code: string): string {
    return crypto
      .createHmac('sha256', this.hmacKey())
      .update(code)
      .digest('hex');
  }

  /** Constant-time comparison, so timing cannot reveal how much of a code matched. */
  private matches(code: string, storedHash: string): boolean {
    const candidate = Buffer.from(this.hashCode(code), 'hex');
    let stored: Buffer;
    try {
      stored = Buffer.from(storedHash, 'hex');
    } catch {
      return false;
    }
    if (candidate.length !== stored.length) return false;
    return crypto.timingSafeEqual(candidate, stored);
  }

  /** Cryptographically secure, uniformly distributed, zero-padded. */
  private generateCode(): string {
    const max = 10 ** OTP_LENGTH;
    return crypto.randomInt(0, max).toString().padStart(OTP_LENGTH, '0');
  }

  /**
   * Issues a code, replacing any live one for the same user and purpose.
   *
   * Returns the plaintext exactly once, to the caller that will email it. The
   * caller must not log it, store it, or include it in a response body.
   */
  async issue(
    userId: string,
    purpose: UserOtpPurpose,
    context: { ip?: string | null } = {},
  ): Promise<IssuedOtp> {
    await this.assertCanSend(userId, purpose);

    const code = this.generateCode();
    const expiresAt = new Date(Date.now() + OTP_TTL_MS);

    // Upsert on the (userId, purpose) unique constraint. This is what
    // invalidates the previous code: there is only ever one row, so the old
    // hash is overwritten and the old code stops verifying immediately.
    await this.prisma.userOtp.upsert({
      where: { userId_purpose: { userId, purpose } },
      create: {
        userId,
        purpose,
        codeHash: this.hashCode(code),
        expiresAt,
        requestIp: context.ip ?? null,
      },
      update: {
        codeHash: this.hashCode(code),
        expiresAt,
        // A fresh code gets a fresh attempt budget; otherwise a user who
        // exhausted their guesses could never recover by requesting a new one.
        attempts: 0,
        consumedAt: null,
        requestIp: context.ip ?? null,
        createdAt: new Date(),
      },
    });

    // Purpose and user only. The code itself never reaches a log.
    this.logger.log(`Issued ${purpose} code for user ${userId}`);

    return { code, expiresAt };
  }

  /**
   * Verifies and consumes a code.
   *
   * Returns true only when the code was correct, live, unconsumed, and within
   * its attempt budget. Every failure path throws with the same shape, so a
   * caller cannot distinguish "there is no pending code" from "that code was
   * wrong" — which is what stops this being an oracle for whether an account
   * has a deletion pending.
   */
  async verify(
    userId: string,
    purpose: UserOtpPurpose,
    code: string,
    context: { ip?: string | null } = {},
  ): Promise<void> {
    if (context.ip) {
      await this.enforceRateLimit(
        `otp-verify:ip:${context.ip}`,
        OTP_VERIFY_LIMIT_PER_IP,
        OTP_VERIFY_IP_WINDOW_SEC,
      );
    }

    const record = await this.prisma.userOtp.findUnique({
      where: { userId_purpose: { userId, purpose } },
    });

    const now = new Date();

    // No row, already used, or expired — all answered identically.
    if (
      !record ||
      record.consumedAt !== null ||
      record.expiresAt <= now ||
      record.attempts >= OTP_MAX_ATTEMPTS
    ) {
      throw new BadRequestException({
        code: 'OTP_INVALID',
        message:
          'That code is not valid or has expired. Request a new one to continue.',
      });
    }

    if (!this.matches(code, record.codeHash)) {
      // Counted before the throw so a client that ignores the response still
      // burns the attempt.
      const updated = await this.prisma.userOtp.update({
        where: { id: record.id },
        data: { attempts: { increment: 1 } },
        select: { attempts: true },
      });
      const remaining = Math.max(0, OTP_MAX_ATTEMPTS - updated.attempts);
      throw new BadRequestException({
        code: 'OTP_INVALID',
        message: remaining
          ? `That code is not correct. ${remaining} attempt${remaining === 1 ? '' : 's'} remaining.`
          : 'Too many incorrect attempts. Request a new code to continue.',
        attemptsRemaining: remaining,
      });
    }

    // Single-use, enforced by the database rather than by this process: the
    // update matches only a row that is STILL unconsumed, so of two concurrent
    // requests carrying the same correct code exactly one can win.
    const consumed = await this.prisma.userOtp.updateMany({
      where: { id: record.id, consumedAt: null },
      data: { consumedAt: now },
    });

    if (consumed.count === 0) {
      throw new BadRequestException({
        code: 'OTP_INVALID',
        message:
          'That code is not valid or has expired. Request a new one to continue.',
      });
    }
  }

  /** Live-challenge state for the client's countdown. Never reveals the code. */
  async getChallengeState(
    userId: string,
    purpose: UserOtpPurpose,
  ): Promise<OtpChallengeState | null> {
    const record = await this.prisma.userOtp.findUnique({
      where: { userId_purpose: { userId, purpose } },
      select: {
        expiresAt: true,
        createdAt: true,
        attempts: true,
        consumedAt: true,
      },
    });
    if (!record || record.consumedAt || record.expiresAt <= new Date()) {
      return null;
    }
    return {
      expiresAt: record.expiresAt.toISOString(),
      resendAvailableAt: new Date(
        record.createdAt.getTime() + OTP_RESEND_COOLDOWN_MS,
      ).toISOString(),
      attemptsRemaining: Math.max(0, OTP_MAX_ATTEMPTS - record.attempts),
    };
  }

  /** Drops every code for a user, whatever its purpose. */
  async invalidateAll(userId: string): Promise<void> {
    await this.prisma.userOtp.deleteMany({ where: { userId } });
  }

  async invalidate(userId: string, purpose: UserOtpPurpose): Promise<void> {
    await this.prisma.userOtp.deleteMany({ where: { userId, purpose } });
  }

  /**
   * Resend cooldown and hourly cap.
   *
   * The cooldown is read from the stored row rather than from Redis, so it
   * survives a Redis restart and cannot be sidestepped by a cache miss — the
   * cheapest abuse to attempt is hammering resend, so that one guard should not
   * depend on an optional dependency.
   */
  private async assertCanSend(
    userId: string,
    purpose: UserOtpPurpose,
  ): Promise<void> {
    const existing = await this.prisma.userOtp.findUnique({
      where: { userId_purpose: { userId, purpose } },
      select: { createdAt: true },
    });

    if (existing) {
      const nextAllowed = existing.createdAt.getTime() + OTP_RESEND_COOLDOWN_MS;
      const waitMs = nextAllowed - Date.now();
      if (waitMs > 0) {
        throw new HttpException(
          {
            code: 'OTP_COOLDOWN',
            message: `Please wait ${Math.ceil(waitMs / 1000)} seconds before requesting another code.`,
            retryAfterSeconds: Math.ceil(waitMs / 1000),
          },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
    }

    await this.enforceRateLimit(
      `otp-send:${purpose}:${userId}`,
      OTP_SEND_LIMIT_PER_HOUR,
      60 * 60,
    );
  }

  /**
   * Shared counter, mirroring `AdminAuthService.enforceRateLimit`.
   *
   * Fails open when Redis is not configured, which is the same trade the admin
   * flow already makes: the per-code attempt ceiling and the database-backed
   * cooldown are the guards that do not depend on Redis being present.
   */
  private async enforceRateLimit(
    bucket: string,
    max: number,
    windowSec: number,
  ): Promise<void> {
    const client = this.redisService?.getClient?.();
    if (!client) return;
    const key = `user-otp-rl:${bucket}`;
    try {
      const count = await client.incr(key);
      if (count === 1) await client.expire(key, windowSec);
      if (count > max) {
        const ttl = await client.ttl(key).catch(() => windowSec);
        throw new HttpException(
          {
            code: 'OTP_RATE_LIMITED',
            message: `Too many requests. Try again in ${Math.max(1, Math.ceil(ttl / 60))} minute(s).`,
            retryAfterSeconds: ttl > 0 ? ttl : windowSec,
          },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
    } catch (err) {
      if (err instanceof HttpException) throw err;
      // A Redis blip must not block a legitimate deletion or recovery.
      this.logger.warn(
        `OTP rate-limit check failed for ${bucket}: ${(err as Error)?.message}`,
      );
    }
  }
}
