import {
  BadRequestException,
  ConflictException,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthService, ProviderRefreshUnavailableError } from './auth.service';
import { stub } from '../common/testing/stub';
import type { AuthenticatedUser } from '../common/types/authenticated-request';
import type { PrismaService } from '../prisma/prisma.service';
import type {
  SupabaseAuthClient,
  SupabaseService,
} from '../supabase/supabase.service';
import type { DefaultAssetsService } from '../uploads/default-assets.service';
import type { DomainValidatorService } from '../common/services/domain-validator.service';
import type { LegalConsentService } from '../common/legal/legal-consent.service';

/**
 * The auth calls that used to be made from the browser.
 *
 * Signup, confirmation-code resend and the password-reset request all went from
 * the client straight to Supabase, so none of them passed through a limit of
 * ours — on three endpoints that send mail out of a budget shared by every user
 * of the project. Moving them behind this service is what makes those budgets
 * possible, and it introduces one hazard that has to be pinned down: which
 * Supabase key the calls are made with.
 */
type SignUpCredentials = { email: string; password: string; options?: unknown };
type ResetOptions = { redirectTo?: string };

const makeAnonAuth = () => ({
  signUp: jest.fn<Promise<unknown>, [SignUpCredentials]>(),
  resend: jest
    .fn<Promise<unknown>, [unknown]>()
    .mockResolvedValue({ error: null }),
  resetPasswordForEmail: jest
    .fn<Promise<unknown>, [string, ResetOptions]>()
    .mockResolvedValue({ error: null }),
});

const makeAdminAuth = () => ({
  signUp: jest.fn<Promise<unknown>, [SignUpCredentials]>(),
  resend: jest.fn<Promise<unknown>, [unknown]>(),
  resetPasswordForEmail: jest.fn<Promise<unknown>, [string, ResetOptions]>(),
  signInWithPassword: jest.fn<Promise<unknown>, [unknown]>(),
  admin: {
    signOut: jest.fn<Promise<unknown>, [string, string?]>().mockResolvedValue({
      error: null,
    }),
    // No auth record by default, so the token claim is what gets checked.
    getUserById: jest
      .fn<Promise<unknown>, [string]>()
      .mockResolvedValue({ data: { user: null }, error: null }),
  },
});

