import * as crypto from 'crypto';
import { config } from '../../config';
import { IS_PRODUCTION, IS_STAGING } from '../../config/env';

/**
 * Authenticated encryption for secrets the database has to hold but must never
 * hold in the clear.
 *
 * The case that brought this in is the Supabase refresh token. Moving user
 * sessions to HttpOnly cookies means the server keeps that token instead of the
 * browser — which is the point, since a script cannot reach it there — but it
 * would otherwise turn the session table into a set of live credentials, each
 * one able to mint access tokens for its account. Encrypted with a key that
 * lives in the environment, a dump of the table is inert.
 *
 * AES-256-GCM, so the ciphertext is authenticated: a row that has been tampered
 * with fails to open rather than decrypting to something attacker-chosen.
 */

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const VERSION = 'v1';

/**
 * A 32-byte key derived from configured secret material.
 *
 * Derived rather than used raw because the sources are text of arbitrary
 * length. The salt is constant: this is key derivation from a
 * high-entropy secret, not password hashing, so a per-record salt would buy
 * nothing and would have to be stored beside the ciphertext.
 */
function key(): Buffer {
  const material =
    config.auth.sessionSecret ||
    config.auth.supabase.serviceRoleKey ||
    config.auth.supabase.jwtSecret ||
    // Development and test only, mirroring UserOtpService: a well-known key is
    // acceptable where there is nothing of value to protect, and hard-failing
    // instead means a fresh clone without a service-role key cannot sign in at
    // all — and that CI cannot run a test that touches session issuance. It was
    // written to throw unconditionally, and CI is precisely the environment
    // with none of the three configured.
    (IS_PRODUCTION || IS_STAGING ? '' : 'meetifyy-development-session-key');

  if (!material) {
    // Reachable only in a deployed environment, where the service-role key is
    // required anyway. Refusing is right there: sealing session tokens under a
    // key an attacker could guess is worse than not starting.
    throw new Error(
      'No secret material configured for encryption. Set SESSION_SECRET.',
    );
  }

  return crypto.hkdfSync(
    'sha256',
    Buffer.from(material, 'utf8'),
    Buffer.from('meetifyy-secret-box', 'utf8'),
    Buffer.from('user-session-token', 'utf8'),
    32,
  ) as unknown as Buffer;
}

/** `v1.<iv>.<tag>.<ciphertext>`, all base64url. */
export function sealSecret(plaintext: string): string {
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGORITHM, key(), iv);
  const enc = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return [
    VERSION,
    iv.toString('base64url'),
    tag.toString('base64url'),
    enc.toString('base64url'),
  ].join('.');
}

/**
 * Opens a sealed secret, or returns null.
 *
 * Null rather than throwing: every caller's correct response to an unreadable
 * secret is the same — treat the session as unusable and make the user sign in
 * again — and that should not depend on remembering to catch.
 */
export function openSecret(sealed: string | null | undefined): string | null {
  if (!sealed) return null;
  const parts = sealed.split('.');
  if (parts.length !== 4 || parts[0] !== VERSION) return null;

  try {
    const iv = Buffer.from(parts[1], 'base64url');
    const tag = Buffer.from(parts[2], 'base64url');
    const data = Buffer.from(parts[3], 'base64url');
    const decipher = crypto.createDecipheriv(ALGORITHM, key(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([
      decipher.update(data),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    return null;
  }
}
