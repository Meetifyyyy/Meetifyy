import { describe, it, expect } from 'vitest';
import {
  isMessagingEligibleStatus,
  MESSAGING_UNAVAILABLE_TEXT,
  MESSAGING_SELF_UNVERIFIED_TEXT,
  resolveComposerState,
} from '../messagingEligibility';

describe('messagingEligibility', () => {
  it('treats VERIFIED as the only eligible status', () => {
    expect(isMessagingEligibleStatus('VERIFIED')).toBe(true);
    for (const status of ['PENDING', 'UNVERIFIED', 'REJECTED', 'RESUBMISSION_REQUIRED']) {
      expect(isMessagingEligibleStatus(status)).toBe(false);
    }
  });

  it('treats a missing status as ineligible rather than assuming the best', () => {
    expect(isMessagingEligibleStatus(undefined)).toBe(false);
    expect(isMessagingEligibleStatus(null)).toBe(false);
    expect(isMessagingEligibleStatus('')).toBe(false);
  });

  it('uses one wording for the other party, whatever their actual status is', () => {
    // The copy is the disclosure boundary: if it ever varied by status, the
    // viewer could read the other account's verification state off the UI.
    expect(MESSAGING_UNAVAILABLE_TEXT).toBe('This user is not available for messaging.');
    expect(MESSAGING_SELF_UNVERIFIED_TEXT).not.toBe(MESSAGING_UNAVAILABLE_TEXT);
  });
});

describe('resolveComposerState', () => {
  const blockedByMe = 'You blocked this user. Unblock them to continue messaging.';
  const blocked = 'You can no longer send messages to this user.';

  it('offers a working composer when nothing is wrong', () => {
    expect(resolveComposerState({ canSend: true })).toEqual({
      disabled: false,
      reason: null,
    });
  });

  it('replaces the composer when the pair is not eligible', () => {
    expect(
      resolveComposerState({ canSend: false, verificationReason: MESSAGING_UNAVAILABLE_TEXT }),
    ).toEqual({ disabled: true, reason: MESSAGING_UNAVAILABLE_TEXT });
  });

  it('falls back to the unavailable wording when no reason was supplied', () => {
    expect(resolveComposerState({ canSend: false }).reason).toBe(
      MESSAGING_UNAVAILABLE_TEXT,
    );
  });

  it('prefers the block wording over the verification wording', () => {
    // Both are true at once whenever a blocked user also lapses. Showing
    // "not available for messaging" to the person who placed the block would
    // hide the Unblock affordance that actually resolves it.
    expect(
      resolveComposerState({
        isBlockedByMe: true,
        isBlocked: true,
        canSend: false,
        verificationReason: MESSAGING_UNAVAILABLE_TEXT,
      }).reason,
    ).toBe(blockedByMe);
  });

  it('never offers Unblock to the person who was blocked', () => {
    expect(
      resolveComposerState({ isBlockedByMe: false, isBlocked: true, canSend: false }).reason,
    ).toBe(blocked);
  });

  it('prefers a membership problem over the verification wording', () => {
    expect(
      resolveComposerState({
        membershipReason: 'You have been banned from this group',
        canSend: false,
      }).reason,
    ).toBe('You have been banned from this group');
  });

  it('is disabled exactly when it has a reason', () => {
    const cases = [
      { canSend: true },
      { canSend: false },
      { isBlocked: true, canSend: true },
      { isBlockedByMe: true, canSend: true },
      { membershipReason: 'x', canSend: true },
    ];
    for (const input of cases) {
      const { disabled, reason } = resolveComposerState(input);
      expect(disabled).toBe(reason !== null);
    }
  });
});
