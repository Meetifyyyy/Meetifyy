import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import * as jwt from 'jsonwebtoken';
import { config } from '../../config';
import { JwtGuard } from './jwt.guard';
import {
  RecoveryTokenGuard,
  RECOVERY_MAX_AGE_SECONDS,
} from './recovery-token.guard';
import type { SupabaseService } from '../../supabase/supabase.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { LegalConsentService } from '../legal/legal-consent.service';
import type { OptionalAuthRequest } from '../types/authenticated-request';
import { stub } from '../testing/stub';

/**
 * The one route that accepts a bare recovery token. Tokens are really signed
 * and really verified (HS256 path of JwtGuard), so these prove which tokens get
 * in rather than which stubs say they do.
 */
describe('RecoveryTokenGuard', () => {
  const SECRET = 'recovery-guard-spec-secret';
  const nowSec = () => Math.floor(Date.now() / 1000);
  let guard: RecoveryTokenGuard;

  const sign = (claims: object, secret = SECRET) =>
    jwt.sign(claims, secret, { algorithm: 'HS256', expiresIn: 3600 });

  const recoveryClaims = (over: Record<string, unknown> = {}) => ({
    sub: 'user-1',
    email: 'Ada@Example.edu',
    user_metadata: { displayName: 'Ada' },
    amr: [{ method: 'otp', timestamp: nowSec() - 30 }],
    ...over,
  });

  const run = (request: Partial<OptionalAuthRequest>): Promise<boolean> =>
    guard.canActivate(
      stub<ExecutionContext>({
        switchToHttp: () => ({ getRequest: () => request }) as never,
      }),
    );
  const withBearer = (token: string) => ({
    headers: { authorization: `Bearer ${token}` },
  });

  beforeEach(() => {
    jest.replaceProperty(config.auth.supabase, 'jwtSecret', SECRET);
    jest.replaceProperty(
      config.auth.supabase,
      'url',
      'https://placeholder.supabase.co',
    );
    const jwtGuard = new JwtGuard(
      stub<SupabaseService>({ isConfigured: true }),
      {} as PrismaService,
      new Reflector(),
      {} as LegalConsentService,
    );
    guard = new RecoveryTokenGuard(jwtGuard);
  });

  afterEach(() => jest.restoreAllMocks());

  it('admits a fresh recovery token and attaches the verified identity', async () => {
    const req = withBearer(
      sign(recoveryClaims()),
    ) as Partial<OptionalAuthRequest>;
    await expect(run(req)).resolves.toBe(true);
    expect(req.user).toMatchObject({ id: 'user-1', email: 'ada@example.edu' });
  });

  it('also accepts the method named "recovery"', async () => {
    const token = sign(
      recoveryClaims({ amr: [{ method: 'recovery', timestamp: nowSec() }] }),
    );
    await expect(run(withBearer(token))).resolves.toBe(true);
  });

  it('refuses a stale recovery authentication', async () => {
    const token = sign(
      recoveryClaims({
        amr: [
          {
            method: 'otp',
            timestamp: nowSec() - RECOVERY_MAX_AGE_SECONDS - 60,
          },
        ],
      }),
    );
    await expect(run(withBearer(token))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it.each([
    [
      'an ordinary password login',
      [{ method: 'password', timestamp: nowSec() }],
    ],
    ['an OAuth login', [{ method: 'oauth', timestamp: nowSec() }]],
    ['a string-form amr', ['otp']],
  ])('refuses %s', async (_name, amr) => {
    const token = sign(recoveryClaims({ amr }));
    await expect(run(withBearer(token))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('refuses a token with no amr claim', async () => {
    const claims = recoveryClaims();
    delete (claims as { amr?: unknown }).amr;
    await expect(run(withBearer(sign(claims)))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('refuses a token signed with another key', async () => {
    const token = sign(recoveryClaims(), 'some-other-secret');
    await expect(run(withBearer(token))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('refuses an expired token', async () => {
    const token = jwt.sign(recoveryClaims(), SECRET, {
      algorithm: 'HS256',
      expiresIn: -10,
    });
    await expect(run(withBearer(token))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('refuses a token with no email, so no recipient can be derived', async () => {
    const token = sign(recoveryClaims({ email: undefined }));
    await expect(run(withBearer(token))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('never reads a cookie: a cookie-only request is refused', async () => {
    const token = sign(recoveryClaims());
    await expect(
      run({ headers: {}, cookies: { mf_access: token } }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('refuses a request with no credential', async () => {
    await expect(run({ headers: {} })).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
});
