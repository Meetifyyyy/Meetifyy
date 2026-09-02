import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_AVATAR_SRC, isPlatformDefaultAvatar } from '../defaultAvatar';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../..');

/**
 * The grey avatar was never a colour bug — it was four independent copies of
 * "what to show when someone has no picture" drifting apart, and two earlier
 * fixes each recoloured one of them. These tests hold the copies together.
 */
describe('the default avatar', () => {
  it('is the blue artwork, in the file the app actually serves', () => {
    const svg = readFileSync(resolve(repoRoot, 'frontend/public/default_avatar.svg'), 'utf8');
    expect(svg).toContain('#1d68f7');
    // The grey placeholder the API used to answer avatar misses with.
    expect(svg).not.toContain('#94a3b8');
    expect(svg).not.toContain('#e2e8f0');
  });

  it('matches the markup the backend falls back to', () => {
    const svg = readFileSync(resolve(repoRoot, 'frontend/public/default_avatar.svg'), 'utf8').trim();
    const backend = readFileSync(resolve(repoRoot, 'backend/src/uploads/default-avatar.ts'), 'utf8');
    // Same four drawing instructions, so an account with no picture looks the
    // same whether the client or the server is the one that noticed.
    for (const fragment of svg.split('\n').map((l) => l.trim()).filter(Boolean)) {
      expect(backend).toContain(fragment);
    }
  });

  it('recognises the stored backend default as "no picture"', () => {
    // What the backend writes onto an account that never chose an avatar.
    expect(isPlatformDefaultAvatar('/api/media/defaults/profile-avatar-v2.webp')).toBe(true);
    // Version-independent, so bumping the artwork does not reintroduce the bug.
    expect(isPlatformDefaultAvatar('/api/media/defaults/profile-avatar-v1.webp')).toBe(true);
    expect(isPlatformDefaultAvatar('https://cdn.meetifyy.app/defaults/profile-avatar-v2.webp')).toBe(true);
    expect(isPlatformDefaultAvatar(DEFAULT_AVATAR_SRC)).toBe(true);
  });

  it('never mistakes a real uploaded picture for the default', () => {
    // Uploads land under avatars/ and must be preserved untouched.
    expect(isPlatformDefaultAvatar('/api/media/avatars/a307fc54-09e0-49e2-91b4-30e72185220e.webp')).toBe(false);
    expect(isPlatformDefaultAvatar('https://api.dicebear.com/10.x/critters/svg?seed=Cleo')).toBe(false);
    // A filename that merely mentions the default is still the user's own file.
    expect(isPlatformDefaultAvatar('/api/media/avatars/profile-avatar-v2.webp')).toBe(false);
  });

  it('treats absent values as no picture rather than throwing', () => {
    for (const empty of [null, undefined, '', '   ', 42, {}]) {
      expect(isPlatformDefaultAvatar(empty)).toBe(false);
    }
  });
});
