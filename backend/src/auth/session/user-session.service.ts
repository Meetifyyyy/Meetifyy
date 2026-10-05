import { Injectable, Logger } from '@nestjs/common';
import { UserSessionRevokedReason } from '@prisma/client';
import * as crypto from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { JwtGuard } from '../../common/guards/jwt.guard';
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

/**
 * How long a lost rotation can be recovered (see `recoverLostRotation`).
 *
 * Published grace windows run from a few seconds (Supabase's reuse interval is
 * 10 s) to about 30 s. This is a little longer because it is also narrower:
 * plain reuse intervals accept the parent even after its successor was used,
 * while this requires the successor never to have been used — so an attacker
 * holding the parent inside the window gains a session that is revoked as soon
 * as the real app comes back. The app no longer renews while it is in the
 * background, which removes the "killed mid-refresh by the OS" case this
 * would otherwise have to stretch to cover.
 */
export const REFRESH_REUSE_GRACE_MS = 60 * 1000;

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
   *
   * With one exception, for a response that never arrived — see
   * `recoverLostRotation`.
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
      return this.onReuse(existing, existing.replacedById, device);
    }

    if (existing.revoked) return { ok: false, reason: 'revoked' };
    if (existing.expiresAt <= new Date())
      return { ok: false, reason: 'expired' };

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

    // Conditional, so two requests presenting the same token at once cannot
    // both succeed: the read above is not a lock, and without this the second
    // overwrote `replacedById` and left the first holding a successor the
    // family no longer pointed at.
    const claimed = await this.prisma.userSession.updateMany({
      where: { id: existing.id, replacedById: null },
      data: {
        replacedById: next.id,
        revoked: true,
        revokedAt: new Date(),
        lastActiveAt: new Date(),
      },
    });
    if (claimed.count !== 1) {
      // Somebody rotated it first. Ours was never handed out, so it goes, and
      // this presentation is judged like any other reuse.
      await this.prisma.userSession
        .deleteMany({ where: { id: next.id } })
        .catch(() => undefined);
      const winner = await this.prisma.userSession.findUnique({
        where: { id: existing.id },
        select: { replacedById: true },
      });
      if (!winner?.replacedById) return { ok: false, reason: 'revoked' };
      return this.onReuse(existing, winner.replacedById, device);
    }

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
   * A token that has already been rotated, presented again.
   *
   * Normally theft, and answered by revoking the whole family. But one
   * innocent cause looks identical from here: the response carrying the
   * successor never reached the app — it was killed mid-request (swiped away,
   * or reclaimed by the OS; some phones pre-start and kill apps in the
   * background), or the connection dropped. Its next launch then presents the
   * only token it has, and strict detection signed the user out for it. That
   * was observed on a device.
   *
   * RFC 9700 asks for reuse detection, and the major providers temper it for
   * exactly this case: Supabase accepts the immediately previous token within
   * a reuse interval, Auth0 has a rotation overlap period. This follows them,
   * narrowly — `recoverLostRotation` lists the conditions.
   */
  private async onReuse(
    existing: {
      id: string;
      userId: string;
      familyId: string;
      expiresAt: Date;
    },
    successorId: string,
    device: DeviceInfo,
  ): Promise<
    | { ok: true; userId: string; session: RotatedSession }
    | { ok: false; reason: 'replayed' }
  > {
    const recovered = await this.recoverLostRotation(
      existing,
      successorId,
      device,
    );
    if (recovered) return recovered;

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

  /**
   * Re-issues from a token whose successor demonstrably never reached anyone.
   *
   * All of these must hold, or this returns null and the family is revoked:
   *   - the presented token is the IMMEDIATE parent of the live token — an
   *     older ancestor is always treated as theft;
   *   - that successor has not itself been rotated, revoked, or USED: its
   *     `lastActiveAt` is still its creation time, which JwtGuard advances on
   *     first use (`JwtGuard.markSessionUsed`). A legitimate app uses its new token straight away, so a
   *     successor that was handed to anyone and used is not a lost response;
   *   - the successor is at most REFRESH_REUSE_GRACE_MS old;
   *   - the session itself has not expired.
   *
   * The unused successor is revoked and a new one minted from the presented
   * token, carrying the successor's provider token — the newest one; the
   * presented token's own copy has already been spent at the provider.
   * Claimed with a conditional update, so two presentations cannot both win.
   */
  private async recoverLostRotation(
    existing: {
      id: string;
      userId: string;
      familyId: string;
      expiresAt: Date;
    },
    successorId: string,
    device: DeviceInfo,
  ): Promise<{ ok: true; userId: string; session: RotatedSession } | null> {
    if (existing.expiresAt <= new Date()) return null;

    const successor = await this.prisma.userSession.findUnique({
      where: { id: successorId },
      select: {
        id: true,
        revoked: true,
        replacedById: true,
        createdAt: true,
        lastActiveAt: true,
        providerRefresh: true,
      },
    });
    if (!successor || successor.revoked || successor.replacedById) return null;
    if (!successor.createdAt || !successor.lastActiveAt) return null;
    if (successor.lastActiveAt.getTime() !== successor.createdAt.getTime())
      return null;
    if (Date.now() - successor.createdAt.getTime() > REFRESH_REUSE_GRACE_MS)
      return null;

    const claimed = await this.prisma.userSession.updateMany({
      where: {
        id: successor.id,
        revoked: false,
        replacedById: null,
        lastActiveAt: successor.lastActiveAt,
      },
      data: { revoked: true, revokedAt: new Date() },
    });
    if (claimed.count !== 1) return null;
    JwtGuard.forgetSession(successor.id);

    const nextToken = this.newRefreshToken();
    const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_MS);
    const next = await this.prisma.userSession.create({
      data: {
        userId: existing.userId,
        familyId: existing.familyId,
        refreshHash: this.hashRefreshToken(nextToken),
        providerRefresh: successor.providerRefresh,
        expiresAt,
        ip: device.ip ?? null,
        userAgent: device.userAgent?.slice(0, 512) ?? null,
        ...this.describe(device.userAgent),
      },
      select: { id: true },
    });
    await this.prisma.userSession.update({
      where: { id: existing.id },
      data: { replacedById: next.id },
    });

    this.logger.warn(
      `session.refresh_recovered ${JSON.stringify({
        userId: existing.userId,
        familyId: existing.familyId,
      })}`,
    );
    return {
      ok: true,
      userId: existing.userId,
      session: {
        sessionId: next.id,
        familyId: existing.familyId,
        refreshToken: nextToken,
        expiresAt,
        providerRefreshToken: openSecret(successor.providerRefresh),
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
    JwtGuard.forgetSession(sessionId);
  }

  async revokeFamily(
    familyId: string,
    reason: UserSessionRevokedReason,
  ): Promise<void> {
    const affected = await this.prisma.userSession
      .findMany({ where: { familyId }, select: { id: true } })
      .catch(() => [] as { id: string }[]);

    await this.prisma.userSession
      .updateMany({
        where: { familyId, revoked: false },
        data: { revoked: true, revokedAt: new Date(), revokedReason: reason },
      })
      .catch(() => undefined);

    affected.forEach((s) => JwtGuard.forgetSession(s.id));
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
    const where = {
      userId,
      revoked: false,
      ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}),
    };

    const affected = await this.prisma.userSession
      .findMany({ where, select: { id: true } })
      .catch(() => [] as { id: string }[]);

    const result = await this.prisma.userSession.updateMany({
      where,
      data: { revoked: true, revokedAt: new Date(), revokedReason: reason },
    });

    affected.forEach((s) => JwtGuard.forgetSession(s.id));
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
    const existing = await this.prisma.userSession
      .findUnique({ where: { refreshHash }, select: { id: true } })
      .catch(() => null);

    await this.prisma.userSession
      .updateMany({
        where: { refreshHash, revoked: false },
        data: { revoked: true, revokedAt: new Date(), revokedReason: reason },
      })
      .catch(() => undefined);

    if (existing) JwtGuard.forgetSession(existing.id);
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
    // The guard caches liveness for a few seconds; dropping the entry makes the
    // revocation felt on the very next request rather than at the end of that
    // window. Correctness does not depend on it — the cache expires either way
    // — but "sign out" should not appear to do nothing for ten seconds.
    JwtGuard.forgetSession(sessionId);
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
