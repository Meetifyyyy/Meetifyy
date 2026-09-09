import { Injectable, Logger } from '@nestjs/common';
import { UserSessionRevokedReason } from '@prisma/client';
import * as crypto from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { sealSecret, openSecret } from '../../common/crypto/secret-box';

/** How long a refresh token stays usable before the user must sign in again. */
export const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * How long a revocation takes to be felt on an access token that is already
 * issued.
 *
 * Checking the session table on every request would put a query in front of all
 * 194 authenticated endpoints, so the guard caches the answer. That cache is
 * the entire cost of revocation: a token revoked now keeps working for at most
 * this long. Thirty seconds is short enough that "sign out all devices" feels
 * immediate to the person clicking it and to the attacker holding the token,
 * and long enough that the table is not read on every request of every user.
 */
export const SESSION_STATE_CACHE_MS = 30 * 1000;

export interface DeviceInfo {
  ip?: string | null;
  userAgent?: string | null;
}

/** What a rotation hands back to the caller, including the provider token. */
export interface RotatedSession extends IssuedSession {
  providerRefreshToken: string | null;
}

export interface IssuedSession {
  sessionId: string;
  familyId: string;
  refreshToken: string;
  expiresAt: Date;
}

/**
 * Server-side sessions for regular users.
 *
 * The problem this exists to solve: an access token was a pure bearer
 * credential with nothing behind it. Nothing recorded that a device was signed
 * in, so nothing could sign it out — a copy lifted from one machine kept
 * working, and kept minting new access tokens off the refresh token, until it
 * expired on its own. Logging out cleared the browser it was performed in.
 *
 * Sessions are keyed by a hash of the refresh token, never the token. A
 * database dump therefore yields nothing usable, which is the same reason the
 * admin table has always stored a hash.
 */
@Injectable()
export class UserSessionService {
  private readonly logger = new Logger(UserSessionService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * 64 random bytes. There is no user-chosen material here and no guessing to
   * defend against, so the stored form is a plain SHA-256 rather than a slow
   * password hash — the same choice the admin sessions make.
   */
  private newRefreshToken(): string {
    return crypto.randomBytes(64).toString('hex');
  }

  hashRefreshToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  /**
   * A short human label for the device list, derived from the user agent.
   *
   * Deliberately coarse. This is shown to the person deciding whether a row is
   * theirs, so "Chrome on Windows" answers the question; anything finer starts
   * to look like tracking and is not more useful for the decision.
   */
  private describe(userAgent?: string | null): {
    deviceName: string;
    browser: string;
    os: string;
  } {
    const ua = (userAgent || '').toLowerCase();

    const browser = ua.includes('edg/')
      ? 'Edge'
      : ua.includes('opr/') || ua.includes('opera')
        ? 'Opera'
        : ua.includes('chrome') && !ua.includes('chromium')
          ? 'Chrome'
          : ua.includes('firefox')
            ? 'Firefox'
            : ua.includes('safari')
              ? 'Safari'
              : 'Browser';

    const os = ua.includes('android')
      ? 'Android'
      : /iphone|ipad|ipod/.test(ua)
        ? 'iOS'
        : ua.includes('mac os')
          ? 'macOS'
          : ua.includes('windows')
            ? 'Windows'
            : ua.includes('linux')
              ? 'Linux'
              : 'Unknown device';

    return { deviceName: `${browser} on ${os}`, browser, os };
  }

  /** Starts a new session family — one login on one device. */
  async issue(
    userId: string,
    device: DeviceInfo,
    providerRefreshToken?: string | null,
  ): Promise<IssuedSession> {
    const refreshToken = this.newRefreshToken();
    const familyId = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_MS);
    const described = this.describe(device.userAgent);

    const session = await this.prisma.userSession.create({
      data: {
        userId,
        familyId,
        refreshHash: this.hashRefreshToken(refreshToken),
        providerRefresh: providerRefreshToken
          ? sealSecret(providerRefreshToken)
          : null,
        expiresAt,
        ip: device.ip ?? null,
        userAgent: device.userAgent?.slice(0, 512) ?? null,
        ...described,
      },
      select: { id: true },
    });

    return { sessionId: session.id, familyId, refreshToken, expiresAt };
  }

