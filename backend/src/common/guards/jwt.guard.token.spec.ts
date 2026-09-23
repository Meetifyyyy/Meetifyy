import { Reflector } from '@nestjs/core';
import * as jwt from 'jsonwebtoken';
import { config } from '../../config';
import { JwtGuard } from './jwt.guard';
import type { SupabaseService } from '../../supabase/supabase.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { LegalConsentService } from '../legal/legal-consent.service';

/**
 * Token → AuthenticatedUser, through the real verification path.
 *
 * Every other JwtGuard spec replaces validateToken with a stub, so this is the
 * one place that proves what a signed token actually turns into: which claim
 * becomes the user id, and that nothing unverified is ever normalised.
 */
describe('JwtGuard token validation', () => {
  const SECRET = 'jwt-guard-token-spec-secret';
  const getUser = jest.fn();
  let guard: JwtGuard;

  const sign = (claims: object, secret = SECRET, options?: jwt.SignOptions) =>
    jwt.sign(claims, secret, { algorithm: 'HS256', ...options });

  beforeEach(() => {
    // HS256 path only: no JWKS fetch (placeholder URL disables it) and a
    // known shared secret.
    jest.replaceProperty(config.auth.supabase, 'jwtSecret', SECRET);
    jest.replaceProperty(
      config.auth.supabase,
      'url',
      'https://placeholder.supabase.co',
    );
    getUser
      .mockReset()
      .mockResolvedValue({ data: null, error: new Error('x') });
    guard = new JwtGuard(
      {
        isConfigured: true,
        client: { auth: { getUser } },
      } as unknown as SupabaseService,
      {} as PrismaService,
      new Reflector(),
      {} as LegalConsentService,
    );
  });

  afterEach(() => jest.restoreAllMocks());

  it('takes the user id from `sub` and keeps the verified claims', async () => {
    const token = sign({
      sub: 'user-1',
      email: 'a@uni.edu',
      user_metadata: { username: 'alice' },
    });

    await expect(guard.validateToken(token)).resolves.toEqual({
      id: 'user-1',
      email: 'a@uni.edu',
      user_metadata: { username: 'alice' },
      email_confirmed_at: undefined,
      confirmed_at: undefined,
      token,
    });
    expect(getUser).not.toHaveBeenCalled();
  });

  it('falls back to `id`, then `user_id`, and synthesises a missing email', async () => {
    const byId = await guard.validateToken(sign({ id: 'user-2' }));
    expect(byId).toMatchObject({ id: 'user-2', email: 'user-2@meetifyy.user' });

    const byUserId = await guard.validateToken(
      sign({ user_id: 'user-3', raw_user_meta_data: { displayName: 'C' } }),
    );
    expect(byUserId).toMatchObject({
      id: 'user-3',
      user_metadata: { displayName: 'C' },
    });
  });

  it('refuses a verified token that names no string subject', async () => {
    await expect(guard.validateToken(sign({ sub: 42 }))).resolves.toBeNull();
    await expect(
      guard.validateToken(sign({ email: 'x@y.z' })),
    ).resolves.toBeNull();
  });

  it('never normalises a token signed with another key', async () => {
    const forged = sign({ sub: 'victim' }, 'not-the-secret');

    await expect(guard.validateToken(forged)).resolves.toBeNull();
    // It went to the authoritative remote check, which rejected it.
    expect(getUser).toHaveBeenCalledWith(forged);
  });

  it('rejects an expired token without asking Supabase', async () => {
    const expired = sign({ sub: 'user-1' }, SECRET, { expiresIn: -10 });

    await expect(guard.validateToken(expired)).resolves.toBeNull();
    expect(getUser).not.toHaveBeenCalled();
  });

  it('normalises the remote Supabase user when local verification fails', async () => {
    getUser.mockResolvedValue({
      data: {
        user: {
          id: 'user-9',
          email: 'r@uni.edu',
          user_metadata: { username: 'r' },
          email_confirmed_at: '2026-01-01T00:00:00Z',
          confirmed_at: '2026-01-01T00:00:00Z',
        },
      },
      error: null,
    });
    const token = sign({ sub: 'user-9' }, 'rotated-away-secret');

    await expect(guard.validateToken(token)).resolves.toEqual({
      id: 'user-9',
      email: 'r@uni.edu',
      user_metadata: { username: 'r' },
      email_confirmed_at: '2026-01-01T00:00:00Z',
      confirmed_at: '2026-01-01T00:00:00Z',
      token,
    });
  });

  it('peekUserId reads a verified subject and never a forged one', async () => {
    await expect(guard.peekUserId(sign({ sub: 'user-5' }))).resolves.toBe(
      'user-5',
    );
    await expect(
      guard.peekUserId(sign({ sub: 'user-5' }, 'not-the-secret')),
    ).resolves.toBeNull();
    // Local-only: a forged token must not turn into an outbound Supabase call.
    expect(getUser).not.toHaveBeenCalled();
  });
});
