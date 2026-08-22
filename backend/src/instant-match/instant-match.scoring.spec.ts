import { computeMatchScore } from './instant-match.scoring';
import { getAcceptTimerSecs } from './instant-match.constants';

describe('computeMatchScore', () => {
  const empty = { area: null, optionalDetail: null, latitude: null, longitude: null, interests: [] };

  it('scores nothing when the two sides share nothing', () => {
    expect(computeMatchScore(empty, empty)).toBe(0);
  });

  it('weights a shared campus area above a shared detail above shared interests', () => {
    const area = computeMatchScore({ ...empty, area: 'library' }, { ...empty, area: 'library' });
    const detail = computeMatchScore(
      { ...empty, optionalDetail: 'Physics' },
      { ...empty, optionalDetail: 'Physics' },
    );
    const interests = computeMatchScore(
      { ...empty, interests: ['chess'] },
      { ...empty, interests: ['chess'] },
    );
    expect(area).toBeGreaterThan(detail);
    expect(detail).toBeGreaterThan(interests);
    expect(interests).toBeGreaterThan(0);
  });

  it('matches details case- and whitespace-insensitively', () => {
    expect(
      computeMatchScore(
        { ...empty, optionalDetail: '  physics ' },
        { ...empty, optionalDetail: 'Physics' },
      ),
    ).toBeGreaterThan(0);
  });

  it('does not award a detail point when only one side supplied one', () => {
    expect(computeMatchScore({ ...empty, optionalDetail: 'Physics' }, empty)).toBe(0);
  });

  it('rewards close GPS proximity more than merely nearby', () => {
    const base = { latitude: 27.6, longitude: 77.6 };
    // ~50 m apart
    const veryClose = computeMatchScore(
      { ...empty, ...base },
      { ...empty, latitude: 27.60045, longitude: 77.6 },
    );
    // ~220 m apart
    const nearby = computeMatchScore(
      { ...empty, ...base },
      { ...empty, latitude: 27.602, longitude: 77.6 },
    );
    // ~2 km apart
    const far = computeMatchScore(
      { ...empty, ...base },
      { ...empty, latitude: 27.62, longitude: 77.6 },
    );
    expect(veryClose).toBeGreaterThan(nearby);
    expect(nearby).toBeGreaterThan(far);
    expect(far).toBe(0);
  });

  it('ignores GPS when either side withheld it', () => {
    expect(computeMatchScore({ ...empty, latitude: 27.6, longitude: 77.6 }, empty)).toBe(0);
  });

  it('is symmetric — the pair scores the same regardless of who searched first', () => {
    const a = { area: 'library', optionalDetail: 'Physics', latitude: 27.6, longitude: 77.6, interests: ['chess', 'music'] };
    const b = { area: 'library', optionalDetail: 'physics', latitude: 27.6001, longitude: 77.6, interests: ['music'] };
    expect(computeMatchScore(a, b)).toBe(computeMatchScore(b, a));
  });
});

describe('getAcceptTimerSecs', () => {
  it('gives outdoor activities a longer window than indoor ones', () => {
    expect(getAcceptTimerSecs('sports', 'now')).toBeGreaterThan(getAcceptTimerSecs('study', 'now'));
    expect(getAcceptTimerSecs('walk', 'now')).toBeGreaterThan(getAcceptTimerSecs('coffee', 'now'));
  });

  it('gives the longest window to "today", regardless of activity', () => {
    expect(getAcceptTimerSecs('study', 'today')).toBe(90);
    expect(getAcceptTimerSecs('sports', 'today')).toBe(90);
  });

  it('falls back to the indoor window for an unrecognised activity', () => {
    expect(getAcceptTimerSecs('unknown', 'now')).toBe(30);
  });
});