  /**
   * Rotates a refresh token, or refuses and burns the family.
   *
   * Every refresh mints a new token and marks the old one as replaced. So a
   * token that arrives already carrying `replacedById` has been used twice, and
   * the server cannot tell which of the two holders is the legitimate one — the
   * thief may have refreshed first. Revoking the whole family is the only safe
   * answer: both parties are signed out, and the real user notices and signs in
   * again, which is the outcome we want over silently letting an attacker ride
   * along.
   */
  async rotate(
    refreshToken: string,
    device: DeviceInfo,
  ): Promise<
    | { ok: true; userId: string; session: RotatedSession }
    | { ok: false; reason: 'unknown' | 'expired' | 'revoked' | 'replayed' }
  > {
    const hash = this.hashRefreshToken(refreshToken);
    const existing = await this.prisma.userSession.findUnique({
      where: { refreshHash: hash },
      select: {
        id: true,
        userId: true,
        familyId: true,
        expiresAt: true,
        revoked: true,
        replacedById: true,
        providerRefresh: true,
      },
    });

    if (!existing) return { ok: false, reason: 'unknown' };

    if (existing.replacedById) {
      await this.revokeFamily(
        existing.familyId,
        UserSessionRevokedReason.REFRESH_REPLAY,
      );
      this.logger.warn(
        `session.refresh_replay ${JSON.stringify({
          userId: existing.userId,
          familyId: existing.familyId,
        })}`,
      );
      return { ok: false, reason: 'replayed' };
    }

    if (existing.revoked) return { ok: false, reason: 'revoked' };
    if (existing.expiresAt <= new Date()) return { ok: false, reason: 'expired' };

    const nextToken = this.newRefreshToken();
    const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_MS);
    const described = this.describe(device.userAgent);

    // The successor is created first so that, if anything fails between the two
    // writes, the worst outcome is an orphaned row rather than a session whose
    // predecessor is marked replaced with nothing to replace it.
    const next = await this.prisma.userSession.create({
      data: {
        userId: existing.userId,
        familyId: existing.familyId,
        refreshHash: this.hashRefreshToken(nextToken),
        // Carried forward as-is; the caller re-seals it if the provider issues
        // a new one, which Supabase does on every refresh.
        providerRefresh: existing.providerRefresh,
        expiresAt,
        ip: device.ip ?? null,
        userAgent: device.userAgent?.slice(0, 512) ?? null,
        ...described,
      },
      select: { id: true },
    });

    await this.prisma.userSession.update({
      where: { id: existing.id },
      data: {
        replacedById: next.id,
        revoked: true,
        revokedAt: new Date(),
        lastActiveAt: new Date(),
      },
    });

