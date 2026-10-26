import { buildGateway, fakeSocket } from './testing/gateway.fixture';
import type { RealtimeGateway } from './realtime.gateway';

/**
 * The minute sweep that closes sockets of sessions that ended.
 *
 * A token refresh revokes the old session row and creates a new one in the
 * same family (the same login). Treating that as a sign-out closed the app's
 * socket within a minute of every refresh, and a client never re-dials a
 * socket the server closed, so every live feature in the app (confession
 * reactions, instant match) stayed dead until a restart.
 */
describe('RealtimeGateway — session sweep', () => {
  const now = Date.now();
  const live = (id: string, familyId: string) => ({
    id,
    familyId,
    revoked: false,
    expiresAt: new Date(now + 3_600_000),
  });
  const revoked = (id: string, familyId: string) => ({
    id,
    familyId,
    revoked: true,
    expiresAt: new Date(now + 3_600_000),
  });

  const socketFor = (sessionId: string) =>
    fakeSocket({
      data: { userId: `user-of-${sessionId}`, sessionId },
      emit: jest.fn(),
      disconnect: jest.fn(),
    });

  const run = async (
    sockets: ReturnType<typeof socketFor>[],
    rows: ReturnType<typeof live>[],
    familyLive: { id: string; familyId: string }[],
  ) => {
    const findMany = jest
      .fn<Promise<unknown[]>, [unknown]>()
      .mockResolvedValueOnce(rows)
      .mockResolvedValueOnce(familyLive);
    const gateway: RealtimeGateway = buildGateway({
      redis: { getClient: jest.fn() },
      prisma: {
        user: { findMany: jest.fn().mockResolvedValue([]) },
        userSession: { findMany },
      },
    });
    (gateway as unknown as { server: unknown }).server = {
      sockets: { sockets: new Map(sockets.map((s, i) => [`s${i}`, s])) },
    };
    await gateway['disconnectRevokedSessions']();
    return findMany;
  };

  it('keeps a socket whose session was rotated, and moves it to the new session', async () => {
    const rotated = socketFor('old');
    const findMany = await run(
      [rotated],
      [revoked('old', 'login-1')],
      [{ id: 'new', familyId: 'login-1' }],
    );
    expect(rotated.disconnect).not.toHaveBeenCalled();
    expect(rotated.data.sessionId).toBe('new');
    const familyQuery = findMany.mock.calls[1][0] as {
      where: { familyId: { in: string[] }; revoked: boolean };
    };
    expect(familyQuery.where.familyId).toEqual({ in: ['login-1'] });
    expect(familyQuery.where.revoked).toBe(false);
  });

  it('closes a socket whose login has no live session left (signed out)', async () => {
    const signedOut = socketFor('gone');
    await run([signedOut], [revoked('gone', 'login-2')], []);
    expect(signedOut.emit).toHaveBeenCalledWith('session:revoked', {
      reason: 'signed_out',
    });
    expect(signedOut.disconnect).toHaveBeenCalledWith(true);
  });

  it('closes a socket naming a session that does not exist', async () => {
    const unknown = socketFor('nope');
    await run([unknown], [], []);
    expect(unknown.disconnect).toHaveBeenCalledWith(true);
  });

  it('asks about families only when some session was rotated', async () => {
    const ok = socketFor('fine');
    const findMany = await run([ok], [live('fine', 'login-3')], []);
    expect(findMany).toHaveBeenCalledTimes(1);
    expect(ok.disconnect).not.toHaveBeenCalled();
  });
});
