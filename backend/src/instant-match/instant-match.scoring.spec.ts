import {
  computeCompatibility,
  computeMatchScore,
  relaxedThreshold,
  MATCH_THRESHOLD_START,
  MATCH_RELAX_FULL_MS,
} from './instant-match.scoring';
import { getAcceptTimerSecs } from './instant-match.constants';

describe('computeCompatibility', () => {
  const blank = {
    campus: null,
    activity: 'study',
    timePreference: null,
    area: null,
    optionalDetail: null,
    latitude: null,
    longitude: null,
    interests: [],
    course: null,
    branch: null,
    currentYear: null,
  };

  it('scores an entirely unknown pair at the neutral midpoint', () => {
    // Nothing known is not the same as nothing in common.
    expect(computeMatchScore(blank, blank)).toBe(50);
  });

  it('is symmetric — the pair scores the same whoever searched first', () => {
    const a = {
      ...blank,
      campus: 'Acme',
      timePreference: 'now',
      area: 'library',
      optionalDetail: 'Physics',
      latitude: 27.6,
      longitude: 77.6,
      interests: ['chess', 'music'],
      course: 'BTech',
      branch: 'CSE',
      currentYear: 2,
    };
    const b = {
      ...blank,
      campus: 'Acme',
      timePreference: '30min',
      area: 'library',
      optionalDetail: 'physics revision',
      latitude: 27.6001,
      longitude: 77.6,
      interests: ['music'],
      course: 'BTech',
      branch: 'ECE',
      currentYear: 3,
    };
    expect(computeMatchScore(a, b)).toBe(computeMatchScore(b, a));
  });

  it('rates a fully aligned pair far above a fully misaligned one', () => {
    const aligned = computeMatchScore(
      {
        ...blank,
        campus: 'Acme',
        timePreference: 'now',
        area: 'library',
        interests: ['chess'],
      },
      {
        ...blank,
        campus: 'Acme',
        timePreference: 'now',
        area: 'library',
        interests: ['chess'],
      },
    );
    const misaligned = computeMatchScore(
      {
        ...blank,
        campus: 'Acme',
        timePreference: 'now',
        area: 'library',
        interests: ['chess'],
      },
      {
        ...blank,
        campus: 'Other',
        timePreference: 'today',
        area: 'hostel',
        interests: ['golf'],
      },
    );
    // Not 100: the factors neither side supplied (GPS, detail, course) stay
    // at the neutral midpoint rather than being counted as agreement.
    expect(aligned).toBeGreaterThan(75);
    expect(misaligned).toBeLessThan(45);
    expect(aligned - misaligned).toBeGreaterThan(30);
  });

  describe('missing signals are neutral, never penalties', () => {
    it('does not punish a user for withholding GPS', () => {
      const withGps = { ...blank, latitude: 27.6, longitude: 77.6 };
      expect(computeCompatibility(withGps, blank).breakdown.proximity).toBe(
        0.5,
      );
    });

    it('does not punish a user for skipping the campus area', () => {
      expect(
        computeCompatibility({ ...blank, area: 'library' }, blank).breakdown
          .area,
      ).toBe(0.5);
    });

    it('scores an unknown-location pair above a known-distant one', () => {
      const unknown = computeMatchScore(
        { ...blank, campus: 'Acme' },
        { ...blank, campus: 'Acme' },
      );
      const far = computeMatchScore(
        {
          ...blank,
          campus: 'Acme',
          latitude: 27.6,
          longitude: 77.6,
          area: 'library',
        },
        {
          ...blank,
          campus: 'Acme',
          latitude: 28.9,
          longitude: 77.6,
          area: 'hostel',
        },
      );
      expect(unknown).toBeGreaterThan(far);
    });
  });

  describe('location never disqualifies on its own', () => {
    it('keeps a distant but otherwise perfect pair well above the floor', () => {
      const shared = {
        campus: 'Acme',
        timePreference: 'now',
        interests: ['chess', 'music', 'film'],
        optionalDetail: 'Physics',
        course: 'BTech',
        branch: 'CSE',
        currentYear: 2,
      };
      const score = computeMatchScore(
        {
          ...blank,
          ...shared,
          area: 'library',
          latitude: 27.6,
          longitude: 77.6,
        },
        {
          ...blank,
          ...shared,
          area: 'hostel',
          latitude: 27.7,
          longitude: 77.7,
        },
      );
      // Comfortably matchable despite disagreeing on both location signals.
      expect(score).toBeGreaterThan(MATCH_THRESHOLD_START);
    });
  });

  describe('time preference', () => {
    it('treats adjacent windows as compatible rather than disqualifying', () => {
      const exact = computeCompatibility(
        { ...blank, timePreference: 'now' },
        { ...blank, timePreference: 'now' },
      ).breakdown.timePreference;
      const adjacent = computeCompatibility(
        { ...blank, timePreference: 'now' },
        { ...blank, timePreference: '30min' },
      ).breakdown.timePreference;
      const distant = computeCompatibility(
        { ...blank, timePreference: 'now' },
        { ...blank, timePreference: 'today' },
      ).breakdown.timePreference;

      expect(exact).toBe(1);
      expect(adjacent).toBeGreaterThan(distant);
      expect(distant).toBeGreaterThan(0);
    });
  });

  describe('proximity', () => {
    it('decays smoothly with distance instead of stepping off a cliff', () => {
      const base = { ...blank, latitude: 27.6, longitude: 77.6 };
      const p = (lat: number) =>
        computeCompatibility(base, { ...blank, latitude: lat, longitude: 77.6 })
          .breakdown.proximity;

      expect(p(27.60045)).toBe(1); // ~50 m
      expect(p(27.602)).toBeGreaterThan(p(27.62)); // ~220 m vs ~2 km
      expect(p(27.62)).toBeGreaterThan(p(28.6)); // ~2 km vs ~110 km
      expect(p(28.6)).toBeGreaterThan(0); // never zero
    });
  });

  describe('interests', () => {
    it('rewards deeper overlap more than a single shared tag', () => {
      const one = computeCompatibility(
        { ...blank, interests: ['chess', 'film', 'music'] },
        { ...blank, interests: ['chess', 'golf', 'cooking'] },
      ).breakdown.interests;
      const three = computeCompatibility(
        { ...blank, interests: ['chess', 'film', 'music'] },
        { ...blank, interests: ['chess', 'film', 'music'] },
      ).breakdown.interests;
      expect(three).toBeGreaterThan(one);
    });

    it('is neutral when either side listed no interests at all', () => {
      expect(
        computeCompatibility({ ...blank, interests: ['chess'] }, blank)
          .breakdown.interests,
      ).toBe(0.5);
    });
  });

  describe('optional detail', () => {
    it('matches case- and whitespace-insensitively', () => {
      expect(
        computeCompatibility(
          { ...blank, optionalDetail: '  physics ' },
          { ...blank, optionalDetail: 'Physics' },
        ).breakdown.detail,
      ).toBe(1);
    });

    it('credits a partial token overlap', () => {
      const partial = computeCompatibility(
        { ...blank, optionalDetail: 'physics revision' },
        { ...blank, optionalDetail: 'physics problem set' },
      ).breakdown.detail;
      const none = computeCompatibility(
        { ...blank, optionalDetail: 'physics' },
        { ...blank, optionalDetail: 'poetry' },
      ).breakdown.detail;
      expect(partial).toBeGreaterThan(none);
    });
  });

  describe('community relevance', () => {
    it('ranks same course and branch above same course alone', () => {
      const both = computeCompatibility(
        { ...blank, course: 'BTech', branch: 'CSE' },
        { ...blank, course: 'BTech', branch: 'CSE' },
      ).breakdown.community;
      const courseOnly = computeCompatibility(
        { ...blank, course: 'BTech', branch: 'CSE' },
        { ...blank, course: 'BTech', branch: 'ECE' },
      ).breakdown.community;
      expect(both).toBeGreaterThan(courseOnly);
    });

    it('treats a neighbouring year as closer than a distant one', () => {
      const near = computeCompatibility(
        { ...blank, currentYear: 2 },
        { ...blank, currentYear: 3 },
      ).breakdown.community;
      const far = computeCompatibility(
        { ...blank, currentYear: 1 },
        { ...blank, currentYear: 4 },
      ).breakdown.community;
      expect(near).toBeGreaterThan(far);
    });
  });
});