    return {
      ok: true,
      userId: existing.userId,
      session: {
        sessionId: next.id,
        familyId: existing.familyId,
        refreshToken: nextToken,
        expiresAt,
        providerRefreshToken: openSecret(existing.providerRefresh),
      },
    };
  }

  /**
   * Replaces the stored provider token after the provider rotates it.
   *
   * Supabase issues a new refresh token on every refresh and retires the old
   * one, so the row has to be updated or the next rotation presents a token the
   * provider has already invalidated.
   */
  async storeProviderRefresh(
    sessionId: string,
    providerRefreshToken: string,
  ): Promise<void> {
    await this.prisma.userSession
      .update({
        where: { id: sessionId },
        data: { providerRefresh: sealSecret(providerRefreshToken) },
      })
      .catch(() => undefined);
  }

  /** True when this session may still be used. */
  async isActive(sessionId: string): Promise<boolean> {
    const session = await this.prisma.userSession.findUnique({
      where: { id: sessionId },
      select: { revoked: true, expiresAt: true },
    });
    return Boolean(
      session && !session.revoked && session.expiresAt > new Date(),
    );
  }

  async touch(sessionId: string): Promise<void> {
    await this.prisma.userSession
      .update({
        where: { id: sessionId },
        data: { lastActiveAt: new Date() },
      })
      .catch(() => undefined);
  }

  async revoke(
    sessionId: string,
    reason: UserSessionRevokedReason,
  ): Promise<void> {
    await this.prisma.userSession
      .updateMany({
        where: { id: sessionId, revoked: false },
        data: { revoked: true, revokedAt: new Date(), revokedReason: reason },
      })
      .catch(() => undefined);
  }

  async revokeFamily(
    familyId: string,
    reason: UserSessionRevokedReason,
  ): Promise<void> {
    await this.prisma.userSession
      .updateMany({
        where: { familyId, revoked: false },
        data: { revoked: true, revokedAt: new Date(), revokedReason: reason },
      })
      .catch(() => undefined);
  }

  /**
   * Signs out every device.
   *
   * `exceptSessionId` keeps the caller signed in, which is what the settings
   * screen wants: someone ending other sessions is not asking to be logged out
   * of the one they are looking at. Password changes pass nothing, because
   * there the point is that everything starts again.
   */
  async revokeAllForUser(
    userId: string,
    reason: UserSessionRevokedReason,
    exceptSessionId?: string,
  ): Promise<number> {
    const result = await this.prisma.userSession.updateMany({
      where: {
        userId,
        revoked: false,
        ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}),
      },
      data: { revoked: true, revokedAt: new Date(), revokedReason: reason },
    });
    return result.count;
  }

  /**
   * The device list.
   *
   * Only live sessions, and never the hash — a row here identifies a device to
   * its owner, and the credential behind it is not part of that.
   */
  async listForUser(userId: string, currentSessionId?: string) {
    const sessions = await this.prisma.userSession.findMany({
      where: { userId, revoked: false, expiresAt: { gt: new Date() } },
      orderBy: { lastActiveAt: 'desc' },
      select: {
        id: true,
        deviceName: true,
        browser: true,
        os: true,
        ip: true,
        createdAt: true,
        lastActiveAt: true,
      },
    });

    return sessions.map((s) => ({
      ...s,
      current: s.id === currentSessionId,
    }));
  }

  /** The live session id behind a refresh token, for "which device is this?". */
  async sessionIdForRefreshToken(token: string): Promise<string | null> {
    const session = await this.prisma.userSession.findUnique({
      where: { refreshHash: this.hashRefreshToken(token) },
      select: { id: true, revoked: true },
    });
    return session && !session.revoked ? session.id : null;
  }

  async revokeByRefreshHash(
    refreshHash: string,
    reason: UserSessionRevokedReason,
  ): Promise<void> {
    await this.prisma.userSession
      .updateMany({
        where: { refreshHash, revoked: false },
        data: { revoked: true, revokedAt: new Date(), revokedReason: reason },
      })
      .catch(() => undefined);
  }

  /**
   * Revokes one session, but only if it belongs to this user.
   *
   * The ownership predicate is in the `where`, not a check before it: a caller
   * naming somebody else's session id matches zero rows and is told the session
   * does not exist, which is also the honest answer from their point of view.
   */
  async revokeOwnedByUser(
    userId: string,
    sessionId: string,
    reason: UserSessionRevokedReason,
  ): Promise<boolean> {
    const result = await this.prisma.userSession.updateMany({
      where: { id: sessionId, userId, revoked: false },
      data: { revoked: true, revokedAt: new Date(), revokedReason: reason },
    });
    return result.count > 0;
  }

  /** Drops rows that can no longer authorize anything. */
  async purgeExpired(olderThan = new Date()): Promise<number> {
    const result = await this.prisma.userSession.deleteMany({
      where: { expiresAt: { lt: olderThan } },
    });
    return result.count;
  }
}
