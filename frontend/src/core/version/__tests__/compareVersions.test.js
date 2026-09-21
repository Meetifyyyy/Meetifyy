import { describe, it, expect } from 'vitest';

import { parseVersion, compareVersions, evaluateVersion } from '../compareVersions';

describe('parseVersion', () => {
  it('reads a plain store version', () => {
    expect(parseVersion('1.2.3')).toEqual([1, 2, 3]);
    expect(parseVersion('1.0')).toEqual([1, 0]);
    expect(parseVersion('12')).toEqual([12]);
  });

  it('tolerates surrounding whitespace, which an env var routinely carries', () => {
    expect(parseVersion('  1.2.3  ')).toEqual([1, 2, 3]);
  });

  /**
   * Everything here must be null, not a guess. A version this cannot read is a
   * version it must not gate on — see the note at the top of the module.
   */
  it.each([
    ['a v prefix', 'v1.2.3'],
    ['a prerelease suffix', '1.2.3-beta'],
    ['build metadata', '1.2.3+build7'],
    ['a commit sha', 'a1b2c3d'],
    ['an empty string', ''],
    ['whitespace only', '   '],
    ['a number', 123],
    ['null', null],
    ['undefined', undefined],
    ['an object', { version: '1.0.0' }],
  ])('refuses to guess at %s', (_label, input) => {
    expect(parseVersion(input)).toBeNull();
  });
});

describe('compareVersions', () => {
  it('orders by each segment in turn', () => {
    expect(compareVersions('1.0.0', '2.0.0')).toBe(-1);
    expect(compareVersions('2.0.0', '1.0.0')).toBe(1);
    expect(compareVersions('1.2.0', '1.10.0')).toBe(-1);
    expect(compareVersions('1.0.9', '1.0.10')).toBe(-1);
  });

  /**
   * The classic string-compare bug: '1.10.0' < '1.2.0' alphabetically. If this
   * ever regresses, every user on a .10 build is told to downgrade.
   */
  it('compares numerically, not alphabetically', () => {
    expect(compareVersions('1.10.0', '1.9.0')).toBe(1);
  });

  it('treats missing segments as zero', () => {
    expect(compareVersions('1.0', '1.0.0')).toBe(0);
    expect(compareVersions('1', '1.0.0')).toBe(0);
    expect(compareVersions('1.0', '1.0.1')).toBe(-1);
  });

  it('is null when either side is unreadable', () => {
    expect(compareVersions('1.0.0', 'nonsense')).toBeNull();
    expect(compareVersions(undefined, '1.0.0')).toBeNull();
  });
});

describe('evaluateVersion', () => {
  it('blocks a build below the minimum', () => {
    expect(evaluateVersion({ current: '1.0.0', minimum: '1.1.0', latest: '1.2.0' })).toBe(
      'blocked',
    );
  });

  it('nudges a build between the minimum and the latest', () => {
    expect(evaluateVersion({ current: '1.1.0', minimum: '1.1.0', latest: '1.2.0' })).toBe(
      'outdated',
    );
  });

  it('is happy on the latest build', () => {
    expect(evaluateVersion({ current: '1.2.0', minimum: '1.1.0', latest: '1.2.0' })).toBe('ok');
  });

  it('is happy on a build newer than the server knows about', () => {
    // A store rollout reaches users before someone updates the variable.
    expect(evaluateVersion({ current: '1.3.0', minimum: '1.1.0', latest: '1.2.0' })).toBe('ok');
  });

  /**
   * The defaults. A deployment that never sets the variables must gate nobody,
   * because the alternative is a gate that switches itself on by omission.
   */
  it('gates nobody when the thresholds are the 0.0.0 defaults', () => {
    expect(evaluateVersion({ current: '1.0.0', minimum: '0.0.0', latest: '0.0.0' })).toBe('ok');
  });

  /**
   * Fail-open, the single most important property here. A typo in an
   * environment variable, a missing app version, or a malformed response must
   * never lock people out of an app that works — there is no way to push them a
   * fix once it does.
   */
  it.each([
    ['an unreadable minimum', { current: '1.0.0', minimum: 'oops', latest: '1.2.0' }],
    ['an unreadable current version', { current: undefined, minimum: '1.1.0', latest: '1.2.0' }],
    ['a missing minimum', { current: '1.0.0', minimum: null, latest: null }],
    ['everything missing', {}],
  ])('never blocks on %s', (_label, args) => {
    // Not `toBe('ok')`: the two thresholds are independent. An unreadable
    // MINIMUM must not block, but a readable LATEST beside it still means the
    // build really is out of date, and the dismissible nudge is the right
    // answer there. What must never happen is a wall.
    expect(evaluateVersion(args)).not.toBe('blocked');
  });

  it('still blocks when only the latest is unreadable', () => {
    // The hard gate is independent of the nudge; one bad value must not
    // disable the other.
    expect(evaluateVersion({ current: '1.0.0', minimum: '1.1.0', latest: 'oops' })).toBe(
      'blocked',
    );
  });
});
