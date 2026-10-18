import {
  PROFILE_PROMPT_SNOOZE_MS,
  isProfilePromptSnoozed,
  profileCompletion,
} from './campus-affiliation.util';

const NOW = new Date('2026-10-18T12:00:00Z');
const ago = (ms: number) => new Date(NOW.getTime() - ms);
const DAY = 24 * 60 * 60 * 1000;

describe('isProfilePromptSnoozed', () => {
  it('is snoozed in the same session within 10 days', () => {
    expect(
      isProfilePromptSnoozed(
        { laterAt: ago(9 * DAY), laterSessionId: 's1' },
        's1',
        NOW,
      ),
    ).toBe(true);
  });

  it('is not snoozed once 10 days have passed', () => {
    expect(
      isProfilePromptSnoozed(
        { laterAt: ago(PROFILE_PROMPT_SNOOZE_MS), laterSessionId: 's1' },
        's1',
        NOW,
      ),
    ).toBe(false);
  });

  it('is not snoozed on a different session (signed in again)', () => {
    expect(
      isProfilePromptSnoozed(
        { laterAt: ago(DAY), laterSessionId: 's1' },
        's2',
        NOW,
      ),
    ).toBe(false);
  });

  it('is not snoozed when the caller has no session id, or nothing is stored', () => {
    const stored = { laterAt: ago(DAY), laterSessionId: 's1' };
    expect(isProfilePromptSnoozed(stored, null, NOW)).toBe(false);
    expect(isProfilePromptSnoozed(null, 's1', NOW)).toBe(false);
    expect(
      isProfilePromptSnoozed(
        { laterAt: null, laterSessionId: null },
        's1',
        NOW,
      ),
    ).toBe(false);
  });

  it('ignores a snooze stamped in the future', () => {
    expect(
      isProfilePromptSnoozed(
        { laterAt: new Date(NOW.getTime() + DAY), laterSessionId: 's1' },
        's1',
        NOW,
      ),
    ).toBe(false);
  });
});

describe('profileCompletion payload', () => {
  const base = {
    email: 'a@college.edu',
    gender: null,
    affiliationEmailNormalized: 'a@college.edu',
  };

  it('keeps the existing flags and adds promptSnoozed=false by default', () => {
    expect(profileCompletion(base)).toEqual({
      needsPersonalEmail: true,
      needsGender: true,
      promptSnoozed: false,
    });
  });

  it('reports promptSnoozed without changing the needs flags', () => {
    expect(
      profileCompletion({
        ...base,
        snooze: { laterAt: ago(DAY), laterSessionId: 's1' },
        currentSessionId: 's1',
        now: NOW,
      }),
    ).toEqual({
      needsPersonalEmail: true,
      needsGender: true,
      promptSnoozed: true,
    });
  });
});