describe('the public auth proxies', () => {
  let prisma: {
    user: {
      findFirst: jest.Mock<Promise<{ id: string } | null>, [unknown]>;
      findUnique: jest.Mock<Promise<{ email: string } | null>, [unknown]>;
    };
  };
  let anonAuth: ReturnType<typeof makeAnonAuth>;
  let adminAuth: ReturnType<typeof makeAdminAuth>;
  let service: AuthService;

  const build = ({ anonConfigured = true } = {}) => {
    anonAuth = makeAnonAuth();
    adminAuth = makeAdminAuth();

    prisma = {
      user: {
        findFirst: jest
          .fn<Promise<{ id: string } | null>, [unknown]>()
          .mockResolvedValue({ id: 'u1' }),
        findUnique: jest
          .fn<Promise<{ email: string } | null>, [unknown]>()
          .mockResolvedValue(null),
      },
    };
    const supabaseService = stub<SupabaseService>({
      isConfigured: true,
      isAnonConfigured: anonConfigured,
      client: stub<SupabaseAuthClient>({
        auth: stub<SupabaseAuthClient['auth']>(adminAuth),
      }),
      get anonClient() {
        if (!anonConfigured) {
          throw new Error('Supabase anon client is not initialized.');
        }
        return stub<SupabaseAuthClient>({
          auth: stub<SupabaseAuthClient['auth']>(anonAuth),
        });
      },
    });

    service = new AuthService(
      stub<PrismaService>(prisma),
      supabaseService,
      stub<DomainValidatorService>(),
      stub<DefaultAssetsService>(),
      stub<LegalConsentService>(),
    );
  };

  beforeEach(() => build());

  // ── The one that matters most ──────────────────────────────────────────
  //
  // GoTrue decides what an auth call MEANS from the key that made it. A
  // `POST /signup` carrying the service-role key is read as an admin creating
  // a user: the account comes back ALREADY CONFIRMED and no code is sent. The
  // shared `client` prefers the service-role key whenever one is configured,
  // so routing signup through it would hand out verified accounts to anyone
  // who can type an address, and leave the OTP step with nothing to verify.
  describe('never signs up through the service-role client', () => {
    it('uses the anon client for signup', async () => {
      anonAuth.signUp.mockResolvedValue({
        data: { user: { identities: [{ id: 'i1' }] } },
        error: null,
      });

      await service.signUpWithEmail({
        email: 'student@college.edu',
        password: 'a-good-password',
        username: 'student',
      });

      expect(anonAuth.signUp).toHaveBeenCalledTimes(1);
      expect(adminAuth.signUp).not.toHaveBeenCalled();
    });

    it('uses the anon client for the code resend', async () => {
      await service.resendSignupOtp('student@college.edu');
      expect(anonAuth.resend).toHaveBeenCalledTimes(1);
      expect(adminAuth.resend).not.toHaveBeenCalled();
    });

    it('uses the anon client for the password-reset email', async () => {
      await service.requestPasswordReset('student@college.edu');
      expect(anonAuth.resetPasswordForEmail).toHaveBeenCalledTimes(1);
      expect(adminAuth.resetPasswordForEmail).not.toHaveBeenCalled();
    });

    it('refuses rather than falling back when no anon key is configured', async () => {
      // Degrading to the admin key here is the one outcome that cannot be
      // allowed, so a missing key must fail loudly.
      build({ anonConfigured: false });
      await expect(
        service.signUpWithEmail({ email: 'a@b.edu', password: 'x'.repeat(10) }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(adminAuth.signUp).not.toHaveBeenCalled();
    });
  });

  describe('signup', () => {
    it('normalises the address before it reaches Supabase', async () => {
      anonAuth.signUp.mockResolvedValue({
        data: { user: { identities: [{ id: 'i1' }] } },
        error: null,
      });
      await service.signUpWithEmail({
        email: '  Student@College.EDU  ',
        password: 'a-good-password',
      });
      expect(anonAuth.signUp.mock.calls[0][0].email).toBe(
        'student@college.edu',
      );
    });

    it('reports an address already part-way through signup as a conflict', async () => {
      // Supabase answers this case with a user carrying an empty identities
      // array and NO error, so without the check the client saw a success and
      // moved to a code screen for a code that was never sent.
      anonAuth.signUp.mockResolvedValue({
        data: { user: { identities: [] } },
        error: null,
      });
      await expect(
        service.signUpWithEmail({
          email: 'a@b.edu',
          password: 'a-good-password',
        }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('passes an upstream refusal through as a 400', async () => {
      anonAuth.signUp.mockResolvedValue({
        data: null,
        error: { message: 'Password should be at least 6 characters' },
      });
      await expect(
        service.signUpWithEmail({ email: 'a@b.edu', password: 'short' }),
      ).rejects.toThrow('Password should be at least 6 characters');
    });

    describe('early validation (before anything is sent to Supabase)', () => {
      it('refuses a reserved username with a 400', async () => {
        for (const username of ['admin', 'Support', 'deleted_x1']) {
          await expect(
            service.signUpWithEmail({
              email: 'a@b.edu',
              password: 'a-good-password',
              username,
            }),
          ).rejects.toBeInstanceOf(BadRequestException);
        }
        expect(anonAuth.signUp).not.toHaveBeenCalled();
      });

      it('refuses an invalid birthday with a 400', async () => {
        for (const birthday of ['2999-01-01', '2002-02-31', 'not-a-date']) {
          await expect(
            service.signUpWithEmail({
              email: 'a@b.edu',
              password: 'a-good-password',
              birthday,
            }),
          ).rejects.toBeInstanceOf(BadRequestException);
        }
        expect(anonAuth.signUp).not.toHaveBeenCalled();
      });

      it('still accepts a signup that omits the birthday (older clients)', async () => {
        anonAuth.signUp.mockResolvedValue({
          data: { user: { identities: [{ id: 'i1' }] } },
          error: null,
        });
        await expect(
          service.signUpWithEmail({
            email: 'a@b.edu',
            password: 'a-good-password',
          }),
        ).resolves.toEqual({ pending: true });
      });

      it('accepts a valid birthday and an ordinary username', async () => {
        anonAuth.signUp.mockResolvedValue({
          data: { user: { identities: [{ id: 'i1' }] } },
          error: null,
        });
        await expect(
          service.signUpWithEmail({
            email: 'a@b.edu',
            password: 'a-good-password',
            username: 'ravi',
            birthday: '2000-05-17',
          }),
        ).resolves.toEqual({ pending: true });
      });
    });

    it('requires both an address and a password', async () => {
      await expect(
        service.signUpWithEmail({ email: '', password: 'a-good-password' }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(anonAuth.signUp).not.toHaveBeenCalled();
    });
  });

  describe('password reset request', () => {
    it('sends nothing when no account exists, and says so', async () => {
      prisma.user.findFirst.mockResolvedValue(null);
      const result = await service.requestPasswordReset('nobody@college.edu');
      expect(result).toEqual({ exists: false, sent: false });
      expect(anonAuth.resetPasswordForEmail).not.toHaveBeenCalled();
    });

    it('builds the redirect target itself rather than taking one from the caller', async () => {
      // A caller-supplied redirectTo on a reset link is an open redirect that
      // carries a recovery token in its fragment.
      await service.requestPasswordReset('student@college.edu');
      const [, options] = anonAuth.resetPasswordForEmail.mock.calls[0];
      expect(options.redirectTo).toMatch(/^https?:\/\//);
      expect(options.redirectTo).toContain('/reset-password');
    });

    it('reports a dispatch failure without claiming the account is missing', async () => {
      anonAuth.resetPasswordForEmail.mockResolvedValue({
        error: { message: 'smtp unavailable' },
      });
      const result = await service.requestPasswordReset('student@college.edu');
      // `exists` stays true: an outage is not evidence the address is wrong,
      // and the screen must not tell a real user they have no account.
      expect(result).toEqual({ exists: true, sent: false });
    });
  });

  describe('current-password verification', () => {
    const caller: AuthenticatedUser = {
      id: 'u1',
      email: 'student@college.edu',
      user_metadata: {},
      token: 't',
    };

    it('confirms a correct password without returning a session', async () => {
      adminAuth.signInWithPassword.mockResolvedValue({
        data: { session: { access_token: 'minted' } },
        error: null,
      });
      const result = await service.verifyPassword(caller, 'right-password');
      expect(result).toEqual({ valid: true });
      // A boolean and nothing else — the caller already has a session, and
      // handing back a second one is what used to replace the browser's.
      expect(Object.keys(result)).toEqual(['valid']);
    });

    it('revokes the session the check itself minted', async () => {
      adminAuth.signInWithPassword.mockResolvedValue({
        data: { session: { access_token: 'minted' } },
        error: null,
      });
      await service.verifyPassword(caller, 'right-password');
      expect(adminAuth.admin.signOut).toHaveBeenCalledWith('minted', 'local');
    });

    it('still succeeds when that revocation is unavailable', async () => {
      // Needs the service-role key. Failing a password change over a bookkeeping
      // call would be far worse than leaving a session to expire on its own.
      adminAuth.signInWithPassword.mockResolvedValue({
        data: { session: { access_token: 'minted' } },
        error: null,
      });
      adminAuth.admin.signOut.mockRejectedValue(new Error('not permitted'));
      await expect(
        service.verifyPassword(caller, 'right-password'),
      ).resolves.toEqual({ valid: true });
    });

    it('answers false — not 401 — for a wrong password', async () => {
      // 401 is the status the client's interceptor treats as a dead session and
      // signs the user out over, which is not what a mistyped password means.
      adminAuth.signInWithPassword.mockResolvedValue({
        data: null,
        error: { message: 'Invalid login credentials' },
      });
      await expect(
        service.verifyPassword(caller, 'wrong-password'),
      ).resolves.toEqual({ valid: false });
    });

    it('refuses an account with no real address behind it', async () => {
      const placeholder = { ...caller, email: 'u1@meetifyy.user' };
      await expect(
        service.verifyPassword(placeholder, 'anything'),
      ).resolves.toEqual({ valid: false });
      expect(adminAuth.signInWithPassword).not.toHaveBeenCalled();
    });

    it('checks against the CURRENT auth email, not the token claim (after a personal-email change)', async () => {
      adminAuth.admin.getUserById.mockResolvedValue({
        data: { user: { email: 'new.personal@gmail.com' } },
        error: null,
      });
      adminAuth.signInWithPassword.mockResolvedValue({
        data: { session: { access_token: 'minted' } },
        error: null,
      });
      await service.verifyPassword(caller, 'right-password');
      expect(adminAuth.signInWithPassword).toHaveBeenCalledWith({
        email: 'new.personal@gmail.com',
        password: 'right-password',
      });
    });

    it('falls back to the user row when the auth record cannot be read', async () => {
      adminAuth.admin.getUserById.mockRejectedValue(new Error('down'));
      prisma.user.findUnique.mockResolvedValue({ email: 'row@gmail.com' });
      adminAuth.signInWithPassword.mockResolvedValue({
        data: null,
        error: { message: 'Invalid login credentials' },
      });
      await service.verifyPassword(caller, 'pw');
      expect(adminAuth.signInWithPassword).toHaveBeenCalledWith({
        email: 'row@gmail.com',
        password: 'pw',
      });
    });

    it('never verifies an empty password', async () => {
      await expect(service.verifyPassword(caller, '')).resolves.toEqual({
        valid: false,
      });
      expect(adminAuth.signInWithPassword).not.toHaveBeenCalled();
    });
  });

  describe('canonicalLoginEmail', () => {
    it('normalises an email identifier without touching the database', async () => {
      await expect(
        service.canonicalLoginEmail('  Ada@Example.EDU '),
      ).resolves.toBe('ada@example.edu');
      expect(prisma.user.findUnique).not.toHaveBeenCalled();
    });

    it('resolves a username to its normalised email', async () => {
      prisma.user.findUnique.mockResolvedValue({ email: 'Ada@Example.edu' });
      await expect(service.canonicalLoginEmail('Ada')).resolves.toBe(
        'ada@example.edu',
      );
    });

    it('returns null for an unknown username', async () => {
      await expect(service.canonicalLoginEmail('nobody')).resolves.toBeNull();
    });
  });

  describe('refreshProviderSession — transient vs definitive failures', () => {
    const refreshWith = (result: unknown) => {
      const refreshSession = jest.fn(() =>
        result instanceof Error
          ? Promise.reject(result)
          : Promise.resolve(result),
      );
      (adminAuth as unknown as { refreshSession: unknown }).refreshSession =
        refreshSession;
      return refreshSession;
    };

    it.each([
      ['a thrown network error', new Error('fetch failed')],
      [
        'a retryable fetch error',
        {
          data: {},
          error: Object.assign(new Error('x'), {
            status: 0,
            name: 'AuthRetryableFetchError',
          }),
        },
      ],
      [
        'an error with no status',
        { data: {}, error: new Error('socket hang up') },
      ],
      [
        'a 502',
        {
          data: {},
          error: Object.assign(new Error('bad gateway'), { status: 502 }),
        },
      ],
      [
        'a 429',
        {
          data: {},
          error: Object.assign(new Error('slow down'), { status: 429 }),
        },
      ],
    ])('throws ProviderRefreshUnavailableError for %s', async (_n, result) => {
      refreshWith(result);
      await expect(
        service.refreshProviderSession('tok'),
      ).rejects.toBeInstanceOf(ProviderRefreshUnavailableError);
    });

    it.each([400, 401, 403])(
      'returns null (a definitive rejection) for a %i',
      async (status) => {
        refreshWith({
          data: {},
          error: Object.assign(new Error('Invalid Refresh Token'), { status }),
        });
        await expect(service.refreshProviderSession('tok')).resolves.toBeNull();
      },
    );

    it('returns the new tokens on success', async () => {
      refreshWith({
        data: {
          session: {
            access_token: 'a',
            refresh_token: 'r',
            expires_in: 3600,
          },
        },
        error: null,
      });
      await expect(service.refreshProviderSession('tok')).resolves.toEqual({
        access_token: 'a',
        refresh_token: 'r',
        expires_in: 3600,
      });
    });
  });
});
