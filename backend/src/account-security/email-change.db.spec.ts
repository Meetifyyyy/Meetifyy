import { HttpException } from '@nestjs/common';
import { EmailChannel, Prisma, ReauthPurpose } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { UserOtpService } from '../otp/user-otp.service';
import { DomainValidatorService } from '../common/services/domain-validator.service';
import { CampusAccessService } from '../common/campus/campus-access.service';
import { AccountEmailService } from '../account-email/account-email.service';
import { CampusAffiliationService } from '../campus-affiliation/campus-affiliation.service';
import { ReauthService } from './reauth.service';
import { EmailChangePolicyService } from './email-change-policy.service';
import { AuthEmailGuardCheck } from './auth-email-guard.check';
import {
  AUTH_EMAIL_INTENT_TTL_MS,
  EMAIL_CHANGE_COOLDOWN_MS,
} from './account-security.constants';
import { stub } from '../common/testing/stub';
import type { RedisService } from '../redis/redis.service';
import type { SupabaseService } from '../supabase/supabase.service';
import type { AuthService } from '../auth/auth.service';
import type { DomainEventService } from '../events/domain-event.service';
import type { AddressMailer } from '../otp/address-mailer';
import type { AuthenticatedUser } from '../common/types/authenticated-request';
import type { RateLimitService } from '../common/rate-limit/rate-limit.service';

/**
 * The email-change security controls, against a real Postgres.
 *
 * Every service here is the real one; only Supabase Auth, the password check
 * and the mail queue are stood in for. The Supabase stand-in writes
 * `auth.users` AS `supabase_auth_admin`, the role GoTrue uses, so the trigger
 * from migration 00000000000029 judges every auth email write exactly as it
 * would in Supabase — including the direct `PUT /auth/v1/user` bypass.
 *
 * Needs a disposable database with the migrations applied and a
 * Supabase-shaped `auth.users` (see docs/email-change-security.md), named in
 * BOTH `DATABASE_URL` and `EMAIL_SECURITY_TEST_DATABASE_URL`, on localhost.
 * Skipped otherwise, so it can never run against a shared database.
 */
const TEST_URL = process.env.EMAIL_SECURITY_TEST_DATABASE_URL ?? '';
const runnable =
  TEST_URL !== '' &&
  process.env.DATABASE_URL === TEST_URL &&
  /@(127\.0\.0\.1|localhost):\d+\//.test(TEST_URL);
const describeDb = runnable ? describe : describe.skip;

const SESSION_A = 'session-a';
const SESSION_B = 'session-b';
const HOUR = 60 * 60 * 1000;

let seq = 0;
const uuid = () => {
  seq += 1;
  const n = (Date.now() % 1e8).toString(16).padStart(8, '0');
  return `${n}-0000-4000-8000-${seq.toString(16).padStart(12, '0')}`;
};

