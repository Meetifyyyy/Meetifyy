import { UserSessionRevokedReason } from '@prisma/client';
import { stub } from '../../common/testing/stub';
import type { PrismaService } from '../../prisma/prisma.service';
import type { DomainEventService } from '../../events/domain-event.service';
import {
  SESSIONS_REVOKED_EVENT,
  UserSessionService,
} from './user-session.service';

/**
 * The Devices screen: what each login is called, and that signing one out
 * reaches its open realtime sockets at once (every replica sweeps on the
 * event) instead of at the next minute's sweep.
 */
function build(count = 1) {
  const prisma = {
    userSession: {
      findMany: jest.fn(
        (): Promise<{ id: string; familyId: string; userId?: string }[]> =>
          Promise.resolve([{ id: 's1', familyId: 'fam-1' }]),
      ),
      findFirst: jest.fn(() => Promise.resolve({ familyId: 'fam-1' })),
      findUnique: jest.fn(() => Promise.resolve({ familyId: 'fam-1' })),
      updateMany: jest.fn(() => Promise.resolve({ count })),
    },
    pushDevice: { deleteMany: jest.fn(() => Promise.resolve({ count: 0 })) },
  };
  const emit = jest.fn(() => Promise.resolve());
  const service = new UserSessionService(
    stub<PrismaService>(prisma),
    stub<DomainEventService>({ emit }),
  );
  return { service, emit, prisma };
}

describe('device names', () => {
  const name = (ua: string, native = false) =>
    build().service['describe'](ua, native).deviceName;

  it.each([
    [
      'Chrome on Windows',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
    ],
    [
      'Edge on Windows',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0',
    ],
    [
      'Edge on Android',
      'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36 EdgA/130.0.0.0',
    ],
    [
      'Samsung Internet on Android',
      'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/26.0 Chrome/122.0.0.0 Mobile Safari/537.36',
    ],
    [
      'Chrome on iOS',
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0.6723.90 Mobile/15E148 Safari/604.1',
    ],
    [
      'Firefox on iOS',
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/132.0 Mobile/15E148 Safari/605.1.15',
    ],
    [
      'Edge on iOS',
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 EdgiOS/130.0.2849.80 Mobile/15E148 Safari/605.1.15',
    ],
    [
      'Safari on iOS',
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1',
    ],
    [
      'Safari on macOS',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15',
    ],
    [
      'Firefox on Linux',
      'Mozilla/5.0 (X11; Linux x86_64; rv:132.0) Gecko/20100101 Firefox/132.0',
    ],
    [
      'Chrome on ChromeOS',
      'Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
    ],
    [
      'Opera on Windows',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 OPR/115.0.0.0',
    ],
  ])('%s', (expected, ua) => {
    expect(name(ua)).toBe(expected);
  });
});

// Each announcement names the account, so a replica checks only its sockets.
describe('signing a device out reaches its open sockets at once', () => {
  it('announces when one device is signed out', async () => {
    const { service, emit } = build();
    await service.revokeOwnedByUser(
      'u1',
      's1',
      UserSessionRevokedReason.USER_LOGOUT,
    );
    expect(emit).toHaveBeenCalledWith(
      SESSIONS_REVOKED_EVENT,
      { userId: 'u1' },
      [],
    );
  });

  it('announces when every other device is signed out', async () => {
    const { service, emit } = build(3);
    await service.revokeAllForUser(
      'u1',
      UserSessionRevokedReason.USER_LOGOUT,
      's0',
    );
    expect(emit).toHaveBeenCalledWith(
      SESSIONS_REVOKED_EVENT,
      { userId: 'u1' },
      [],
    );
  });

  it('announces when a login ends (sign-out, replay detection), naming its account', async () => {
    const { service, emit, prisma } = build();
    prisma.userSession.findMany.mockResolvedValueOnce([
      { id: 's1', familyId: 'fam-1', userId: 'u1' },
    ]);
    await service.revokeFamily('fam-1', UserSessionRevokedReason.USER_LOGOUT);
    expect(prisma.userSession.findMany).toHaveBeenCalledWith({
      where: { familyId: 'fam-1' },
      select: { id: true, userId: true },
    });
    expect(emit).toHaveBeenCalledWith(
      SESSIONS_REVOKED_EVENT,
      { userId: 'u1' },
      [],
    );
  });

  it('a login whose rows cannot be read still announces, naming nobody (every socket is checked)', async () => {
    const { service, emit, prisma } = build();
    prisma.userSession.findMany.mockRejectedValueOnce(new Error('db down'));
    await service.revokeFamily('fam-1', UserSessionRevokedReason.USER_LOGOUT);
    expect(emit).toHaveBeenCalledWith(SESSIONS_REVOKED_EVENT, {}, []);
  });

  it('stays quiet when nothing was signed out', async () => {
    const { service, emit } = build(0);
    await service.revokeOwnedByUser(
      'u1',
      'gone',
      UserSessionRevokedReason.USER_LOGOUT,
    );
    await service.revokeAllForUser(
      'u1',
      UserSessionRevokedReason.USER_LOGOUT,
      's0',
    );
    expect(emit).not.toHaveBeenCalled();
  });
});
