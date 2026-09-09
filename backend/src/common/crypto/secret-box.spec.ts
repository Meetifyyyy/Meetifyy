import { sealSecret, openSecret } from './secret-box';

/**
 * The session table holds the provider's refresh token so the browser does not.
 * That only helps if the column is inert to anyone reading the database, which
 * is what these pin: the plaintext never appears, and a tampered row refuses to
 * open rather than yielding attacker-chosen bytes.
 */
describe('secret-box', () => {
  /**
   * There is a key here because the test environment falls back to a
   * well-known development one, not because this file sets it.
   *
   * Worth stating, because these passed locally for the wrong reason: the
   * command that ran them happened to export SESSION_SECRET, while CI exports
   * none of the three sources and every test threw. Setting the variable from
   * inside the spec would not have helped either — `config` reads the
   * environment once at module load, long before any hook runs. The fix was in
   * the module: refuse to invent a key in a deployed environment, and use the
   * development one everywhere else.
   */
  const secret = 'provider-refresh-token-value';

  it('round-trips', () => {
    expect(openSecret(sealSecret(secret))).toBe(secret);
  });

  it('never leaves the plaintext in the ciphertext', () => {
    expect(sealSecret(secret)).not.toContain(secret);
  });

  it('produces a different ciphertext each time (random IV)', () => {
    expect(sealSecret(secret)).not.toBe(sealSecret(secret));
  });

  it('refuses a tampered ciphertext instead of returning garbage', () => {
    const sealed = sealSecret(secret);
    const parts = sealed.split('.');
    // Flip a byte in the ciphertext segment.
    const body = Buffer.from(parts[3], 'base64url');
    body[0] ^= 0xff;
    parts[3] = body.toString('base64url');
    expect(openSecret(parts.join('.'))).toBeNull();
  });

  it('refuses a tampered auth tag', () => {
    const parts = sealSecret(secret).split('.');
    const tag = Buffer.from(parts[2], 'base64url');
    tag[0] ^= 0xff;
    parts[2] = tag.toString('base64url');
    expect(openSecret(parts.join('.'))).toBeNull();
  });

  it.each([null, undefined, '', 'garbage', 'v1.only.three'])(
    'returns null for malformed input %p',
    (input) => {
      expect(openSecret(input as any)).toBeNull();
    },
  );
});