describe('relaxedThreshold', () => {
  it('starts strict', () => {
    expect(relaxedThreshold(0)).toBe(MATCH_THRESHOLD_START);
  });

  it('relaxes monotonically as the wait grows', () => {
    const t30 = relaxedThreshold(30_000);
    const t90 = relaxedThreshold(90_000);
    expect(t30).toBeLessThan(MATCH_THRESHOLD_START);
    expect(t90).toBeLessThan(t30);
  });

  it('accepts any same-activity partner once the wait is long enough', () => {
    expect(relaxedThreshold(MATCH_RELAX_FULL_MS)).toBe(0);
    expect(relaxedThreshold(MATCH_RELAX_FULL_MS * 10)).toBe(0);
  });
});

describe('getAcceptTimerSecs', () => {
  it('gives outdoor activities a longer window than indoor ones', () => {
    expect(getAcceptTimerSecs('sports', 'now')).toBeGreaterThan(
      getAcceptTimerSecs('study', 'now'),
    );
    expect(getAcceptTimerSecs('walk', 'now')).toBeGreaterThan(
      getAcceptTimerSecs('coffee', 'now'),
    );
  });

  it('gives the longest window to "today", regardless of activity', () => {
    expect(getAcceptTimerSecs('study', 'today')).toBe(90);
    expect(getAcceptTimerSecs('sports', 'today')).toBe(90);
  });

  it('falls back to the indoor window for an unrecognised activity', () => {
    expect(getAcceptTimerSecs('unknown', 'now')).toBe(30);
  });
});