describeDb('email change security (database)', () => {
  let prisma: PrismaService;
  let accountEmail: AccountEmailService;
  let campus: CampusAffiliationService;
  let reauth: ReauthService;
  let policy: EmailChangePolicyService;
  let access: CampusAccessService;
  let mail: Array<{ kind: string; to: string; code?: string; key?: string }>;
  let passwordless: Set<string>;
  let failNextAuthWrite: boolean;
  /** The admin call applies the change, then reports a failure (a timeout). */
  let timeoutAfterNextAuthWrite: boolean;
  /** Runs after the next successful admin write, before it returns. */
  let afterNextAuthWrite: (() => Promise<void>) | null;
  let collegeA: string;
  let collegeB: string;

  /** GoTrue's write path: the role it connects as, the table it updates. */
  const authWrite = async (
    sql: Prisma.Sql,
  ): Promise<{ error: { message: string } | null }> => {
    try {
      await prisma.$transaction([
        prisma.$executeRawUnsafe('SET LOCAL ROLE supabase_auth_admin'),
        prisma.$executeRaw(sql),
      ]);
      return { error: null };
    } catch {
      return { error: { message: 'Database error updating user' } };
    }
  };

  const supabase = stub<SupabaseService>({
    isConfigured: true,
    client: {
      auth: {
        admin: {
          getUserById: jest.fn(async (id: string) => {
            const rows = await prisma.$queryRaw<{ email: string | null }[]>`
              SELECT email FROM auth.users WHERE id = ${id}::uuid`;
            return {
              data: {
                user: {
                  id,
                  email: rows[0]?.email ?? undefined,
                  identities: [
                    { provider: passwordless.has(id) ? 'google' : 'email' },
                  ],
                },
              },
              error: null,
            };
          }),
          updateUserById: jest.fn(
            async (id: string, attrs: { email?: string }) => {
              if (failNextAuthWrite) {
                failNextAuthWrite = false;
                return { data: { user: null }, error: { message: 'timeout' } };
              }
              const { error } = await authWrite(
                Prisma.sql`UPDATE auth.users SET email = ${attrs.email ?? null} WHERE id = ${id}::uuid`,
              );
              const hook = afterNextAuthWrite;
              afterNextAuthWrite = null;
              if (!error && hook) await hook();
              if (!error && timeoutAfterNextAuthWrite) {
                timeoutAfterNextAuthWrite = false;
                return { data: { user: null }, error: { message: 'timeout' } };
              }
              return { data: { user: null }, error };
            },
          ),
        },
      },
    },
  });

  const mailer: AddressMailer = {
    sendCollegeEmailOtp: (to, _name, code) => {
      mail.push({ kind: 'college', to, code });
      return Promise.resolve();
    },
    sendPersonalEmailOtp: (to, _name, code) => {
      mail.push({ kind: 'personal', to, code });
      return Promise.resolve();
    },
    sendReauthCode: (to, _name, code) => {
      mail.push({ kind: 'reauth', to, code });
      return Promise.resolve();
    },
    sendSignInEmailChangedNotice: (to, _name, _masked, key) => {
      mail.push({ kind: 'notice', to, key });
      return Promise.resolve();
    },
  };

  const lastCode = (kind: string) => {
    const m = [...mail].reverse().find((x) => x.kind === kind);
    if (!m?.code) throw new Error(`no ${kind} code sent`);
    return m.code;
  };

  const errorCode = async (
    p: Promise<unknown>,
  ): Promise<string | undefined> => {
    const err = await p.then(
      () => null,
      (e: unknown) => e,
    );
    if (!(err instanceof HttpException)) {
      throw new Error(`expected an HttpException, got ${String(err)}`);
    }
    const body = err.getResponse();
    return typeof body === 'object' && body !== null && 'code' in body
      ? String(body.code)
      : undefined;
  };

  const newUser = async (email: string): Promise<AuthenticatedUser> => {
    const id = uuid();
    await prisma.user.create({
      data: {
        id,
        username: `u${seq}${Date.now() % 1e6}`,
        displayName: 'Test',
        email,
      },
    });
    await prisma.$executeRaw`INSERT INTO auth.users (id, email) VALUES (${id}::uuid, ${email})`;
    return stub<AuthenticatedUser>({ id, email });
  };

  const authEmailOf = async (id: string) =>
    (
      await prisma.$queryRaw<{ email: string }[]>`
        SELECT email FROM auth.users WHERE id = ${id}::uuid`
    )[0]?.email;

  const grant = async (
    user: AuthenticatedUser,
    purpose: ReauthPurpose,
    session = SESSION_A,
  ) => (await reauth.withPassword(user, purpose, 'right', session)).reauthToken;

  /** Lets the next code go out without waiting the 60-second resend gap. */
  const skipResendGap = async (userId: string) => {
    await prisma.userOtp.updateMany({
      where: { userId },
      data: { createdAt: new Date(Date.now() - 120_000) },
    });
  };

  /** Moves a user's cooldown events back in time. */
  const age = async (userId: string, ms: number) => {
    await prisma.$executeRaw`
      UPDATE "EmailChangeEvent"
      SET "createdAt" = "createdAt" - (${ms}::bigint * interval '1 millisecond')
      WHERE "userId" = ${userId}`;
  };

  const changePersonal = async (
    user: AuthenticatedUser,
    to: string,
    token?: string,
  ) => {
    const t = token ?? (await grant(user, ReauthPurpose.PERSONAL_EMAIL_CHANGE));
    await skipResendGap(user.id);
    await accountEmail.requestOtp(user.id, to, {
      sessionId: SESSION_A,
      reauthToken: t,
    });
    return accountEmail.verify(user, lastCode('personal'), {
      sessionId: SESSION_A,
      reauthToken: t,
    });
  };

  const verifyCollege = async (
    user: AuthenticatedUser,
    collegeId: string,
    email: string,
    token?: string,
  ) => {
    await skipResendGap(user.id);
    await campus.requestOtp(
      user.id,
      { collegeId, email },
      { sessionId: SESSION_A, reauthToken: token },
    );
    return campus.verify(user.id, lastCode('college'), {
      sessionId: SESSION_A,
      reauthToken: token,
    });
  };

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    const auth = stub<AuthService>({
      verifyPassword: (_u: AuthenticatedUser, password: string) =>
        Promise.resolve({ valid: password === 'right' }),
    });
    const rateLimit = stub<RateLimitService>({
      consume: jest.fn(() => Promise.resolve({ allowed: true })),
    });
    const otp = new UserOtpService(
      prisma,
      stub<RedisService>({ getClient: () => null }),
    );
    policy = new EmailChangePolicyService(prisma);
    reauth = new ReauthService(prisma, supabase, auth, otp, mailer);
    accountEmail = new AccountEmailService(
      prisma,
      supabase,
      otp,
      auth,
      reauth,
      policy,
      rateLimit,
      mailer,
    );
    campus = new CampusAffiliationService(
      prisma,
      otp,
      new DomainValidatorService(prisma),
      stub<DomainEventService>({ emit: () => Promise.resolve() }),
      auth,
      reauth,
      policy,
      rateLimit,
      mailer,
    );
    access = new CampusAccessService(prisma);

    collegeA = uuid();
    collegeB = uuid();
    for (const [id, domain] of [
      [collegeA, 'alpha.edu'],
      [collegeB, 'beta.edu'],
    ]) {
      await prisma.college.create({
        data: {
          id,
          name: `College ${domain}`,
          isActive: true,
          status: 'APPROVED',
          domains: { create: { id: uuid(), domain, status: 'ACTIVE' } },
        },
      });
    }
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  beforeEach(() => {
    mail = [];
    passwordless = new Set();
    failNextAuthWrite = false;
    timeoutAfterNextAuthWrite = false;
    afterNextAuthWrite = null;
  });

  describe('the auth.users guard', () => {
    it('is installed, and the boot check sees it', async () => {
      await expect(new AuthEmailGuardCheck(prisma).check()).resolves.toBe(true);
    });

    it("refuses Supabase Auth's own email change (PUT /auth/v1/user) and a bare email write", async () => {
      const me = await newUser('direct@example.com');
      const staged = await authWrite(
        Prisma.sql`UPDATE auth.users SET email_change = 'attacker@example.com' WHERE id = ${me.id}::uuid`,
      );
      expect(staged.error).not.toBeNull();
      const direct = await authWrite(
        Prisma.sql`UPDATE auth.users SET email = 'attacker@example.com' WHERE id = ${me.id}::uuid`,
      );
      expect(direct.error).not.toBeNull();
      expect(await authEmailOf(me.id)).toBe('direct@example.com');
      // Writes that are not email changes are untouched.
      const other = await authWrite(
        Prisma.sql`UPDATE auth.users SET last_sign_in_at = now() WHERE id = ${me.id}::uuid`,
      );
      expect(other.error).toBeNull();
    });

    it('gives the Data API roles nothing on the protected tables', async () => {
      for (const role of ['anon', 'authenticated']) {
        for (const table of [
          'EmailChangeEvent',
          'ReauthGrant',
          'AuthEmailChangeIntent',
        ]) {
          await expect(
            prisma.$transaction([
              prisma.$executeRawUnsafe(`SET LOCAL ROLE ${role}`),
              prisma.$executeRawUnsafe(
                `UPDATE "${table}" SET "createdAt" = now()`,
              ),
            ]),
          ).rejects.toThrow(/permission denied/);
        }
      }
    });
  });

  describe('reauthentication', () => {
    it('is required by all three operations, and an existing session is not enough', async () => {
      const me = await newUser('reauth-required@example.com');
      await accountEmail.requestOtp(me.id, 'new1@example.com', {
        sessionId: SESSION_A,
      });
      expect(
        await errorCode(
          accountEmail.verify(me, lastCode('personal'), {
            sessionId: SESSION_A,
          }),
        ),
      ).toBe('reauth_required');

      // First college verification needs none; the second does.
      await verifyCollege(me, collegeA, 'student@alpha.edu');
      await age(me.id, EMAIL_CHANGE_COOLDOWN_MS + HOUR);
      expect(
        await errorCode(
          campus.requestOtp(
            me.id,
            { collegeId: collegeB, email: 'student@beta.edu' },
            { sessionId: SESSION_A },
          ),
        ),
      ).toBe('reauth_required');
      expect(await errorCode(campus.remove(me, { sessionId: SESSION_A }))).toBe(
        'reauth_required',
      );
      expect(await access.getActiveCollegeId(me.id)).toBe(collegeA);
    });

    it('rejects a wrong password, and issues no grant', async () => {
      const me = await newUser('wrongpw@example.com');
      expect(
        await errorCode(
          reauth.withPassword(
            me,
            ReauthPurpose.PERSONAL_EMAIL_CHANGE,
            'nope',
            SESSION_A,
          ),
        ),
      ).toBe('invalid_password');
      expect(await prisma.reauthGrant.count({ where: { userId: me.id } })).toBe(
        0,
      );
    });

    it('rejects an expired grant, a grant from another session, and one for another purpose', async () => {
      const me = await newUser('grant-scope@example.com');
      const other = await grant(me, ReauthPurpose.COLLEGE_EMAIL_REMOVE);
      expect(
        await errorCode(
          accountEmail.requestOtp(me.id, 'a@example.com', {
            sessionId: SESSION_A,
            reauthToken: other,
          }),
        ),
      ).toBe('reauth_required');

      const t = await grant(me, ReauthPurpose.PERSONAL_EMAIL_CHANGE);
      expect(
        await errorCode(
          accountEmail.requestOtp(me.id, 'a@example.com', {
            sessionId: SESSION_B,
            reauthToken: t,
          }),
        ),
      ).toBe('reauth_required');

      await prisma.reauthGrant.updateMany({
        where: { userId: me.id },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      expect(
        await errorCode(
          accountEmail.requestOtp(me.id, 'a@example.com', {
            sessionId: SESSION_A,
            reauthToken: t,
          }),
        ),
      ).toBe('reauth_required');
      expect(mail.filter((m) => m.kind === 'personal')).toHaveLength(0);
    });

    it('binds the grant to the address of the live code, following a resend to a new one', async () => {
      const me = await newUser('grant-bind@example.com');
      const t = await grant(me, ReauthPurpose.PERSONAL_EMAIL_CHANGE);
      await accountEmail.requestOtp(me.id, 'first@example.com', {
        sessionId: SESSION_A,
        reauthToken: t,
      });
      const firstCode = lastCode('personal');
      // "Use a different email": same grant, no second prompt.
      await skipResendGap(me.id);
      await accountEmail.requestOtp(me.id, 'second@example.com', {
        sessionId: SESSION_A,
        reauthToken: t,
      });
      expect(
        (
          await prisma.reauthGrant.findFirstOrThrow({
            where: { userId: me.id },
          })
        ).target,
      ).toBe('second@example.com');
      // The first code was replaced: it can never apply either address.
      if (firstCode !== lastCode('personal')) {
        expect(
          await errorCode(
            accountEmail.verify(me, firstCode, {
              sessionId: SESSION_A,
              reauthToken: t,
            }),
          ),
        ).toBe('invalid_code');
      }
      await expect(
        accountEmail.verify(me, lastCode('personal'), {
          sessionId: SESSION_A,
          reauthToken: t,
        }),
      ).resolves.toEqual({ email: 'second@example.com' });
    });

    it('does not move the grant when the resend itself is refused', async () => {
      const me = await newUser('grant-norebind@example.com');
      const t = await grant(me, ReauthPurpose.PERSONAL_EMAIL_CHANGE);
      await accountEmail.requestOtp(me.id, 'kept@example.com', {
        sessionId: SESSION_A,
        reauthToken: t,
      });
      // Inside the 60-second resend gap: refused before any code is issued.
      expect(
        await errorCode(
          accountEmail.requestOtp(me.id, 'moved@example.com', {
            sessionId: SESSION_A,
            reauthToken: t,
          }),
        ),
      ).toBe('OTP_COOLDOWN');
      expect(
        (
          await prisma.reauthGrant.findFirstOrThrow({
            where: { userId: me.id },
          })
        ).target,
      ).toBe('kept@example.com');
      await expect(
        accountEmail.verify(me, lastCode('personal'), {
          sessionId: SESSION_A,
          reauthToken: t,
        }),
      ).resolves.toEqual({ email: 'kept@example.com' });
    });

    it('lets a passwordless account confirm by a code to its current address, and only that account', async () => {
      const me = await newUser('oauth-user@example.com');
      passwordless.add(me.id);
      await expect(reauth.getMethods(me.id)).resolves.toEqual({
        methods: ['email_code'],
      });
      expect(
        await errorCode(
          reauth.withPassword(
            me,
            ReauthPurpose.PERSONAL_EMAIL_CHANGE,
            'right',
            SESSION_A,
          ),
        ),
      ).toBe('password_not_set');

      await reauth.sendCode(me, ReauthPurpose.PERSONAL_EMAIL_CHANGE);
      expect(mail.at(-1)).toMatchObject({
        kind: 'reauth',
        to: 'oauth-user@example.com',
      });
      // A code for one purpose cannot open another.
      expect(
        await errorCode(
          reauth.withCode(
            me,
            ReauthPurpose.COLLEGE_EMAIL_REMOVE,
            lastCode('reauth'),
            SESSION_A,
          ),
        ),
      ).toBe('invalid_code');
      await reauth
        .sendCode(me, ReauthPurpose.PERSONAL_EMAIL_CHANGE)
        .catch(() => undefined);

      const pwUser = await newUser('has-password@example.com');
      expect(
        await errorCode(
          reauth.sendCode(pwUser, ReauthPurpose.PERSONAL_EMAIL_CHANGE),
        ),
      ).toBe('use_password');
    });

    it('completes a passwordless change end to end', async () => {
      const me = await newUser('oauth-two@example.com');
      passwordless.add(me.id);
      await reauth.sendCode(me, ReauthPurpose.PERSONAL_EMAIL_CHANGE);
      const { reauthToken } = await reauth.withCode(
        me,
        ReauthPurpose.PERSONAL_EMAIL_CHANGE,
        lastCode('reauth'),
        SESSION_A,
      );
      await expect(
        changePersonal(me, 'oauth-two-new@example.com', reauthToken),
      ).resolves.toEqual({
        email: 'oauth-two-new@example.com',
      });
    });
  });

  describe('personal email', () => {
    it('changes only after the code, updates both sides, records one event and notifies the old address', async () => {
      const me = await newUser('before@example.com');
      const t = await grant(me, ReauthPurpose.PERSONAL_EMAIL_CHANGE);
      await accountEmail.requestOtp(me.id, 'after@example.com', {
        sessionId: SESSION_A,
        reauthToken: t,
      });
      // Nothing changes on a request, and a wrong code changes nothing either.
      const code = lastCode('personal');
      const wrong = code === '000000' ? '111111' : '000000';
      expect(
        await errorCode(
          accountEmail.verify(me, wrong, {
            sessionId: SESSION_A,
            reauthToken: t,
          }),
        ),
      ).toBe('invalid_code');
      expect(await authEmailOf(me.id)).toBe('before@example.com');
      expect(
        (await prisma.user.findUnique({ where: { id: me.id } }))?.email,
      ).toBe('before@example.com');

      await accountEmail.verify(me, code, {
        sessionId: SESSION_A,
        reauthToken: t,
      });
      expect(await authEmailOf(me.id)).toBe('after@example.com');
      expect(
        (await prisma.user.findUnique({ where: { id: me.id } }))?.email,
      ).toBe('after@example.com');
      const events = await prisma.emailChangeEvent.findMany({
        where: { userId: me.id },
      });
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        channel: 'PERSONAL',
        action: 'CHANGE',
        countsTowardCooldown: true,
        previousEmail: 'before@example.com',
        newEmail: 'after@example.com',
      });
      expect(mail.filter((m) => m.kind === 'notice')).toEqual([
        { kind: 'notice', to: 'before@example.com', key: events[0].id },
      ]);
      expect(
        await prisma.authEmailChangeIntent.count({ where: { userId: me.id } }),
      ).toBe(0);

      // Replays: the code and the grant are both spent.
      expect(
        await errorCode(
          accountEmail.verify(me, code, {
            sessionId: SESSION_A,
            reauthToken: t,
          }),
        ),
      ).toBe('reauth_required');
    });

    it('enforces 30 × 24 hours exactly, from the database clock', async () => {
      const me = await newUser('cooldown@example.com');
      await changePersonal(me, 'cooldown-1@example.com');
      const cd = await accountEmail.getStatus(me.id);
      const event = await prisma.emailChangeEvent.findFirstOrThrow({
        where: { userId: me.id },
      });
      expect(new Date(cd.cooldowns.personal ?? 0).getTime()).toBe(
        event.createdAt.getTime() + EMAIL_CHANGE_COOLDOWN_MS,
      );

      const t = await grant(me, ReauthPurpose.PERSONAL_EMAIL_CHANGE);
      expect(
        await errorCode(
          accountEmail.requestOtp(me.id, 'cooldown-2@example.com', {
            sessionId: SESSION_A,
            reauthToken: t,
          }),
        ),
      ).toBe('email_change_cooldown');

      // One minute before expiry: still refused.
      await age(me.id, EMAIL_CHANGE_COOLDOWN_MS - 60_000);
      expect(
        await errorCode(
          accountEmail.requestOtp(me.id, 'cooldown-2@example.com', {
            sessionId: SESSION_A,
            reauthToken: t,
          }),
        ),
      ).toBe('email_change_cooldown');
      // Past it: allowed.
      await age(me.id, 61_000);
      await expect(
        changePersonal(me, 'cooldown-2@example.com'),
      ).resolves.toEqual({
        email: 'cooldown-2@example.com',
      });
    });

    it('re-checks the cooldown at completion: a code sent before another device changed the email is refused', async () => {
      const me = await newUser('two-devices@example.com');
      const ta = await grant(
        me,
        ReauthPurpose.PERSONAL_EMAIL_CHANGE,
        SESSION_A,
      );
      await accountEmail.requestOtp(me.id, 'device-a@example.com', {
        sessionId: SESSION_A,
        reauthToken: ta,
      });
      const codeA = lastCode('personal');
      // Device B (an installed app on the legacy password body, so A's grant
      // stays live) completes a change first.
      await skipResendGap(me.id);
      await accountEmail.requestOtp(me.id, 'device-b@example.com', {
        sessionId: SESSION_B,
      });
      await accountEmail.verify(me, lastCode('personal'), {
        sessionId: SESSION_B,
        currentPassword: 'right',
      });
      expect(
        await errorCode(
          accountEmail.verify(me, codeA, {
            sessionId: SESSION_A,
            reauthToken: ta,
          }),
        ),
      ).toBe('email_change_cooldown');
      expect(
        await prisma.emailChangeEvent.count({ where: { userId: me.id } }),
      ).toBe(1);
    });

    it('lets only one of two concurrent verifies succeed', async () => {
      const me = await newUser('race@example.com');
      const t = await grant(me, ReauthPurpose.PERSONAL_EMAIL_CHANGE);
      await accountEmail.requestOtp(me.id, 'race-new@example.com', {
        sessionId: SESSION_A,
        reauthToken: t,
      });
      const code = lastCode('personal');
      const results = await Promise.allSettled([
        accountEmail.verify(me, code, { sessionId: SESSION_A, reauthToken: t }),
        accountEmail.verify(me, code, { sessionId: SESSION_A, reauthToken: t }),
        accountEmail.verify(me, code, { sessionId: SESSION_A, reauthToken: t }),
      ]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(
        await prisma.emailChangeEvent.count({ where: { userId: me.id } }),
      ).toBe(1);
      expect(mail.filter((m) => m.kind === 'notice')).toHaveLength(1);
    });

    it('starts no cooldown when the change fails, and refuses an address another account holds', async () => {
      const me = await newUser('fails@example.com');
      await newUser('held@example.com');
      const t = await grant(me, ReauthPurpose.PERSONAL_EMAIL_CHANGE);
      expect(
        await errorCode(
          accountEmail.requestOtp(me.id, 'HELD@example.com', {
            sessionId: SESSION_A,
            reauthToken: t,
          }),
        ),
      ).toBe('email_taken');

      await accountEmail.requestOtp(me.id, 'fails-new@example.com', {
        sessionId: SESSION_A,
        reauthToken: t,
      });
      failNextAuthWrite = true;
      await expect(
        accountEmail.verify(me, lastCode('personal'), {
          sessionId: SESSION_A,
          reauthToken: t,
        }),
      ).rejects.toThrow();
      expect(
        await prisma.emailChangeEvent.count({ where: { userId: me.id } }),
      ).toBe(0);
      expect(await authEmailOf(me.id)).toBe('fails@example.com');
      // The outcome was unknown, so the intent waits out its window; then the
      // reconciler sees the old address and clears it. No event, no cooldown.
      await prisma.authEmailChangeIntent.update({
        where: { userId: me.id },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      expect(
        (await accountEmail.getStatus(me.id)).cooldowns.personal,
      ).toBeNull();
      expect(
        await prisma.authEmailChangeIntent.count({ where: { userId: me.id } }),
      ).toBe(0);
      expect(
        await prisma.emailChangeEvent.count({ where: { userId: me.id } }),
      ).toBe(0);
    });

    it('reconciles a change interrupted after the auth write, exactly once', async () => {
      const me = await newUser('crash@example.com');
      // State a crash between the two halves leaves behind.
      await prisma.authEmailChangeIntent.create({
        data: {
          userId: me.id,
          previousEmail: 'crash@example.com',
          newEmail: 'crash-new@example.com',
          expiresAt: new Date(Date.now() + AUTH_EMAIL_INTENT_TTL_MS),
        },
      });
      await supabase.client.auth.admin.updateUserById(me.id, {
        email: 'crash-new@example.com',
      });
      await prisma.authEmailChangeIntent.update({
        where: { userId: me.id },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });

      await Promise.all([
        accountEmail.getStatus(me.id),
        accountEmail.getStatus(me.id),
      ]);
      await accountEmail.getStatus(me.id);
      expect(
        (await prisma.user.findUnique({ where: { id: me.id } }))?.email,
      ).toBe('crash-new@example.com');
      expect(
        await prisma.emailChangeEvent.count({ where: { userId: me.id } }),
      ).toBe(1);
      expect(mail.filter((m) => m.kind === 'notice')).toHaveLength(1);
    });

    it('keeps a change Supabase applied but reported as failed, and finishes it later', async () => {
      const me = await newUser('timeout@example.com');
      const t = await grant(me, ReauthPurpose.PERSONAL_EMAIL_CHANGE);
      await accountEmail.requestOtp(me.id, 'timeout-new@example.com', {
        sessionId: SESSION_A,
        reauthToken: t,
      });
      timeoutAfterNextAuthWrite = true;
      await expect(
        accountEmail.verify(me, lastCode('personal'), {
          sessionId: SESSION_A,
          reauthToken: t,
        }),
      ).rejects.toThrow();
      // Supabase holds the new address; the intent survives to say so.
      expect(await authEmailOf(me.id)).toBe('timeout-new@example.com');
      expect(
        await prisma.authEmailChangeIntent.count({ where: { userId: me.id } }),
      ).toBe(1);

      await prisma.authEmailChangeIntent.update({
        where: { userId: me.id },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      const status = await accountEmail.getStatus(me.id);
      expect(status.email).toBe('timeout-new@example.com');
      expect(status.cooldowns.personal).not.toBeNull();
      expect(
        await prisma.emailChangeEvent.count({ where: { userId: me.id } }),
      ).toBe(1);
      expect(mail.filter((m) => m.kind === 'notice')).toHaveLength(1);
    });

    it('never reverts a change the reconciler already completed', async () => {
      const me = await newUser('raced@example.com');
      const t = await grant(me, ReauthPurpose.PERSONAL_EMAIL_CHANGE);
      await accountEmail.requestOtp(me.id, 'raced-new@example.com', {
        sessionId: SESSION_A,
        reauthToken: t,
      });
      // A slow admin call: while it is "in flight" the intent expires and a
      // status read on another device completes the change.
      afterNextAuthWrite = async () => {
        await prisma.authEmailChangeIntent.update({
          where: { userId: me.id },
          data: { expiresAt: new Date(Date.now() - 1000) },
        });
        await accountEmail.getStatus(me.id);
      };
      await expect(
        accountEmail.verify(me, lastCode('personal'), {
          sessionId: SESSION_A,
          reauthToken: t,
        }),
      ).resolves.toEqual({ email: 'raced-new@example.com' });
      expect(await authEmailOf(me.id)).toBe('raced-new@example.com');
      expect(
        (await prisma.user.findUnique({ where: { id: me.id } }))?.email,
      ).toBe('raced-new@example.com');
      expect(
        await prisma.emailChangeEvent.count({ where: { userId: me.id } }),
      ).toBe(1);
    });

    it('cascades its intent away when the account is deleted', async () => {
      const me = await newUser('deleted-mid-change@example.com');
      await prisma.authEmailChangeIntent.create({
        data: {
          userId: me.id,
          previousEmail: 'deleted-mid-change@example.com',
          newEmail: 'x@example.com',
          expiresAt: new Date(Date.now() + 60_000),
        },
      });
      await prisma.user.delete({ where: { id: me.id } });
      expect(
        await prisma.authEmailChangeIntent.count({ where: { userId: me.id } }),
      ).toBe(0);
    });

    it('accepts the legacy password body from installed apps, re-checked at verify', async () => {
      const me = await newUser('legacy@example.com');
      await accountEmail.requestOtp(me.id, 'legacy-new@example.com', {});
      const code = lastCode('personal');
      expect(
        await errorCode(
          accountEmail.verify(me, code, { currentPassword: 'nope' }),
        ),
      ).toBe('invalid_password');
      await expect(
        accountEmail.verify(me, code, { currentPassword: 'right' }),
      ).resolves.toEqual({ email: 'legacy-new@example.com' });
      expect(await policy.getCooldowns(me.id)).toMatchObject({ college: null });
      expect((await policy.getCooldowns(me.id)).personal).not.toBeNull();
    });
  });

  describe('college email', () => {
    it('keeps the two cooldowns independent', async () => {
      const me = await newUser('independent@example.com');
      await verifyCollege(me, collegeA, 'ind@alpha.edu');
      // College is cooling down; personal is not.
      await expect(
        changePersonal(me, 'independent-2@example.com'),
      ).resolves.toBeDefined();
      const cd = await policy.getCooldowns(me.id);
      expect(cd.personal).not.toBeNull();
      expect(cd.college).not.toBeNull();
      // Changing personal did not move the college cooldown.
      const collegeEvent = await prisma.emailChangeEvent.findFirstOrThrow({
        where: { userId: me.id, channel: EmailChannel.COLLEGE },
      });
      expect(cd.college?.getTime()).toBe(
        collegeEvent.createdAt.getTime() + EMAIL_CHANGE_COOLDOWN_MS,
      );
    });

    it('allows one change per 30 days, with a fresh grant', async () => {
      const me = await newUser('college-change@example.com');
      await verifyCollege(me, collegeA, 'cc@alpha.edu');
      const t = await grant(me, ReauthPurpose.COLLEGE_EMAIL_CHANGE);
      expect(
        await errorCode(
          campus.requestOtp(
            me.id,
            { collegeId: collegeB, email: 'cc@beta.edu' },
            { sessionId: SESSION_A, reauthToken: t },
          ),
        ),
      ).toBe('email_change_cooldown');

      await age(me.id, EMAIL_CHANGE_COOLDOWN_MS + 1000);
      await verifyCollege(me, collegeB, 'cc@beta.edu', t);
      // Access moved with the address: the old college is gone.
      expect(await access.getActiveCollegeId(me.id)).toBe(collegeB);
      expect(
        await prisma.emailChangeEvent.findMany({
          where: { userId: me.id },
          orderBy: { createdAt: 'asc' },
          select: { action: true },
        }),
      ).toEqual([{ action: 'ADD' }, { action: 'CHANGE' }]);
    });

    it('refuses an address outside the college’s domains', async () => {
      const me = await newUser('domain@example.com');
      expect(
        await errorCode(
          campus.requestOtp(
            me.id,
            { collegeId: collegeA, email: 'x@beta.edu' },
            { sessionId: SESSION_A },
          ),
        ),
      ).toBe('domain_mismatch');
    });

    it('removes immediately (even during the cooldown), closes Campus, and blocks re-adding for 30 days', async () => {
      const me = await newUser('remove@example.com');
      await verifyCollege(me, collegeA, 'rm@alpha.edu');
      const t = await grant(me, ReauthPurpose.COLLEGE_EMAIL_REMOVE);
      await campus.remove(me, { sessionId: SESSION_A, reauthToken: t });
      expect(await access.getActiveCollegeId(me.id)).toBeNull();
      const row = await prisma.user.findUnique({
        where: { id: me.id },
        select: { collegeId: true, collegeEmail: true },
      });
      expect(row).toEqual({ collegeId: null, collegeEmail: null });

      // The grant is spent; a retry is a fresh reauth.
      expect(
        await errorCode(
          campus.remove(me, { sessionId: SESSION_A, reauthToken: t }),
        ),
      ).toBe('reauth_required');

      // Re-adding — even the same address — waits out the cooldown.
      const add = await grant(me, ReauthPurpose.COLLEGE_EMAIL_CHANGE);
      expect(
        await errorCode(
          campus.requestOtp(
            me.id,
            { collegeId: collegeA, email: 'rm@alpha.edu' },
            { sessionId: SESSION_A, reauthToken: add },
          ),
        ),
      ).toBe('email_change_cooldown');
    });

    it('lets an admin revoke during a cooldown without starting one', async () => {
      const me = await newUser('admin-revoke@example.com');
      await verifyCollege(me, collegeA, 'ar@alpha.edu');
      await campus.revoke(me.id, 'compromised mailbox');
      expect(await access.getActiveCollegeId(me.id)).toBeNull();
      const events = await prisma.emailChangeEvent.findMany({
        where: { userId: me.id },
        orderBy: { createdAt: 'asc' },
        select: { action: true, countsTowardCooldown: true },
      });
      expect(events).toEqual([
        { action: 'ADD', countsTowardCooldown: true },
        { action: 'ADMIN_REVOKE', countsTowardCooldown: false },
      ]);
    });

    it('treats an account with no history as eligible', async () => {
      const me = await newUser('fresh@example.com');
      await expect(policy.getCooldowns(me.id)).resolves.toEqual({
        personal: null,
        college: null,
      });
      await expect(campus.getStatus(me.id)).resolves.toEqual({
        affiliation: null,
        pending: null,
      });
    });
  });
});
