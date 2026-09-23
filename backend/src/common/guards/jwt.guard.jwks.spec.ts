import { Reflector } from '@nestjs/core';
import { generateKeyPairSync, type KeyObject } from 'crypto';
import * as jwt from 'jsonwebtoken';
import { config } from '../../config';
import { JwtGuard } from './jwt.guard';
import type { SupabaseService } from '../../supabase/supabase.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { LegalConsentService } from '../legal/legal-consent.service';

/**
 * JWKS fetching under hostile input.
 *
 * A token that names an unknown `kid` forces a JWKS refresh, and that refresh
 * used to skip every throttle: a stream of tokens with invented `kid`s became
 * one outbound request to Supabase per inbound request, reachable without
 * signing in through the rate limiter's `peekUserId`. Fetches now have a
 * floor, and a genuine key rotation still heals once it has passed.
 *
 * Its own file on purpose: the key cache is static, so every test here shares
 * one freshly loaded module and runs in order.
 */
const SUPABASE_URL = 'https://jwks-spec.supabase.co';
const ISSUER = `${SUPABASE_URL}/auth/v1`;

const keyPair = () => generateKeyPairSync('ec', { namedCurve: 'P-256' });
const k1 = keyPair();
const k2 = keyPair();
const stranger = keyPair();

const jwk = (publicKey: KeyObject, kid: string) => ({
  ...publicKey.export({ format: 'jwk' }),
  kid,
  alg: 'ES256',
});

const sign = (privateKey: KeyObject, kid: string, sub = 'user-1') =>
  jwt.sign({ sub }, privateKey, {
    algorithm: 'ES256',
    keyid: kid,
    issuer: ISSUER,
  });

describe('JwtGuard JWKS refresh', () => {
  let now = Date.parse('2026-09-24T00:00:00Z');
  let published: object[] = [jwk(k1.publicKey, 'k1')];
  const fetchMock = jest.fn(() =>
    Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ keys: published }),
    } as unknown as Response),
  );
  let guard: JwtGuard;
  const originalFetch = global.fetch;

  beforeAll(async () => {
    jest.replaceProperty(config.auth.supabase, 'url', SUPABASE_URL);
    jest.replaceProperty(config.auth.supabase, 'jwtSecret', '');
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    global.fetch = fetchMock;

    guard = new JwtGuard(
      { isConfigured: true, client: {} } as unknown as SupabaseService,
      {} as PrismaService,
      new Reflector(),
      {} as LegalConsentService,
    );
    // Let the boot-time warm-up finish.
    await new Promise((resolve) => setImmediate(resolve));
  });

  afterAll(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('loads the published keys once at boot and verifies with them', async () => {
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await expect(guard.peekUserId(sign(k1.privateKey, 'k1'))).resolves.toBe(
      'user-1',
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not fetch once per token when tokens name unknown keys', async () => {
    now += 60_000; // past the floor, so exactly one refresh is allowed
    for (let i = 0; i < 25; i++) {
      await expect(
        guard.peekUserId(sign(stranger.privateKey, `made-up-${i}`)),
      ).resolves.toBeNull();
    }
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('picks up a rotated key once the floor has passed', async () => {
    published = [jwk(k1.publicKey, 'k1'), jwk(k2.publicKey, 'k2')];
    const rotated = sign(k2.privateKey, 'k2', 'user-2');

    // Inside the floor the new key is not fetched yet…
    await expect(guard.peekUserId(rotated)).resolves.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // …and after it, the next token signed with it verifies.
    now += 31_000;
    await expect(guard.peekUserId(rotated)).resolves.toBe('user-2');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
