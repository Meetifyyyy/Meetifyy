import { describe, expect, it } from 'vitest';
import { parseIntentFromPath } from '../../../core/navigation/intents';
import { intentToRoute } from '../intentToRoute';

describe('intentToRoute', () => {
  it('round-trips every shareable route', () => {
    for (const path of ['/post/p1', '/profile/alex', '/communities/c1', '/crew/a1']) {
      expect(intentToRoute(parseIntentFromPath(path))).toBe(path);
    }
  });

  it('encodes identifiers so they cannot reach another route', () => {
    expect(intentToRoute({ t: 'post', id: '../settings?x=1' })).toBe('/post/..%2Fsettings%3Fx%3D1');
  });

  it('returns null for anything it does not know', () => {
    expect(intentToRoute(null)).toBeNull();
    expect(intentToRoute({ t: 'unknown' })).toBeNull();
    expect(intentToRoute(parseIntentFromPath('/crew/create'))).toBeNull();
  });
});
