import { describe, expect, it } from 'vitest';
import { resolveVerificationCelebration } from '../verificationCelebration';

describe('resolveVerificationCelebration', () => {
  it('celebrates a genuine transition into VERIFIED', () => {
    expect(resolveVerificationCelebration('PENDING', 'VERIFIED')).toEqual({
      celebrate: true,
      nextStored: 'VERIFIED',
    });
    expect(resolveVerificationCelebration('UNVERIFIED', 'VERIFIED')).toEqual({
      celebrate: true,
      nextStored: 'VERIFIED',
    });
    expect(resolveVerificationCelebration('REJECTED', 'VERIFIED')).toEqual({
      celebrate: true,
      nextStored: 'VERIFIED',
    });
  });

  it('stays silent the first time it ever sees an account', () => {
    // The bug this exists to prevent: without it, every already-verified user
    // would be congratulated the first time they loaded the new build.
    expect(resolveVerificationCelebration(null, 'VERIFIED')).toEqual({
      celebrate: false,
      nextStored: 'VERIFIED',
    });
    expect(resolveVerificationCelebration(undefined, 'VERIFIED')).toEqual({
      celebrate: false,
      nextStored: 'VERIFIED',
    });
  });

  it('does not repeat once acknowledged and recorded', () => {
    expect(resolveVerificationCelebration('VERIFIED', 'VERIFIED')).toEqual({
      celebrate: false,
      // Nothing changed, so nothing is written — a pointless write would fire a
      // storage event in every other tab on every render.
      nextStored: null,
    });
  });

  it('does not celebrate any non-verified status', () => {
    for (const status of ['PENDING', 'UNVERIFIED', 'REJECTED']) {
      expect(resolveVerificationCelebration('UNVERIFIED', status).celebrate).toBe(
        false,
      );
    }
  });

  it('celebrates again after a genuine re-verification', () => {
    // Verified → rejected → verified is a real sequence (a re-submitted ID),
    // and the second success is worth marking.
    expect(resolveVerificationCelebration('REJECTED', 'VERIFIED').celebrate).toBe(
      true,
    );
  });

  it('records a status change even when there is nothing to celebrate', () => {
    expect(resolveVerificationCelebration('UNVERIFIED', 'PENDING')).toEqual({
      celebrate: false,
      nextStored: 'PENDING',
    });
  });

  it('does nothing without a current status', () => {
    // The auth sync has not landed yet; there is no transition to judge.
    expect(resolveVerificationCelebration('PENDING', null)).toEqual({
      celebrate: false,
      nextStored: null,
    });
    expect(resolveVerificationCelebration(null, undefined)).toEqual({
      celebrate: false,
      nextStored: null,
    });
  });
});
