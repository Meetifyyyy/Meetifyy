import { UserSessionRevokedReason } from '@prisma/client';
import { UserSessionService } from './user-session.service';

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
describe('UserSessionService', () => {
  let prisma: any;
  let service: UserSessionService;

  const rows = new Map<string, any>();

  beforeEach(() => {
    rows.clear();
    prisma = {
      userSession: {
        create: jest.fn(async ({ data, select }) => {
          const id = `sess-${rows.size + 1}`;
          rows.set(id, { id, replacedById: null, revoked: false, ...data });
          return select ? { id } : rows.get(id);
        }),
        findUnique: jest.fn(async ({ where, select }) => {
          const found = [...rows.values()].find((r) =>
            where.id ? r.id === where.id : r.refreshHash === where.refreshHash,
          );
          if (!found) return null;
          if (!select) return found;
          const out: any = {};
          for (const k of Object.keys(select)) out[k] = found[k];
          return out;
        }),
        findMany: jest.fn(async () => [...rows.values()]),
        update: jest.fn(async ({ where, data }) => {
          const row = rows.get(where.id);
          if (row) Object.assign(row, data);
          return row;
        }),
        updateMany: jest.fn(async ({ where, data }) => {
          let count = 0;
          for (const row of rows.values()) {
            if (where.id?.not && row.id === where.id.not) continue;
            if (where.id && typeof where.id === 'string' && row.id !== where.id)
              continue;
            if (where.userId && row.userId !== where.userId) continue;
            if (where.familyId && row.familyId !== where.familyId) continue;
            if (where.refreshHash && row.refreshHash !== where.refreshHash)
              continue;
            if (where.revoked === false && row.revoked) continue;
            Object.assign(row, data);
            count++;
          }
          return { count };
        }),
        deleteMany: jest.fn(async () => ({ count: 0 })),
      },
    };
    service = new UserSessionService(prisma);
  });

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

    // The presented token is now spent.
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
    expect(rows.get(victimSessionId).revoked).toBe(false);
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
    expect(rows.get(id).revoked).toBe(true);
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
    expect(rows.get(keep).revoked).toBe(false);
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
