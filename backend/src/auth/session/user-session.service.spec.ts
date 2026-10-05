import { UserSessionRevokedReason } from '@prisma/client';
import type { UserSession } from '@prisma/client';
import { stub } from '../../common/testing/stub';
import type { PrismaService } from '../../prisma/prisma.service';
import {
  REFRESH_REUSE_GRACE_MS,
  UserSessionService,
} from './user-session.service';

/**
 * Sessions exist so that a stolen credential can be taken away.
 *
 * Before this table, an access token was a pure bearer credential with nothing
 * behind it: a copy lifted off a device kept working and kept refreshing itself
 * until it expired, and signing out cleared only the browser it was performed
 * in. These tests pin the three properties that make revocation real —
 * rotation, replay detection, and ownership-scoped revocation — because each of
 * them is a security boundary rather than a behaviour.
 */
/**
 * A stored session as the fake keeps it: whatever the service wrote, plus the
 * columns the database would default.
 */
type SessionRow = Partial<UserSession> & { id: string };

/** The subset of `where` the service filters sessions by. */
type SessionWhere = {
  id?: string | { not?: string };
  userId?: string;
  familyId?: string;
  refreshHash?: string;
  revoked?: boolean;
  replacedById?: null;
  lastActiveAt?: Date;
};

describe('UserSessionService', () => {
  let service: UserSessionService;

  const rows = new Map<string, SessionRow>();

  beforeEach(() => {
    rows.clear();
    const prisma = stub<PrismaService>({
      userSession: {
        create: jest.fn(
          ({
            data,
            select,
          }: {
            data: Partial<UserSession>;
            select?: object;
          }) => {
            const id = `sess-${rows.size + 1}`;
            // Both columns default to the same insert-time timestamp in the
            // database, which is what "never used" is read from.
            const at = new Date();
            rows.set(id, {
              id,
              replacedById: null,
              revoked: false,
              createdAt: at,
              lastActiveAt: at,
              ...data,
            });
            return Promise.resolve(select ? { id } : rows.get(id));
          },
        ),
        findUnique: jest.fn(
          ({
            where,
            select,
          }: {
            where: { id?: string; refreshHash?: string };
            select?: Partial<Record<keyof SessionRow, boolean>>;
          }) => {
            const found = [...rows.values()].find((r) =>
              where.id
                ? r.id === where.id
                : r.refreshHash === where.refreshHash,
            );
            if (!found) return Promise.resolve(null);
            if (!select) return Promise.resolve(found);
            const out: Partial<SessionRow> = {};
            for (const k of Object.keys(select) as (keyof SessionRow)[])
              Object.assign(out, { [k]: found[k] });
            return Promise.resolve(out);
          },
        ),
        findMany: jest.fn(() => Promise.resolve([...rows.values()])),
        update: jest.fn(
          ({
            where,
            data,
          }: {
            where: { id: string };
            data: Partial<UserSession>;
          }) => {
            const row = rows.get(where.id);
            if (row) Object.assign(row, data);
            return Promise.resolve(row);
          },
        ),
        updateMany: jest.fn(
          ({
            where,
            data,
          }: {
            where: SessionWhere;
            data: Partial<UserSession>;
          }) => {
            let count = 0;
            for (const row of rows.values()) {
              if (
                typeof where.id === 'object' &&
                where.id.not &&
                row.id === where.id.not
              )
                continue;
              if (
                where.id &&
                typeof where.id === 'string' &&
                row.id !== where.id
              )
                continue;
              if (where.userId && row.userId !== where.userId) continue;
              if (where.familyId && row.familyId !== where.familyId) continue;
              if (where.refreshHash && row.refreshHash !== where.refreshHash)
                continue;
              if (where.revoked === false && row.revoked) continue;
              if (where.replacedById === null && row.replacedById) continue;
              if (
                where.lastActiveAt &&
                row.lastActiveAt?.getTime() !== where.lastActiveAt.getTime()
              )
                continue;
              Object.assign(row, data);
              count++;
            }
            return Promise.resolve({ count });
          },
        ),
        deleteMany: jest.fn(() => Promise.resolve({ count: 0 })),
      },
    });
    service = new UserSessionService(prisma);
  });

  /** What JwtGuard does on a session's first use. */
  const markUsed = (sessionId: string) => {
    const row = rows.get(sessionId)!;
    row.lastActiveAt = new Date(row.createdAt!.getTime() + 5_000);
  };

  const device = {
    ip: '1.2.3.4',
    userAgent: 'Mozilla/5.0 (Windows NT) Chrome/1',
  };

  it('stores a hash of the refresh token, never the token', async () => {
    const issued = await service.issue('u1', device);
    const stored = [...rows.values()][0];

    expect(stored.refreshHash).not.toContain(issued.refreshToken);
    expect(stored.refreshHash).toBe(
      service.hashRefreshToken(issued.refreshToken),
    );
  });

  it('labels the device from the user agent, coarsely', async () => {
    await service.issue('u1', device);
    expect([...rows.values()][0].deviceName).toBe('Chrome on Windows');
  });

  it('rotates: the old token stops working and a new one takes over', async () => {
    const first = await service.issue('u1', device);

    const rotated = await service.rotate(first.refreshToken, device);
    expect(rotated.ok).toBe(true);
    if (!rotated.ok) return;
    expect(rotated.session.refreshToken).not.toBe(first.refreshToken);

    // The presented token is now spent once its successor is in use. (While
    // the successor is unused it can still recover a lost response — see the
    // "never arrived" tests below.)
    markUsed(rotated.session.sessionId);
    const reuse = await service.rotate(first.refreshToken, device);
    expect(reuse.ok).toBe(false);
  });

  /**
   * The replay case. A token that arrives already rotated has been used twice
   * and the server cannot tell which holder is legitimate, so the entire family
   * goes — including the successor the attacker may be holding.
   */
  it('revokes the whole family when a rotated token is replayed', async () => {
    const first = await service.issue('u1', device);
    const second = await service.rotate(first.refreshToken, device);
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    // The successor reached its holder and was used (JwtGuard stamps first
    // use). The old token coming back after that is not a lost response.
    markUsed(second.session.sessionId);

    const replay = await service.rotate(first.refreshToken, device);
    expect(replay.ok).toBe(false);
    if (replay.ok) return;
    expect(replay.reason).toBe('replayed');

    // The successor is dead too — that is the point.
    const successor = await service.rotate(second.session.refreshToken, device);
    expect(successor.ok).toBe(false);

    // Every row in the family is unusable. The predecessor carries no replay
    // reason because rotation had already revoked it — overwriting that would
    // erase the fact that it was retired normally, and it is equally dead
    // either way. The live token is the one the reason belongs on.
    expect([...rows.values()].every((r) => r.revoked)).toBe(true);
    expect(
      [...rows.values()].some(
        (r) => r.revokedReason === UserSessionRevokedReason.REFRESH_REPLAY,
      ),
    ).toBe(true);
  });

  describe('a rotation whose response never arrived', () => {
    it('re-issues when the successor was never used', async () => {
      const first = await service.issue('u1', device, 'provider-1');
      const lost = await service.rotate(first.refreshToken, device);
      expect(lost.ok).toBe(true);
      if (!lost.ok) return;
      // The provider token the server stored after the lost refresh.
      rows.get(lost.session.sessionId)!.providerRefresh = 'sealed-provider-2';

      // The app was killed before saving `lost`; it presents what it has.
      const again = await service.rotate(first.refreshToken, device);
      expect(again.ok).toBe(true);
      if (!again.ok) return;
      expect(again.session.sessionId).not.toBe(lost.session.sessionId);
      expect(rows.get(lost.session.sessionId)!.revoked).toBe(true);
      // Carries the newest provider token, not the spent one.
      expect(rows.get(again.session.sessionId)!.providerRefresh).toBe(
        'sealed-provider-2',
      );
      // Nothing else was touched: the family lives on.
      expect(rows.get(again.session.sessionId)!.revoked).toBe(false);

      // And the recovered token rotates normally.
      const next = await service.rotate(again.session.refreshToken, device);
      expect(next.ok).toBe(true);
    });

    it('treats it as theft once the successor has been used', async () => {
      const first = await service.issue('u1', device);
      const second = await service.rotate(first.refreshToken, device);
      if (!second.ok) throw new Error('rotation failed');
      markUsed(second.session.sessionId);

      const replay = await service.rotate(first.refreshToken, device);
      expect(replay).toEqual({ ok: false, reason: 'replayed' });
      expect([...rows.values()].every((r) => r.revoked)).toBe(true);
    });

    it('treats it as theft after the grace period', async () => {
      const first = await service.issue('u1', device);
      const second = await service.rotate(first.refreshToken, device);
      if (!second.ok) throw new Error('rotation failed');
      const old = new Date(Date.now() - REFRESH_REUSE_GRACE_MS - 1000);
      Object.assign(rows.get(second.session.sessionId)!, {
        createdAt: old,
        lastActiveAt: old,
      });

      const replay = await service.rotate(first.refreshToken, device);
      expect(replay).toEqual({ ok: false, reason: 'replayed' });
    });

    it('never recovers for an older ancestor', async () => {
      const first = await service.issue('u1', device);
      const second = await service.rotate(first.refreshToken, device);
      if (!second.ok) throw new Error('rotation failed');
      markUsed(second.session.sessionId);
      const third = await service.rotate(second.session.refreshToken, device);
      expect(third.ok).toBe(true);

      // `first` is two generations back: its successor was rotated already.
      const replay = await service.rotate(first.refreshToken, device);
      expect(replay).toEqual({ ok: false, reason: 'replayed' });
    });
  });

  it('refuses an expired session', async () => {
    const issued = await service.issue('u1', device);
    [...rows.values()][0].expiresAt = new Date(Date.now() - 1000);

    const result = await service.rotate(issued.refreshToken, device);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('expired');
  });

  it('refuses an unknown token', async () => {
    const result = await service.rotate('not-a-real-token', device);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('unknown');
  });

  /** The IDOR case: naming someone else's session id must revoke nothing. */
  it('will not revoke a session belonging to another user', async () => {
    await service.issue('victim', device);
    const victimSessionId = [...rows.values()][0].id;

    const revoked = await service.revokeOwnedByUser(
      'attacker',
      victimSessionId,
      UserSessionRevokedReason.USER_REVOKED_DEVICE,
    );

    expect(revoked).toBe(false);
    expect(rows.get(victimSessionId)!.revoked).toBe(false);
  });

  it('revokes a session the user does own', async () => {
    await service.issue('u1', device);
    const id = [...rows.values()][0].id;

    expect(
      await service.revokeOwnedByUser(
        'u1',
        id,
        UserSessionRevokedReason.USER_REVOKED_DEVICE,
      ),
    ).toBe(true);
    expect(rows.get(id)!.revoked).toBe(true);
  });

  it('signs out every device but the one asking', async () => {
    await service.issue('u1', device);
    await service.issue('u1', device);
    await service.issue('u1', device);
    const keep = [...rows.values()][0].id;

    const count = await service.revokeAllForUser(
      'u1',
      UserSessionRevokedReason.USER_LOGOUT_ALL,
      keep,
    );

    expect(count).toBe(2);
    expect(rows.get(keep)!.revoked).toBe(false);
  });

  it('signs out everything when no session is spared', async () => {
    await service.issue('u1', device);
    await service.issue('u1', device);

    const count = await service.revokeAllForUser(
      'u1',
      UserSessionRevokedReason.PASSWORD_CHANGED,
    );

    expect(count).toBe(2);
    expect([...rows.values()].every((r) => r.revoked)).toBe(true);
  });

  it('reports a revoked session as inactive', async () => {
    await service.issue('u1', device);
    const id = [...rows.values()][0].id;

    expect(await service.isActive(id)).toBe(true);
    await service.revoke(id, UserSessionRevokedReason.USER_LOGOUT);
    expect(await service.isActive(id)).toBe(false);
  });
});
