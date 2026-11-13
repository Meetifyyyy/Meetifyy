import { Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { generateKeyPairSync, type KeyObject } from 'crypto';
import * as jwt from 'jsonwebtoken';
import { config } from '../../config';
import { JwtGuard } from './jwt.guard';
import type { SupabaseService } from '../../supabase/supabase.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { LegalConsentService } from '../legal/legal-consent.service';
import { stub } from '../testing/stub';

/**
 * What a token that fails local verification costs, and the guard's two
 * process-wide maps staying bounded.
 *
 * Its own file because the JWKS and the maps are static: one freshly loaded
 * module per file, and the tests below run in order against it.
 */
const SUPABASE_URL = 'https://forged-spec.supabase.co';
const ISSUER = `${SUPABASE_URL}/auth/v1`;

const keyPair = () => generateKeyPairSync('ec', { namedCurve: 'P-256' });
const held = keyPair();
const stranger = keyPair();

const jwk = (publicKey: KeyObject, kid: string) => ({
  ...publicKey.export({ format: 'jwk' }),
  kid,
  alg: 'ES256',
});

const sign = (
  privateKey: KeyObject,
  kid: string,
  options: jwt.SignOptions = {},
  claims: object = { sub: 'user-1' },
) =>
  jwt.sign(claims, privateKey, {
    algorithm: 'ES256',
    keyid: kid,
    issuer: ISSUER,
    ...options,
  });

describe('JwtGuard — tokens that fail local verification', () => {
  let now = Date.parse('2026-11-01T00:00:00Z');
  let publishing = true;
  const getUser = jest.fn();
  const fetchMock = jest.fn(() =>
    Promise.resolve(
      stub<Response>({
        ok: publishing,
        json: () => Promise.resolve({ keys: [jwk(held.publicKey, 'held')] }),
      }),
    ),
  );
  const findUnique = jest.fn(() =>
    Promise.resolve({ accountStatus: 'ACTIVE' }),
  );
  let guard: JwtGuard;
  const originalFetch = global.fetch;

  beforeAll(async () => {
    jest.replaceProperty(config.auth.supabase, 'url', SUPABASE_URL);
    jest.replaceProperty(config.auth.supabase, 'jwtSecret', '');
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    global.fetch = fetchMock;

    guard = new JwtGuard(
      stub<SupabaseService>({
        isConfigured: true,
        client: { auth: { getUser } },
      }),
      stub<PrismaService>({ user: { findUnique } }),
      new Reflector(),
      {} as LegalConsentService,
    );
    await new Promise((resolve) => setImmediate(resolve));
  });

  beforeEach(() => {
    getUser
      .mockReset()
      .mockResolvedValue({ data: null, error: new Error('x') });
  });

  afterAll(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  describe('a forged token', () => {
    it('is accepted when it really is signed by the held key, without a remote call', async () => {
      await expect(
        guard.validateToken(sign(held.privateKey, 'held')),
      ).resolves.toMatchObject({ id: 'user-1' });
      expect(getUser).not.toHaveBeenCalled();
    });

    it('is rejected locally, with no remote call, when it names a key we hold but is signed by another', async () => {
      for (let i = 0; i < 20; i++) {
        const forged = sign(stranger.privateKey, 'held', {}, { sub: `v-${i}` });
        await expect(guard.validateToken(forged)).resolves.toBeNull();
      }
      expect(getUser).not.toHaveBeenCalled();
    });

    it('goes to Supabase, with one warning, when the signature is ours but the issuer pin is not', async () => {
      JwtGuard['claimMismatchWarned'] = false;
      const warn = jest
        .spyOn(Logger.prototype, 'warn')
        .mockImplementation(() => undefined);
      const wrongIssuer = sign(held.privateKey, 'held', {
        issuer: 'https://elsewhere.example/auth/v1',
      });

      await guard.validateToken(wrongIssuer);
      await guard.validateToken(
        sign(
          held.privateKey,
          'held',
          {
            issuer: 'https://elsewhere.example/auth/v1',
          },
          { sub: 'user-2' },
        ),
      );

      expect(getUser).toHaveBeenCalledTimes(2);
      const issuerWarnings = warn.mock.calls.filter(([m]) =>
        String(m).includes('claim check'),
      );
      expect(issuerWarnings).toHaveLength(1);
      const text = String(issuerWarnings[0][0]);
      expect(text).toContain(ISSUER);
      expect(text).toContain('https://elsewhere.example/auth/v1');
      expect(text).not.toContain(wrongIssuer);
      warn.mockRestore();
    });

    it('is rejected locally when its expiry has passed, as before', async () => {
      const expired = sign(held.privateKey, 'held', { expiresIn: -10 });
      await expect(guard.validateToken(expired)).resolves.toBeNull();
      expect(getUser).not.toHaveBeenCalled();
    });

    it('still goes to Supabase when it names a key we do not hold (a rotation)', async () => {
      // Past the JWKS fetch floor so the lookup is allowed to refresh first.
      now += 120_000;
      const rotated = sign(stranger.privateKey, 'rotated-away');
      await guard.validateToken(rotated);
      expect(getUser).toHaveBeenCalledWith(rotated);
    });

    it('still goes to Supabase while no signing keys are loaded at all', async () => {
      // An outage of the JWKS endpoint, with nothing cached.
      publishing = false;
      JwtGuard['jwksKeys'] = new Map();
      JwtGuard['jwksLastAttempt'] = 0;
      now += 120_000;
      const token = sign(held.privateKey, 'held');
      await guard.validateToken(token);
      expect(getUser).toHaveBeenCalledWith(token);
      publishing = true;
    });
  });

  describe('bounded process-wide maps', () => {
    const statusCap = JwtGuard['MAX_STATUS_CACHE_SIZE'];
    const revokedCap = JwtGuard['MAX_REVOKED_USERS'];
    const statusCache = () => JwtGuard['accountStatusCache'];
    const revoked = () => JwtGuard['revokedUsers'];
    const status = (id: string) => guard['resolveAccountStatus'](id);

    beforeEach(() => {
      statusCache().clear();
      revoked().clear();
    });

    it('never holds more account statuses than its cap', async () => {
      for (let i = 0; i < statusCap + 500; i++) await status(`u-${i}`);
      expect(statusCache().size).toBeLessThanOrEqual(statusCap);
    });

    it('drops expired statuses when full instead of keeping them', async () => {
      for (let i = 0; i < statusCap; i++) await status(`old-${i}`);
      expect(statusCache().size).toBe(statusCap);

      now += JwtGuard['STATUS_TTL_MS'] + 1;
      await status('fresh');
      // Everything that expired was pruned; only the new entry is live.
      expect(statusCache().size).toBe(1);
    });

    it('keeps the status TTL: a read inside it is served from memory', async () => {
      findUnique.mockClear();
      await status('ttl-user');
      await status('ttl-user');
      expect(findUnique).toHaveBeenCalledTimes(1);

      now += JwtGuard['STATUS_TTL_MS'] + 1;
      await status('ttl-user');
      expect(findUnique).toHaveBeenCalledTimes(2);
    });

    it('clearAccountStatus still drops an entry at once', async () => {
      findUnique.mockClear();
      await status('cleared');
      JwtGuard.clearAccountStatus('cleared');
      await status('cleared');
      expect(findUnique).toHaveBeenCalledTimes(2);
    });

    it('never holds more revoked users than its cap', () => {
      for (let i = 0; i < revokedCap + 50; i++) JwtGuard.revokeUser(`r-${i}`);
      expect(revoked().size).toBeLessThanOrEqual(revokedCap);
      // The most recent revocation is never the one pushed out.
      expect(JwtGuard.isUserRevoked(`r-${revokedCap + 49}`)).toBe(true);
    });

    it('revokes now, and lifts a revocation, as before', () => {
      JwtGuard.revokeUser('gone');
      expect(JwtGuard.isUserRevoked('gone')).toBe(true);
      JwtGuard.unrevokeUser('gone');
      expect(JwtGuard.isUserRevoked('gone')).toBe(false);
    });

    it('lets a revocation lapse once no token it could block is still valid', () => {
      JwtGuard.revokeUser('lapsing');
      now += JwtGuard['REVOKED_USER_TTL_MS'] - 1000;
      expect(JwtGuard.isUserRevoked('lapsing')).toBe(true);
      now += 2000;
      expect(JwtGuard.isUserRevoked('lapsing')).toBe(false);
    });

    it('prunes lapsed revocations when full, so live ones are not the ones pushed out', () => {
      JwtGuard.revokeUser('live-before');
      for (let i = 0; i < revokedCap - 1; i++) JwtGuard.revokeUser(`bulk-${i}`);
      expect(revoked().size).toBe(revokedCap);

      now += JwtGuard['REVOKED_USER_TTL_MS'] + 1;
      JwtGuard.revokeUser('after');
      expect(revoked().size).toBe(1);
      expect(JwtGuard.isUserRevoked('after')).toBe(true);
    });
  });
});
