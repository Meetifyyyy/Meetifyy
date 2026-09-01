import { ConflictException, NotFoundException } from '@nestjs/common';
import { AccountDeletionService } from './account-deletion.service';
import { RECOVERY_WINDOW_MS } from './account-deletion.constants';
import { JwtGuard } from '../common/guards/jwt.guard';

/**
 * The reversible half of the lifecycle: request → recover, and the state
 * machine's refusals. The race against the purge worker is covered in
 * account-deletion.purge.spec.ts, which drives both halves against one shared
 * fake row.
 */
describe('AccountDeletionService — 30-day recovery window', () => {
  const USER_ID = 'user-1';

  let service: AccountDeletionService;
  let prisma: any;
  let presenceService: any;
  let domainEventService: any;
  let otpService: any;
  let emailService: any;
  let row: any;

  beforeEach(() => {
    row = {
      id: USER_ID,
      email: 'sam@example.edu',
      accountStatus: 'ACTIVE',
      deletedAt: null,
      deletionRequestedAt: null,
      scheduledPurgeAt: null,
      purgeStartedAt: null,
      purgeAttempts: 0,
      purgeLastError: null,
    };

    /** Applies a Prisma-style `where` against the single fake row. */
    const matches = (where: any): boolean => {
      if (where.id && where.id !== row.id) return false;
      if (where.accountStatus && where.accountStatus !== row.accountStatus) {
        return false;
      }
      if (where.deletedAt === null && row.deletedAt !== null) return false;
      if (where.purgeStartedAt === null && row.purgeStartedAt !== null) {
        return false;
      }
      if (where.scheduledPurgeAt?.gt) {
        if (
          !row.scheduledPurgeAt ||
          row.scheduledPurgeAt <= where.scheduledPurgeAt.gt
        ) {
          return false;
        }
      }
      return true;
    };

    prisma = {
      user: {
        findUnique: jest.fn(async ({ where }: any) =>
          where.id === USER_ID ? { ...row } : null,
        ),
        updateMany: jest.fn(async ({ where, data }: any) => {
          if (!matches(where)) return { count: 0 };
          Object.assign(row, data);
          return { count: 1 };
        }),
      },
    };

    presenceService = { removePresence: jest.fn(async () => {}) };
    domainEventService = { emit: jest.fn() };

    otpService = {
      issue: jest.fn(async () => ({
        code: '123456',
        expiresAt: new Date(Date.now() + 600_000),
      })),
      verify: jest.fn(async () => {}),
      invalidate: jest.fn(async () => {}),
      invalidateAll: jest.fn(async () => {}),
      // No live challenge by default, so `issue` is the normal path.
      getChallengeState: jest.fn(async () => null),
    };
    emailService = {
      sendAccountDeletionOtpEmail: jest.fn(async () => {}),
      sendAccountRecoveryOtpEmail: jest.fn(async () => {}),
    };

    service = new AccountDeletionService(
      prisma,
      { getClient: () => null } as any,
      presenceService,
      domainEventService,
      otpService,
      emailService,
    );
  });

  describe('requestDeletion', () => {
    it('moves an active account into the window and schedules the purge 30 days out', async () => {
      const before = Date.now();
      const status = await service.requestDeletion(USER_ID);
      const after = Date.now();

      expect(row.accountStatus).toBe('PENDING_DELETION');
      // Stamped so the ~137 existing `deletedAt: null` filters hide the account
      // everywhere at once — search, profile, suggestions, followers.
      expect(row.deletedAt).toBeInstanceOf(Date);
      expect(status.pendingDeletion).toBe(true);
      expect(status.recoverable).toBe(true);

      const scheduled = new Date(status.scheduledPurgeAt!).getTime();
      const requested = new Date(status.deletionRequestedAt!).getTime();
      expect(scheduled - requested).toBe(RECOVERY_WINDOW_MS);
      expect(requested).toBeGreaterThanOrEqual(before);
      expect(requested).toBeLessThanOrEqual(after);
      expect(status.daysRemaining).toBe(29); // 30 days minus the elapsed ms
    });

    it('leaves every profile field intact so recovery has something to restore', async () => {
      await service.requestDeletion(USER_ID);
      const written = prisma.user.updateMany.mock.calls[0][0].data;
      expect(written).not.toHaveProperty('username');
      expect(written).not.toHaveProperty('displayName');
      expect(written).not.toHaveProperty('email');
      expect(written).not.toHaveProperty('avatar');
    });

    it('does not revoke the session — the owner needs one to reach the recovery screen', async () => {
      await service.requestDeletion(USER_ID);
      expect(JwtGuard.isUserRevoked(USER_ID)).toBe(false);
    });

    it('drops presence so the account stops appearing online', async () => {
      await service.requestDeletion(USER_ID);
      expect(presenceService.removePresence).toHaveBeenCalledWith(USER_ID);
    });

    it('is idempotent — a duplicate request never restarts the 30 days', async () => {
      const first = await service.requestDeletion(USER_ID);
      const second = await service.requestDeletion(USER_ID);
      expect(second.scheduledPurgeAt).toBe(first.scheduledPurgeAt);
      expect(prisma.user.updateMany).toHaveBeenCalledTimes(1);
    });

    it('refuses an account that has already been purged', async () => {
      row.accountStatus = 'DELETED';
      row.deletedAt = new Date();
      await expect(service.requestDeletion(USER_ID)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('recoverAccount', () => {
    beforeEach(async () => {
      await service.requestDeletion(USER_ID);
    });

    it('restores the account to active and clears every deletion timestamp', async () => {
      const status = await service.recoverAccount(USER_ID);
      expect(row.accountStatus).toBe('ACTIVE');
      expect(row.deletedAt).toBeNull();
      expect(row.deletionRequestedAt).toBeNull();
      expect(row.scheduledPurgeAt).toBeNull();
      expect(status.pendingDeletion).toBe(false);
      expect(domainEventService.emit).toHaveBeenCalledWith(
        'user.deletion_cancelled',
        { userId: USER_ID },
      );
    });

    it('lifts any outstanding revocation so the restored session works', async () => {
      JwtGuard.revokeUser(USER_ID);
      await service.recoverAccount(USER_ID);
      expect(JwtGuard.isUserRevoked(USER_ID)).toBe(false);
    });

    it('is idempotent — a double-click or a second device succeeds twice', async () => {
      await service.recoverAccount(USER_ID);
      await expect(service.recoverAccount(USER_ID)).resolves.toMatchObject({
        pendingDeletion: false,
      });
    });

    it('refuses once the 30 days have passed', async () => {
      row.scheduledPurgeAt = new Date(Date.now() - 1000);
      await expect(service.recoverAccount(USER_ID)).rejects.toThrow(
        ConflictException,
      );
      expect(row.accountStatus).toBe('PENDING_DELETION');
    });

    it('refuses once the purge worker has claimed the row', async () => {
      // The claim is what closes the window early; without this check a user
      // could "recover" an account that is already being anonymized.
      row.purgeStartedAt = new Date();
      await expect(service.recoverAccount(USER_ID)).rejects.toThrow(
        ConflictException,
      );
    });

    it('refuses an account that has already been permanently deleted', async () => {
      row.accountStatus = 'DELETED';
      await expect(service.recoverAccount(USER_ID)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ── The OTP gate ─────────────────────────────────────────────────────────
  describe('one-time-code gating', () => {
    it('requesting a deletion code schedules nothing', async () => {
      const res = await service.requestDeletionOtp(USER_ID);

      expect(res.otpRequired).toBe(true);
      expect(row.accountStatus).toBe('ACTIVE');
      expect(row.deletedAt).toBeNull();
      expect(otpService.issue).toHaveBeenCalledWith(
        USER_ID,
        'ACCOUNT_DELETION',
        expect.anything(),
      );
    });

    it('emails the code and never returns it', async () => {
      const res: any = await service.requestDeletionOtp(USER_ID);
      const [, , code] = emailService.sendAccountDeletionOtpEmail.mock.calls[0];
      expect(code).toBe('123456');
      expect(JSON.stringify(res)).not.toContain('123456');
    });

    it('masks the address rather than echoing it', async () => {
      // The OTP screen may be read over the user's shoulder — and a shoulder is
      // usually why the code step exists.
      const res = await service.requestDeletionOtp(USER_ID);
      expect(res.maskedEmail).toBe('s••••@example.edu');
      expect(res.maskedEmail).not.toContain('sam');
    });

    it('masks to a fixed width, so the address length is not published', async () => {
      row.email = 'a-very-long-local-part@example.edu';
      const long = await service.requestDeletionOtp(USER_ID);

      row.email = 'jo@example.edu';
      row.accountStatus = 'ACTIVE';
      const short = await service.requestDeletionOtp(USER_ID);

      expect(long.maskedEmail).toBe('a••••@example.edu');
      expect(short.maskedEmail).toBe('j••••@example.edu');
    });

    it('resumes a live challenge instead of re-sending or erroring', async () => {
      // A refresh during the code step, a second tab, or a double-click. The
      // old behaviour hit the resend cooldown and stranded the user on an error
      // for a minute while a perfectly good code sat in their inbox.
      otpService.getChallengeState.mockResolvedValueOnce({
        expiresAt: '2026-09-01T10:10:00.000Z',
        resendAvailableAt: '2026-09-01T10:01:00.000Z',
        attemptsRemaining: 5,
      });

      const res = await service.requestDeletionOtp(USER_ID);

      expect(res).toMatchObject({
        otpRequired: true,
        expiresAt: '2026-09-01T10:10:00.000Z',
        // Taken from the stored row, not recomputed — otherwise a refresh
        // would quietly reset the cooldown.
        resendAvailableAt: '2026-09-01T10:01:00.000Z',
      });
      expect(otpService.issue).not.toHaveBeenCalled();
      expect(emailService.sendAccountDeletionOtpEmail).not.toHaveBeenCalled();
    });

    it('resumes a live recovery challenge the same way', async () => {
      await service.requestDeletion(USER_ID);
      otpService.getChallengeState.mockResolvedValueOnce({
        expiresAt: '2026-09-01T10:10:00.000Z',
        resendAvailableAt: '2026-09-01T10:01:00.000Z',
        attemptsRemaining: 3,
      });

      await service.requestRecoveryOtp(USER_ID);
      expect(emailService.sendAccountRecoveryOtpEmail).not.toHaveBeenCalled();
    });

    it('confirming with a valid code schedules the deletion', async () => {
      await service.confirmDeletion(USER_ID, '123456');
      expect(otpService.verify).toHaveBeenCalledWith(
        USER_ID,
        'ACCOUNT_DELETION',
        '123456',
        expect.anything(),
      );
      expect(row.accountStatus).toBe('PENDING_DELETION');
    });

    it('a rejected code leaves the account completely untouched', async () => {
      otpService.verify.mockRejectedValueOnce(new Error('OTP_INVALID'));
      await expect(
        service.confirmDeletion(USER_ID, '000000'),
      ).rejects.toThrow();
      expect(row.accountStatus).toBe('ACTIVE');
      expect(row.deletedAt).toBeNull();
    });

    it('refuses a deletion code for an account already in its window', async () => {
      await service.requestDeletion(USER_ID);
      otpService.issue.mockClear();
      await expect(service.requestDeletionOtp(USER_ID)).rejects.toThrow(
        ConflictException,
      );
      expect(otpService.issue).not.toHaveBeenCalled();
    });

    it('a rejected recovery code leaves the deletion scheduled', async () => {
      await service.requestDeletion(USER_ID);
      otpService.verify.mockRejectedValueOnce(new Error('OTP_INVALID'));
      await expect(
        service.confirmRecovery(USER_ID, '000000'),
      ).rejects.toThrow();
      expect(row.accountStatus).toBe('PENDING_DELETION');
    });

    it('confirming recovery with a valid code restores the account', async () => {
      await service.requestDeletion(USER_ID);
      await service.confirmRecovery(USER_ID, '123456');
      expect(otpService.verify).toHaveBeenCalledWith(
        USER_ID,
        'ACCOUNT_RECOVERY',
        '123456',
        expect.anything(),
      );
      expect(row.accountStatus).toBe('ACTIVE');
    });

    it('refuses to send a recovery code once the window has closed', async () => {
      // Checked before the email, so a user is never walked through an OTP
      // screen for a recovery that cannot succeed at the end of it.
      await service.requestDeletion(USER_ID);
      row.scheduledPurgeAt = new Date(Date.now() - 1000);
      await expect(service.requestRecoveryOtp(USER_ID)).rejects.toThrow(
        ConflictException,
      );
      expect(emailService.sendAccountRecoveryOtpEmail).not.toHaveBeenCalled();
    });

    it('refuses to send a recovery code once the purge worker has claimed the row', async () => {
      await service.requestDeletion(USER_ID);
      row.purgeStartedAt = new Date();
      await expect(service.requestRecoveryOtp(USER_ID)).rejects.toThrow(
        ConflictException,
      );
    });

    it('drops every outstanding code on recovery', async () => {
      // A deletion code issued moments before recovery would otherwise stay
      // live for the rest of its ten minutes — and it is a code that schedules
      // a deletion.
      await service.requestDeletion(USER_ID);
      await service.confirmRecovery(USER_ID, '123456');
      expect(otpService.invalidateAll).toHaveBeenCalledWith(USER_ID);
    });

    it('drops any live recovery code when a new window opens', async () => {
      await service.requestDeletion(USER_ID);
      expect(otpService.invalidate).toHaveBeenCalledWith(
        USER_ID,
        'ACCOUNT_RECOVERY',
      );
    });
  });

  describe('getStatus', () => {
    it('reports nothing pending for an active account', async () => {
      const status = await service.getStatus(USER_ID);
      expect(status).toMatchObject({
        pendingDeletion: false,
        recoverable: false,
        scheduledPurgeAt: null,
      });
    });

    it('hides the recover button once the row is claimed', async () => {
      await service.requestDeletion(USER_ID);
      row.purgeStartedAt = new Date();
      const status = await service.getStatus(USER_ID);
      expect(status.pendingDeletion).toBe(true);
      expect(status.recoverable).toBe(false);
    });
  });
});
