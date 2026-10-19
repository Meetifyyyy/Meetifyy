import { UserSessionRevokedReason } from '@prisma/client';
import { stub } from '../../common/testing/stub';
import type { PrismaService } from '../../prisma/prisma.service';
import { UserSessionService } from './user-session.service';

/**
 * Signing a login out removes its push registrations, whichever way it is
 * signed out: so a logged-out or account-switched phone stops receiving the
 * previous user's notifications even if the client never got to unregister.
 */
function build() {
  const prisma = {
    userSession: {
      findMany: jest.fn(() =>
        Promise.resolve([
          { id: 's1', familyId: 'fam-1' },
          { id: 's2', familyId: 'fam-1' },
          { id: 's3', familyId: 'fam-2' },
        ]),
      ),
      findFirst: jest.fn(() => Promise.resolve({ familyId: 'fam-9' })),
      findUnique: jest.fn(() => Promise.resolve({ familyId: 'fam-7' })),
      updateMany: jest.fn(() => Promise.resolve({ count: 1 })),
    },
    pushDevice: { deleteMany: jest.fn(() => Promise.resolve({ count: 1 })) },
  };
  return {
    prisma,
    service: new UserSessionService(stub<PrismaService>(prisma)),
  };
}

describe('session revocation removes push devices', () => {
  it('revokeFamily (sign-out, replay detection)', async () => {
    const { prisma, service } = build();
    await service.revokeFamily('fam-1', UserSessionRevokedReason.USER_LOGOUT);
    expect(prisma.pushDevice.deleteMany).toHaveBeenCalledWith({
      where: { familyId: { in: ['fam-1'] } },
    });
  });

  it('revokeByRefreshHash (logout from the app with its refresh token)', async () => {
    const { prisma, service } = build();
    await service.revokeByRefreshHash(
      'hash',
      UserSessionRevokedReason.USER_LOGOUT,
    );
    expect(prisma.pushDevice.deleteMany).toHaveBeenCalledWith({
      where: { familyId: { in: ['fam-7'] } },
    });
  });

  it('revokeAllForUser (sign out everywhere, password change)', async () => {
    const { prisma, service } = build();
    await service.revokeAllForUser(
      'user-a',
      UserSessionRevokedReason.USER_LOGOUT,
    );
    expect(prisma.pushDevice.deleteMany).toHaveBeenCalledWith({
      where: { familyId: { in: ['fam-1', 'fam-2'] } },
    });
  });

  it("revokeOwnedByUser (sign out one device from Settings) only touches the caller's session", async () => {
    const { prisma, service } = build();
    await service.revokeOwnedByUser(
      'user-a',
      's9',
      UserSessionRevokedReason.USER_LOGOUT,
    );
    expect(prisma.userSession.findFirst).toHaveBeenCalledWith({
      where: { id: 's9', userId: 'user-a' },
      select: { familyId: true },
    });
    expect(prisma.pushDevice.deleteMany).toHaveBeenCalledWith({
      where: { familyId: { in: ['fam-9'] } },
    });
  });

  it('a device cleanup failure never fails the sign-out', async () => {
    const { prisma, service } = build();
    prisma.pushDevice.deleteMany.mockRejectedValue(new Error('db'));
    await expect(
      service.revokeFamily('fam-1', UserSessionRevokedReason.USER_LOGOUT),
    ).resolves.toBeUndefined();
  });
});
