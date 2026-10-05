import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import type { HttpException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtGuard } from './jwt.guard';
import { stub } from '../testing/stub';
import { httpContext } from './testing/jwt-guard.fixture';
import type { PrismaService } from '../../prisma/prisma.service';
import type { SupabaseService } from '../../supabase/supabase.service';
import type { LegalConsentService } from '../legal/legal-consent.service';

/**
 * The session, account-status and legal lookups now start together. What must
 * not change is how they are JUDGED: a signed-out session is reported as
 * signed out before anything about the account, and a suspension before the
 * policies screen — the client picks its screen from that answer.
 */
describe('JwtGuard — lifecycle checks run together but judge in order', () => {
  const USER = 'user-1';
  let sessionRow: { revoked: boolean; expiresAt: Date; userId: string };
  let accountStatus: string;
  let legalSatisfied: boolean;
  let releaseSession: () => void;
  let sessionGate: Promise<void>;
  let order: string[];

  const build = () => {
    const prisma = stub<PrismaService>({
      $executeRaw: jest.fn<
        Promise<number>,
        [TemplateStringsArray, ...unknown[]]
      >(() => Promise.resolve(1)),
      userSession: {
        findUnique: jest.fn(async () => {
          order.push('session:start');
          await sessionGate;
          return sessionRow;
        }),
      },
      user: {
        findUnique: jest.fn(() => {
          order.push('account:start');
          return Promise.resolve({ accountStatus });
        }),
      },
    });
    const guard = new JwtGuard(
      stub<SupabaseService>(),
      prisma,
      new Reflector(),
      stub<LegalConsentService>({
        isSatisfied: jest.fn(() => {
          order.push('legal:start');
          return Promise.resolve(legalSatisfied);
        }),
      }),
    );
    Object.assign(guard, {
      validateToken: jest.fn(() =>
        Promise.resolve({ id: USER, email: 'a@b.c' }),
      ),
    });
    Object.defineProperty(guard, 'supabaseService', {
      value: { isConfigured: true },
      writable: true,
    });
    return guard;
  };

  const attempt = (guard: JwtGuard) =>
    guard.canActivate(
      httpContext({
        cookies: { mf_access: 'tok', mf_sid: 'sid-1' },
        headers: {},
        method: 'GET',
      }),
    );

  beforeEach(() => {
    order = [];
    sessionRow = {
      revoked: false,
      expiresAt: new Date(Date.now() + 8.64e7),
      userId: USER,
    };
    accountStatus = 'ACTIVE';
    legalSatisfied = true;
    sessionGate = new Promise((r) => {
      releaseSession = r;
    });
    JwtGuard.forgetSession('sid-1');
    JwtGuard.clearAccountStatus(USER);
  });

  it('starts the account and legal lookups while the session lookup is pending', async () => {
    const pending = attempt(build());
    await new Promise((r) => setImmediate(r));
    expect(order).toEqual(
      expect.arrayContaining(['session:start', 'account:start', 'legal:start']),
    );
    releaseSession();
    await expect(pending).resolves.toBe(true);
  });

  it('reports a signed-out session before a suspension or a policy update', async () => {
    sessionRow = { ...sessionRow, revoked: true };
    accountStatus = 'SUSPENDED';
    legalSatisfied = false;
    releaseSession();
    await expect(attempt(build())).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('reports a suspension before a policy update', async () => {
    accountStatus = 'SUSPENDED';
    legalSatisfied = false;
    releaseSession();
    const err = await attempt(build()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ForbiddenException);
    expect((err as HttpException).getResponse()).toMatchObject({
      code: 'ACCOUNT_SUSPENDED',
    });
  });
});
