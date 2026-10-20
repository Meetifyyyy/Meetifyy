import { ConflictException, NotFoundException } from '@nestjs/common';
import { AccountStatus } from '@prisma/client';
import { AdminUsersService } from './admin-users.service';
import { stub } from '../../common/testing/stub';
import type { PrismaService } from '../../prisma/prisma.service';
import type { SupabaseService } from '../../supabase/supabase.service';
import type { CampusAffiliationService } from '../../campus-affiliation/campus-affiliation.service';
import type { UserSessionService } from '../../auth/session/user-session.service';
import { JwtGuard } from '../../common/guards/jwt.guard';

describe('AdminUsersService — account lifecycle', () => {
  const build = (
    user: {
      accountStatus: AccountStatus;
      purgeCompletedAt?: Date | null;
    } | null,
  ) => {
    const update = jest.fn(() => Promise.resolve({ id: 'u1' }));
    const findUnique = jest.fn(() =>
      Promise.resolve(
        user ? { id: 'u1', purgeCompletedAt: null, ...user } : null,
      ),
    );
    const revokeAllForUser = jest.fn(() => Promise.resolve(2));
    const signOut = jest.fn();
    const service = new AdminUsersService(
      stub<PrismaService>({ user: { findUnique, update } }),
      stub<SupabaseService>({
        isConfigured: true,
        client: { auth: { admin: { signOut } } },
      }),
      stub<CampusAffiliationService>(),
      stub<UserSessionService>({ revokeAllForUser }),
    );
    return { service, update, revokeAllForUser, signOut };
  };

  describe('forceLogout', () => {
    it('revokes every session row with the ADMIN_REVOKED reason', async () => {
      const { service, revokeAllForUser, signOut } = build({
        accountStatus: 'ACTIVE',
      });
      const clear = jest.spyOn(JwtGuard, 'clearAccountStatus');

      await expect(service.forceLogout('u1')).resolves.toMatchObject({
        success: true,
        revoked: 2,
      });

      expect(revokeAllForUser).toHaveBeenCalledWith('u1', 'ADMIN_REVOKED');
      expect(clear).toHaveBeenCalledWith('u1');
      // The old Supabase call expected a JWT and was a no-op.
      expect(signOut).not.toHaveBeenCalled();
      // And the account must stay able to sign in again.
      expect(JwtGuard.isUserRevoked('u1')).toBe(false);
      clear.mockRestore();
    });

    it('404s for an unknown user without revoking anything', async () => {
      const { service, revokeAllForUser } = build(null);
      await expect(service.forceLogout('u1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(revokeAllForUser).not.toHaveBeenCalled();
    });
  });

  describe('softDeleteUser', () => {
    it('signs the user out of every device', async () => {
      const { service, revokeAllForUser } = build({ accountStatus: 'ACTIVE' });
      await service.softDeleteUser('u1');
      expect(revokeAllForUser).toHaveBeenCalledWith('u1', 'ACCOUNT_DELETED');
    });
  });

  describe('restoreUser', () => {
    it('refuses a permanently purged account', async () => {
      const { service, update } = build({
        accountStatus: 'DELETED',
        purgeCompletedAt: new Date(),
      });
      await expect(service.restoreUser('u1')).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(update).not.toHaveBeenCalled();
    });

    it.each<AccountStatus>(['ACTIVE', 'SUSPENDED', 'BANNED'])(
      'refuses an account that is %s',
      async (accountStatus) => {
        const { service, update } = build({ accountStatus });
        await expect(service.restoreUser('u1')).rejects.toBeInstanceOf(
          ConflictException,
        );
        expect(update).not.toHaveBeenCalled();
      },
    );

    it.each<AccountStatus>(['DELETED', 'PENDING_DELETION'])(
      'restores a %s account and cancels any scheduled purge',
      async (accountStatus) => {
        const { service, update } = build({ accountStatus });
        await service.restoreUser('u1');
        expect(update).toHaveBeenCalledWith({
          where: { id: 'u1' },
          data: {
            accountStatus: 'ACTIVE',
            deletedAt: null,
            deletionRequestedAt: null,
            scheduledPurgeAt: null,
            purgeAttempts: 0,
            purgeLastError: null,
          },
        });
      },
    );
  });

  describe('unsuspendUser', () => {
    it('refuses a purged account', async () => {
      const { service, update } = build({
        accountStatus: 'SUSPENDED',
        purgeCompletedAt: new Date(),
      });
      await expect(service.unsuspendUser('u1')).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(update).not.toHaveBeenCalled();
    });

    it.each<AccountStatus>(['DELETED', 'PENDING_DELETION', 'BANNED', 'ACTIVE'])(
      'refuses an account that is %s',
      async (accountStatus) => {
        const { service, update } = build({ accountStatus });
        await expect(service.unsuspendUser('u1')).rejects.toBeInstanceOf(
          ConflictException,
        );
        expect(update).not.toHaveBeenCalled();
      },
    );

    it('lifts a real suspension', async () => {
      const { service, update } = build({ accountStatus: 'SUSPENDED' });
      await service.unsuspendUser('u1');
      expect(update).toHaveBeenCalledWith({
        where: { id: 'u1' },
        data: { accountStatus: 'ACTIVE' },
      });
    });
  });

  describe('suspendUser', () => {
    it.each<AccountStatus>(['PENDING_DELETION', 'DELETED', 'BANNED'])(
      'does not overwrite %s',
      async (accountStatus) => {
        const { service, update } = build({ accountStatus });
        await expect(service.suspendUser('u1')).rejects.toBeInstanceOf(
          ConflictException,
        );
        expect(update).not.toHaveBeenCalled();
      },
    );

    it('suspends an active account', async () => {
      const { service, update } = build({ accountStatus: 'ACTIVE' });
      await service.suspendUser('u1', 'spam');
      expect(update).toHaveBeenCalledWith({
        where: { id: 'u1' },
        data: { accountStatus: 'SUSPENDED' },
      });
    });
  });
});
