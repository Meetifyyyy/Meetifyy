import { HttpException, ValidationPipe } from '@nestjs/common';
import { Prisma, UserOtpPurpose } from '@prisma/client';
import { AccountEmailService } from './account-email.service';
import { VerifyPersonalEmailDto } from './account-email.dto';
import { UserOtpService } from '../otp/user-otp.service';
import { createUserOtpStore } from '../otp/testing/user-otp-store.fake';
import { stub } from '../common/testing/stub';
import type { PrismaService } from '../prisma/prisma.service';
import type { RedisService } from '../redis/redis.service';
import type { SupabaseService } from '../supabase/supabase.service';
import type { AuthService } from '../auth/auth.service';
import type { AddressMailer } from '../otp/address-mailer';
import type { AuthenticatedUser } from '../common/types/authenticated-request';

/**
 * Changing the sign-in email: OTP to the new address only, password re-proven,
 * code consumed before anything is applied, the applied address is the code's
 * bound target, and the auth email is changed only after all of that.
 */
describe('AccountEmailService', () => {
  const ME = 'user-me';
  const OTHER = 'user-other';
  const ACTOR = stub<AuthenticatedUser>({ id: ME, email: 'me@gla.ac.in' });

  let users: Map<string, { id: string; email: string; displayName: string }>;
  let otpStore: ReturnType<typeof createUserOtpStore>;
  let sent: Array<{ to: string; code: string }>;
  let updateUserById: jest.Mock;
  let userUpdate: jest.Mock;
  let verifyPassword: jest.Mock;
  let failNextDbUpdate: Error | null;
  let notice: jest.Mock<Promise<void>, [string, string, string]>;
  let service: AccountEmailService;

  beforeEach(() => {
    users = new Map([
      [ME, { id: ME, email: 'me@gla.ac.in', displayName: 'Me' }],
      [OTHER, { id: OTHER, email: 'taken@gmail.com', displayName: 'O' }],
    ]);
    otpStore = createUserOtpStore();
    sent = [];
    failNextDbUpdate = null;
    notice = jest.fn<Promise<void>, [string, string, string]>(() =>
      Promise.resolve(),
    );
    updateUserById = jest.fn(() => Promise.resolve({ error: null }));
    verifyPassword = jest.fn((_u: AuthenticatedUser, password: string) =>
      Promise.resolve({ valid: password === 'right-password' }),
    );
    userUpdate = jest.fn(
      ({ where, data }: { where: { id: string }; data: { email: string } }) => {
        if (failNextDbUpdate) {
          const err = failNextDbUpdate;
          failNextDbUpdate = null;
          return Promise.reject(err);
        }
        const row = users.get(where.id)!;
        row.email = data.email;
        return Promise.resolve(row);
      },
    );

    const prisma = stub<PrismaService>({
      userOtp: otpStore.model,
      user: {
        findUnique: jest.fn(
          ({ where }: { where: { id?: string; email?: string } }) => {
            if (where.id) return Promise.resolve(users.get(where.id) ?? null);
            for (const u of users.values()) {
              if (u.email === where.email) return Promise.resolve(u);
            }
            return Promise.resolve(null);
          },
        ),
        // The uniqueness check: `email: { equals, mode }` and `id: { not }`,
        // evaluated the way Postgres would for `mode: 'insensitive'`.
        findFirst: jest.fn(
          ({
            where,
          }: {
            where: {
              email: { equals: string; mode?: 'insensitive' | 'default' };
              id: { not: string };
            };
          }) => {
            const { equals, mode } = where.email;
            const same = (a: string) =>
              mode === 'insensitive'
                ? a.toLowerCase() === equals.toLowerCase()
                : a === equals;
            for (const u of users.values()) {
              if (u.id !== where.id.not && same(u.email)) {
                return Promise.resolve({ id: u.id });
              }
            }
            return Promise.resolve(null);
          },
        ),
        update: userUpdate,
      },
    });
    const mailer: AddressMailer = {
      sendCollegeEmailOtp: jest.fn(() => Promise.resolve()),
      sendPersonalEmailOtp: jest.fn((to: string, _n: string, code: string) => {
        sent.push({ to, code });
        return Promise.resolve();
      }),
      sendSignInEmailChangedNotice: notice,
    };
    service = new AccountEmailService(
      prisma,
      stub<SupabaseService>({
        isConfigured: true,
        client: { auth: { admin: { updateUserById } } },
      }),
      new UserOtpService(prisma, stub<RedisService>({ getClient: () => null })),
      stub<AuthService>({ verifyPassword }),
      mailer,
    );
  });

  const code = () => sent[sent.length - 1].code;
  const wrongCode = () => (code() === '000000' ? '111111' : '000000');
  const errorCode = async (p: Promise<unknown>) => {
    const err = await p.then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(HttpException);
    return ((err as HttpException).getResponse() as { code?: string }).code;
  };

  describe('sending', () => {
    it('sends the code to the NEW address only, bound to it, stored hashed', async () => {
      const res = await service.requestOtp(ME, '  Me.Personal@Gmail.com ');
      expect(sent.map((m) => m.to)).toEqual(['me.personal@gmail.com']);
      expect(code()).toMatch(/^\d{6}$/);
      expect(res.emailMasked).toBe('me***@gmail.com');
      const row = otpStore.get(ME, UserOtpPurpose.PERSONAL_EMAIL)!;
      expect(row.target).toBe('me.personal@gmail.com');
      expect(row.codeHash).not.toContain(code());
      expect(row.expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(
        10 * 60 * 1000 + 1000,
      );
    });

    it('refuses the current address, an address in use, and placeholders', async () => {
      expect(await errorCode(service.requestOtp(ME, 'ME@gla.ac.in'))).toBe(
        'same_email',
      );
      expect(await errorCode(service.requestOtp(ME, 'taken@gmail.com'))).toBe(
        'email_taken',
      );
      expect(await errorCode(service.requestOtp(ME, `x@meetifyy.user`))).toBe(
        'invalid_email',
      );
      expect(await errorCode(service.requestOtp(ME, 'not-an-email'))).toBe(
        'invalid_email',
      );
      expect(sent).toHaveLength(0);
    });

    it('treats a legacy mixed-case User.email as taken', async () => {
      // Legacy rows were stored as typed; the target is normalized lowercase.
      users.get(OTHER)!.email = 'Taken.Legacy@Gmail.com';
      expect(
        await errorCode(service.requestOtp(ME, 'taken.legacy@gmail.com')),
      ).toBe('email_taken');
      expect(sent).toHaveLength(0);
    });

    it('enforces the resend cooldown', async () => {
      await service.requestOtp(ME, 'a@gmail.com');
      await expect(service.requestOtp(ME, 'a@gmail.com')).rejects.toThrow(
        HttpException,
      );
    });
  });

  describe('verifying', () => {
    it('applies the bound address: auth email (confirmed) first, then User.email', async () => {
      await service.requestOtp(ME, 'new@gmail.com');
      await expect(
        service.verify(ACTOR, code(), 'right-password'),
      ).resolves.toEqual({ email: 'new@gmail.com' });

      expect(updateUserById).toHaveBeenCalledWith(ME, {
        email: 'new@gmail.com',
        email_confirm: true,
      });
      expect(users.get(ME)?.email).toBe('new@gmail.com');
      // The OLD address is told, with the new one masked.
      expect(notice).toHaveBeenCalledWith(
        'me@gla.ac.in',
        'Me',
        'ne***@gmail.com',
      );
      // Consumed before applying.
      expect(
        otpStore.get(ME, UserOtpPurpose.PERSONAL_EMAIL)?.consumedAt,
      ).not.toBeNull();
    });

    it('still succeeds when the notice to the old address cannot be queued', async () => {
      notice.mockRejectedValueOnce(new Error('queue down'));
      await service.requestOtp(ME, 'new@gmail.com');
      await expect(
        service.verify(ACTOR, code(), 'right-password'),
      ).resolves.toEqual({ email: 'new@gmail.com' });
    });

    it('sends no notice when nothing changed', async () => {
      await service.requestOtp(ME, 'new@gmail.com');
      await service
        .verify(ACTOR, wrongCode(), 'right-password')
        .catch(() => null);
      expect(notice).not.toHaveBeenCalled();
    });

    it('refuses a wrong code and changes nothing', async () => {
      await service.requestOtp(ME, 'new@gmail.com');
      expect(
        await errorCode(service.verify(ACTOR, wrongCode(), 'right-password')),
      ).toBe('invalid_code');
      expect(updateUserById).not.toHaveBeenCalled();
      expect(users.get(ME)?.email).toBe('me@gla.ac.in');
    });

    it('refuses an expired code', async () => {
      await service.requestOtp(ME, 'new@gmail.com');
      otpStore.get(ME, UserOtpPurpose.PERSONAL_EMAIL)!.expiresAt = new Date(
        Date.now() - 1,
      );
      expect(
        await errorCode(service.verify(ACTOR, code(), 'right-password')),
      ).toBe('expired_code');
      expect(updateUserById).not.toHaveBeenCalled();
    });

    it('refuses a replayed code', async () => {
      await service.requestOtp(ME, 'new@gmail.com');
      await service.verify(ACTOR, code(), 'right-password');
      updateUserById.mockClear();
      expect(
        await errorCode(service.verify(ACTOR, code(), 'right-password')),
      ).toBe('invalid_code');
      expect(updateUserById).not.toHaveBeenCalled();
    });

    it('refuses a wrong password without burning the code', async () => {
      await service.requestOtp(ME, 'new@gmail.com');
      expect(await errorCode(service.verify(ACTOR, code(), 'wrong'))).toBe(
        'invalid_password',
      );
      expect(updateUserById).not.toHaveBeenCalled();
      const row = otpStore.get(ME, UserOtpPurpose.PERSONAL_EMAIL)!;
      expect(row.consumedAt).toBeNull();
      expect(row.attempts).toBe(0);
      // Checked against the account's current address.
      expect(verifyPassword).toHaveBeenCalledWith(
        expect.objectContaining({ email: 'me@gla.ac.in' }),
        'wrong',
      );
    });

    it('refuses when the target was taken by another account after sending', async () => {
      await service.requestOtp(ME, 'new@gmail.com');
      users.get(OTHER)!.email = 'new@gmail.com';
      expect(
        await errorCode(service.verify(ACTOR, code(), 'right-password')),
      ).toBe('email_taken');
      expect(updateUserById).not.toHaveBeenCalled();
      expect(users.get(ME)?.email).toBe('me@gla.ac.in');
    });

    it('refuses when a legacy mixed-case row took the target after sending', async () => {
      await service.requestOtp(ME, 'new@gmail.com');
      users.get(OTHER)!.email = 'NEW@Gmail.com';
      expect(
        await errorCode(service.verify(ACTOR, code(), 'right-password')),
      ).toBe('email_taken');
      expect(updateUserById).not.toHaveBeenCalled();
    });

    it('maps an auth-side duplicate to email_taken and leaves User.email alone', async () => {
      await service.requestOtp(ME, 'new@gmail.com');
      updateUserById.mockResolvedValueOnce({
        error: {
          message: 'A user with this email address has already been registered',
        },
      });
      expect(
        await errorCode(service.verify(ACTOR, code(), 'right-password')),
      ).toBe('email_taken');
      expect(userUpdate).not.toHaveBeenCalled();
    });

    it('restores the auth email when the database write loses a race (P2002)', async () => {
      await service.requestOtp(ME, 'new@gmail.com');
      failNextDbUpdate = new Prisma.PrismaClientKnownRequestError('dup', {
        code: 'P2002',
        clientVersion: 'test',
      });
      expect(
        await errorCode(service.verify(ACTOR, code(), 'right-password')),
      ).toBe('email_taken');
      expect(updateUserById).toHaveBeenLastCalledWith(ME, {
        email: 'me@gla.ac.in',
        email_confirm: true,
      });
    });
  });

  describe('the verify body', () => {
    const pipe = new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    });
    const validate = (body: Record<string, unknown>) =>
      pipe.transform(body, {
        type: 'body',
        metatype: VerifyPersonalEmailDto,
      }) as Promise<VerifyPersonalEmailDto>;

    it('has no email field: an email in the body is refused, never applied', async () => {
      await expect(
        validate({
          code: '123456',
          currentPassword: 'x',
          email: 'attacker@evil.com',
        }),
      ).rejects.toThrow(HttpException);
      const ok = await validate({ code: '123456', currentPassword: 'x' });
      expect(ok).not.toHaveProperty('email');
    });
  });

  it('reports needsPersonalEmail from the affiliation', async () => {
    const prisma = stub<PrismaService>({
      user: {
        findUnique: jest.fn(() =>
          Promise.resolve({
            email: 'Me@gla.ac.in',
            collegeAffiliation: {
              email: 'me@gla.ac.in',
              emailNormalized: 'me@gla.ac.in',
            },
          }),
        ),
      },
    });
    const s = new AccountEmailService(
      prisma,
      stub<SupabaseService>({}),
      stub<UserOtpService>({}),
      stub<AuthService>({}),
      stub<AddressMailer>({}),
    );
    await expect(s.getStatus(ME)).resolves.toEqual({
      email: 'Me@gla.ac.in',
      collegeEmail: 'me@gla.ac.in',
      needsPersonalEmail: true,
    });
  });
});
