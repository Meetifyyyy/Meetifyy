import {
  BASE_WEIGHTS,
  FEEDBACK,
  MAX_WEIGHT_SHARE,
  SELECTION,
  SIGNAL_KEYS,
} from './matching.config';
import {
  explainPair,
  relaxedThreshold,
  resolveIntent,
  resolveWeights,
  scorePair,
} from './engine';
import { orderCandidates, thresholdFor } from './selection';
import { PairFeedback, SideContext, isHardSkipped } from './signals';

/**
 * The ranking engine.
 *
 * These tests are about the *properties* the ranker has to keep, not about
 * particular numbers: weights that always sum to 100 and never let one signal
 * take over, evidence that costs weight rather than points, feedback that
 * decays instead of banning, and an order that is diversified without ever
 * being unfair. A tuning change should move the numbers and leave every one of
 * these passing; if it breaks one, the change broke a rule rather than a value.
 */

const NOW = 1_700_000_000_000;

const side = (over: Partial<SideContext> = {}): SideContext => ({
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
  passingYear: null,
  joinedAt: NOW,
  communityIds: null,
  ...over,
});

const feedback = (over: Partial<PairFeedback> = {}): PairFeedback => ({
  accepted: 0,
  declinedByMe: 0,
  declinedByThem: 0,
  expired: 0,
  lastPairedAt: null,
  ...over,
});

const scoreOf = (
  a: SideContext,
  b: SideContext,
  opts: Parameters<typeof scorePair>[2] = {},
) => scorePair(a, b, { now: NOW, ...opts }).score;

// ─── Weights ─────────────────────────────────────────────────────────────────

describe('weight resolution', () => {
  const intents = [
    { urgency: 0 as const, activity: 'study' },
    { urgency: 0 as const, activity: 'walk' },
    { urgency: 1 as const, activity: null },
    { urgency: 2 as const, activity: 'chat' },
    { urgency: 2 as const, activity: 'unknown-activity' },
  ];

  it('always sums to 100, whatever the intent', () => {
    for (const intent of intents) {
      const total = Object.values(resolveWeights(intent)).reduce(
        (s, w) => s + w,
        0,
      );
      expect(total).toBeCloseTo(100, 6);
    }
  });

  it('never lets one signal dominate the score', () => {
    // The cap is the point: intent multipliers stack, and without it a
    // "meet now" walk would have put a quarter of the score on GPS alone.
    for (const intent of intents) {
      const weights = resolveWeights(intent);
      for (const key of SIGNAL_KEYS) {
        expect(weights[key]).toBeLessThanOrEqual(100 * MAX_WEIGHT_SHARE + 1e-6);
      }
    }
  });

  it('caps a signal even when an override tries to run away with it', () => {
    const weights = resolveWeights(
      { urgency: 0, activity: 'study' },
      { proximity: 40 },
    );
    expect(weights.proximity).toBeLessThanOrEqual(
      100 * MAX_WEIGHT_SHARE + 1e-6,
    );
    expect(Object.values(weights).reduce((s, w) => s + w, 0)).toBeCloseTo(
      100,
      6,
    );
  });

  it('weights logistics for "now" and character for "today"', () => {
    const now = resolveWeights({ urgency: 0, activity: null });
    const later = resolveWeights({ urgency: 2, activity: null });

    expect(now.proximity).toBeGreaterThan(later.proximity);
    expect(now.area).toBeGreaterThan(later.area);
    expect(later.interests).toBeGreaterThan(now.interests);
  });

  it('weights course and branch for study, and distance for a walk', () => {
    const study = resolveWeights({ urgency: 1, activity: 'study' });
    const walk = resolveWeights({ urgency: 1, activity: 'walk' });

    expect(study.community).toBeGreaterThan(walk.community);
    expect(walk.proximity).toBeGreaterThan(study.proximity);
  });

  it('falls back to the base shape for an activity it has never heard of', () => {
    const known = resolveWeights({ urgency: 1, activity: 'study' });
    const unknown = resolveWeights({ urgency: 1, activity: 'quidditch' });
    expect(unknown.community).toBeLessThan(known.community);
    // Base table, only renormalised — the relative order is untouched.
    expect(unknown.campus).toBeGreaterThan(unknown.detail);
    expect(BASE_WEIGHTS.campus).toBeGreaterThan(BASE_WEIGHTS.detail);
  });

  it('derives intent from the pair, not from one side', () => {
    // Symmetry is the constraint: the tighter of the two windows wins, so
    // both people are scored as being in the same kind of hurry.
    const a = side({ timePreference: 'now', activity: 'coffee' });
    const b = side({ timePreference: 'today', activity: 'coffee' });
    expect(resolveIntent(a, b)).toEqual(resolveIntent(b, a));
    expect(resolveIntent(a, b).urgency).toBe(0);
  });
});

// ─── Normalisation ───────────────────────────────────────────────────────────

describe('score normalisation', () => {
  it('scores a pair with nothing known at the prior, not at zero', () => {
    expect(scoreOf(side(), side())).toBe(50);
  });

  it('is symmetric', () => {
    const a = side({
      campus: 'Acme',
      timePreference: 'now',
      area: 'library',
      interests: ['chess'],
      course: 'BTech',
    });
    const b = side({
      campus: 'Acme',
      timePreference: '30min',
      area: 'hostel',
      interests: ['chess', 'film'],
      course: 'BTech',
    });
    expect(scoreOf(a, b)).toBe(scoreOf(b, a));
  });

  it('does not pay out a missing signal at half weight', () => {
    // One perfect signal on two otherwise empty profiles is thin evidence.
    // It has to stay near the prior, or a blank profile that happens to share
    // a campus outranks a filled-in one that agrees on six things.
    const thin = scorePair(side({ campus: 'Acme' }), side({ campus: 'Acme' }), {
      now: NOW,
    });
    const rich = scorePair(
      side({
        campus: 'Acme',
        timePreference: 'now',
        area: 'library',
        interests: ['chess', 'film', 'music'],
        course: 'BTech',
        branch: 'CSE',
        passingYear: 2027,
        optionalDetail: 'physics',
      }),
      side({
        campus: 'Acme',
        timePreference: 'now',
        area: 'library',
        interests: ['chess', 'film', 'music'],
        course: 'BTech',
        branch: 'CSE',
        passingYear: 2027,
        optionalDetail: 'physics',
      }),
      { now: NOW },
    );

    expect(thin.coverage).toBeLessThan(rich.coverage);
    expect(thin.score).toBeLessThan(rich.score);
    expect(thin.observed).toBe(rich.observed); // both agree on everything known
  });

  it('reports coverage so a score can be read with its confidence', () => {
    const none = scorePair(side(), side(), { now: NOW });
    expect(none.coverage).toBe(0);
    expect(none.score).toBe(50);

    const some = scorePair(
      side({ campus: 'Acme', timePreference: 'now' }),
      side({ campus: 'Acme', timePreference: 'now' }),
      { now: NOW },
    );
    expect(some.coverage).toBeGreaterThan(0);
    expect(some.coverage).toBeLessThan(1);
  });

  it('keeps a data-poor agreeing pair below a data-rich agreeing pair', () => {
    const poor = scoreOf(
      side({ campus: 'Acme', timePreference: 'now' }),
      side({ campus: 'Acme', timePreference: 'now' }),
    );
    const richer = scoreOf(
      side({
        campus: 'Acme',
        timePreference: 'now',
        area: 'library',
        interests: ['chess'],
        course: 'BTech',
        branch: 'CSE',
      }),
      side({
        campus: 'Acme',
        timePreference: 'now',
        area: 'library',
        interests: ['chess'],
        course: 'BTech',
        branch: 'CSE',
      }),
    );
    expect(richer).toBeGreaterThan(poor);
  });
});

// ─── Missing, conflicting and hostile data ───────────────────────────────────

describe('imperfect profile data', () => {
  it('survives nulls, wrong types and nonsense numbers', () => {
    const broken = side({
      campus: '   ',
      interests: [null as unknown as string, '', 'Chess'],
      passingYear: Number.NaN,
      latitude: Number.NaN,
      longitude: 77.6,
      optionalDetail: '!!!',
    });
    const result = scorePair(broken, side({ interests: ['chess'] }), {
      now: NOW,
    });
    expect(Number.isFinite(result.score)).toBe(true);
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
  });

  it('treats a signal that throws as a missing one, not as a failed match', () => {
    const hostile = {
      ...side({ campus: 'Acme' }),
      get interests(): string[] {
        throw new Error('corrupt row');
      },
    } as SideContext;

    const result = scorePair(hostile, side({ campus: 'Acme' }), { now: NOW });
    expect(Number.isFinite(result.score)).toBe(true);
    expect(result.signals.find((s) => s.key === 'interests')?.value).toBeNull();
  });

  it('never returns a score outside 0–100, however bad the pairing', () => {
    const worst = scorePair(
      side({
        campus: 'A',
        timePreference: 'now',
        area: 'library',
        latitude: 27,
        longitude: 77,
        interests: ['a'],
        course: 'x',
        branch: 'y',
        passingYear: 2020,
        optionalDetail: 'aaa',
        communityIds: ['c1'],
      }),
      side({
        campus: 'B',
        timePreference: 'today',
        area: 'hostel',
        latitude: 40,
        longitude: 100,
        interests: ['b'],
        course: 'z',
        branch: 'w',
        passingYear: 2030,
        optionalDetail: 'bbb',
        communityIds: ['c9'],
      }),
      {
        now: NOW,
        feedback: feedback({
          declinedByMe: 9,
          declinedByThem: 9,
          expired: 9,
          lastPairedAt: NOW,
        }),
      },
    );
    expect(worst.score).toBeGreaterThanOrEqual(0);
    expect(worst.score).toBeLessThan(50);
  });
});

// ─── Behavioural feedback ────────────────────────────────────────────────────

describe('passes and other negative signals', () => {
  const a = side({
    campus: 'Acme',
    timePreference: 'now',
    interests: ['chess'],
  });
  const b = side({
    campus: 'Acme',
    timePreference: 'now',
    interests: ['chess'],
  });
  const clean = scoreOf(a, b);

  it('drops a candidate this user has passed on', () => {
    const passed = scoreOf(a, b, {
      feedback: feedback({
        declinedByMe: 1,
        lastPairedAt: NOW - 2 * 60 * 60 * 1000,
      }),
    });
    expect(passed).toBeLessThan(clean);
  });

  it('drops them further on every repeat pass', () => {
    const once = scoreOf(a, b, { feedback: feedback({ declinedByMe: 1 }) });
    const twice = scoreOf(a, b, { feedback: feedback({ declinedByMe: 2 }) });
    expect(twice).toBeLessThan(once);
    expect(once).toBeLessThan(clean);
  });

  it('penalises passing on someone more than being passed on', () => {
    const iPassed = scoreOf(a, b, { feedback: feedback({ declinedByMe: 1 }) });
    const theyPassed = scoreOf(a, b, {
      feedback: feedback({ declinedByThem: 1 }),
    });
    expect(iPassed).toBeLessThan(theyPassed);
    expect(theyPassed).toBeLessThan(clean);
  });

  it('treats a timeout as the mildest negative of the three', () => {
    const timedOut = scoreOf(a, b, { feedback: feedback({ expired: 1 }) });
    const theyPassed = scoreOf(a, b, {
      feedback: feedback({ declinedByThem: 1 }),
    });
    expect(timedOut).toBeGreaterThan(theyPassed);
    expect(timedOut).toBeLessThan(clean);
  });

  it('lets the worst signal win when several apply', () => {
    const both = scoreOf(a, b, {
      feedback: feedback({ declinedByMe: 2, expired: 1 }),
    });
    const mildOnly = scoreOf(a, b, { feedback: feedback({ expired: 1 }) });
    expect(both).toBeLessThan(mildOnly);
  });

  it('forgets: a pass outside the window is never read in the first place', () => {
    // The window is enforced by the query that builds the feedback, so an old
    // pass arrives here as no feedback at all — and scores like a stranger.
    expect(scoreOf(a, b, { feedback: null })).toBe(clean);
  });
});

describe('positive signals and repetition', () => {
  const a = side({ campus: 'Acme', timePreference: 'now' });
  const b = side({ campus: 'Acme', timePreference: 'now' });

  it('gives a small lift to a pair who matched once before', () => {
    const stranger = scoreOf(a, b);
    const acquainted = scoreOf(a, b, { feedback: feedback({ accepted: 1 }) });
    expect(acquainted).toBeGreaterThan(stranger);
  });

  it('turns against repetition once they have matched several times', () => {
    // Instant Match exists to widen a circle. A queue that keeps handing back
    // the same person has stopped doing its job.
    const once = scoreOf(a, b, { feedback: feedback({ accepted: 1 }) });
    const thrice = scoreOf(a, b, { feedback: feedback({ accepted: 3 }) });
    expect(thrice).toBeLessThan(once);
    expect(thrice).toBeLessThan(scoreOf(a, b));
  });

  it('lifts a pair who follow each other', () => {
    const plain = scoreOf(a, b);
    const mutual = scoreOf(a, b, {
      social: { following: true, followedBy: true },
    });
    const oneWay = scoreOf(a, b, {
      social: { following: true, followedBy: false },
    });
    expect(mutual).toBeGreaterThan(oneWay);
    expect(oneWay).toBeGreaterThan(plain);
  });

  it('does not punish two strangers for not following each other', () => {
    const noEdges = scorePair(a, b, {
      now: NOW,
      social: { following: false, followedBy: false },
    });
    expect(noEdges.signals.find((s) => s.key === 'network')?.value).toBeNull();
    expect(noEdges.score).toBe(scoreOf(a, b));
  });

  it('lifts a pair who share a community', () => {
    const shared = scoreOf(
      side({ campus: 'Acme', communityIds: ['c1', 'c2'] }),
      side({ campus: 'Acme', communityIds: ['c1'] }),
    );
    const unknown = scoreOf(
      side({ campus: 'Acme', communityIds: ['c1', 'c2'] }),
      side({ campus: 'Acme', communityIds: [] }),
    );
    expect(shared).toBeGreaterThan(unknown);
  });

  it('damps a pairing that was made minutes ago, whatever the outcome', () => {
    const justNow = scoreOf(a, b, {
      feedback: feedback({ lastPairedAt: NOW - 10 * 60 * 1000 }),
    });
    const daysAgo = scoreOf(a, b, {
      feedback: feedback({ lastPairedAt: NOW - 5 * 24 * 60 * 60 * 1000 }),
    });
    const never = scoreOf(a, b);
    expect(justNow).toBeLessThan(daysAgo);
    expect(daysAgo).toBeLessThan(never);
  });
});

describe('the hard skip', () => {
  it('stops offering a pairing after the configured number of passes', () => {
    expect(
      isHardSkipped(
        feedback({
          declinedByMe: FEEDBACK.hardSkipAfterPasses,
          lastPairedAt: NOW,
        }),
        NOW,
      ),
    ).toBe(true);
  });

  it('keeps ranking them below that, rather than hiding them', () => {
    expect(
      isHardSkipped(
        feedback({
          declinedByMe: FEEDBACK.hardSkipAfterPasses - 1,
          lastPairedAt: NOW,
        }),
        NOW,
      ),
    ).toBe(false);
  });

  it('expires — it is a pause, never a permanent exclusion', () => {
    const old = NOW - FEEDBACK.hardSkipMs - 1;
    expect(
      isHardSkipped(feedback({ declinedByMe: 5, lastPairedAt: old }), NOW),
    ).toBe(false);
  });

  it('is not triggered by being passed on, only by passing', () => {
    expect(
      isHardSkipped(feedback({ declinedByThem: 9, lastPairedAt: NOW }), NOW),
    ).toBe(false);
  });
});

// ─── Explanation ─────────────────────────────────────────────────────────────

describe('explanations', () => {
  it('names every signal, its value and the weight it carried', () => {
    const line = explainPair(
      scorePair(
        side({ campus: 'Acme', timePreference: 'now', interests: ['chess'] }),
        side({ campus: 'Acme', timePreference: 'now', interests: ['chess'] }),
        { now: NOW },
      ),
    );
    for (const key of SIGNAL_KEYS) expect(line).toContain(key);
    expect(line).toContain('coverage=');
    expect(line).toContain('observed=');
  });

  it('says what the feedback was, not just that it lowered the score', () => {
    const scored = scorePair(side(), side(), {
      now: NOW,
      feedback: feedback({ declinedByMe: 2, expired: 1 }),
    });
    expect(explainPair(scored)).toContain('passed ×2');
  });
});

// ─── Selection ───────────────────────────────────────────────────────────────

describe('candidate ordering', () => {
  /** An rng that reads from a script and then repeats its last value, so a
   *  test says exactly which draws it is exercising. */
  const scripted = (...values: number[]) => {
    let i = 0;
    return () => values[Math.min(i++, values.length - 1)];
  };

  const cand = (id: string, score: number, joinedAgoMs = 0) => ({
    id,
    score,
    joinedAt: NOW - joinedAgoMs,
  });

  const order = (
    list: ReturnType<typeof cand>[],
    opts: Partial<Parameters<typeof orderCandidates>[1]> = {},
  ) =>
    orderCandidates(list, {
      searcherJoinedAt: NOW,
      now: NOW,
      rng: () => 0,
      ...opts,
    }).map((o) => o.item.id);

  it('drops everyone below the threshold', () => {
    const out = order([cand('good', 80), cand('poor', 10)]);
    expect(out).toEqual(['good']);
  });

  it('relaxes that threshold as the wait grows', () => {
    const poor = [cand('poor', 10)];
    expect(order(poor)).toEqual([]);
    expect(order(poor, { searcherJoinedAt: NOW - 5 * 60 * 1000 })).toEqual([
      'poor',
    ]);
  });

  it('is pure score order when asked to be deterministic', () => {
    const out = order([cand('b', 70), cand('a', 90), cand('c', 80)], {
      deterministic: true,
    });
    expect(out).toEqual(['a', 'c', 'b']);
  });

  it('breaks a tie toward whoever has waited longest', () => {
    const out = order(
      [cand('fresh', 80, 0), cand('waiting', 80, 5 * 60 * 1000)],
      { deterministic: true },
    );
    expect(out[0]).toBe('waiting');
  });

  it('returns every eligible candidate exactly once', () => {
    const list = [
      cand('a', 90),
      cand('b', 88),
      cand('c', 80),
      cand('d', 79),
      cand('e', 66),
    ];
    const out = order(list, { rng: scripted(0.5, 0.9, 0.1, 0.4, 0.7) });
    expect([...out].sort()).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('can put a close second first — the tie band is a band, not an order', () => {
    // Two candidates a point apart are not meaningfully different, and always
    // resolving that the same way is how one person ends up being shown to
    // everybody. A flat rng per run, rather than a script, so this asserts the
    // outcome rather than the order the draws happen to be consumed in.
    const list = [cand('lead', 90, 0), cand('near', 89, 10 * 60 * 1000)];
    const seen = new Set<string>();
    for (const r of [0.05, 0.2, 0.9, 0.99]) {
      seen.add(order(list, { rng: () => r })[0]);
    }
    expect(seen.size).toBeGreaterThan(1);
    // …and the longer wait is still favoured, which is what keeps it fair.
    expect(order(list, { rng: () => 0.9 })[0]).toBe('near');
    expect(order(list, { rng: () => 0.05 })[0]).toBe('lead');
  });

  it('never lets a distant candidate jump the leader without exploring', () => {
    // rng ≥ exploreRate on the first draw = no exploration this round.
    const out = order([cand('lead', 95), cand('far', 65)], {
      rng: scripted(0.9),
    });
    expect(out[0]).toBe('lead');
  });

  it('surfaces a promising outsider when the exploration draw fires', () => {
    const out = orderCandidates([cand('lead', 90), cand('outsider', 80)], {
      searcherJoinedAt: NOW,
      now: NOW,
      // Below exploreRate on the first call: explore. Then pick index 0 of
      // the explore pool.
      rng: scripted(SELECTION.exploreRate / 2, 0),
    });
    expect(out[0].item.id).toBe('outsider');
    expect(out[0].picked).toBe('explore');
    expect(out[1].item.id).toBe('lead');
  });

  it('does not explore past the band — a long shot is still a plausible match', () => {
    const out = orderCandidates(
      [
        cand('lead', 95),
        cand('hopeless', 95 - SELECTION.exploreBandPoints - 5),
      ],
      {
        searcherJoinedAt: NOW - 5 * 60 * 1000,
        now: NOW,
        rng: scripted(SELECTION.exploreRate / 2, 0),
      },
    );
    expect(out[0].item.id).toBe('lead');
    expect(out.every((o) => o.picked === 'lead')).toBe(true);
  });

  it('an rng pinned to zero reproduces the deterministic order exactly', () => {
    const list = [cand('a', 90), cand('b', 88, 60_000), cand('c', 70)];
    expect(order(list, { rng: () => 0 })).toEqual(
      order(list, { deterministic: true }),
    );
  });

  it('handles an empty queue', () => {
    expect(order([])).toEqual([]);
  });

  it('sets the bar from whoever has waited longer', () => {
    const fresh = thresholdFor(NOW, NOW, NOW);
    const patient = thresholdFor(NOW - 3 * 60 * 1000, NOW, NOW);
    expect(patient).toBeLessThan(fresh);
    expect(relaxedThreshold(0)).toBe(fresh);
  });
});

// ─── Filter bubbles ──────────────────────────────────────────────────────────

describe('filter bubbles', () => {
  it('stops the same partner being the top suggestion forever', () => {
    // The same two profiles, ranked repeatedly. Each pass and each recent
    // pairing pushes the incumbent down, so a third party overtakes them
    // without anyone being excluded.
    const me = side({
      campus: 'Acme',
      timePreference: 'now',
      interests: ['chess', 'film'],
    });
    const incumbent = side({
      campus: 'Acme',
      timePreference: 'now',
      interests: ['chess', 'film'],
    });
    const newcomer = side({
      campus: 'Acme',
      timePreference: 'now',
      interests: ['chess'],
    });

    const incumbentFirst = scoreOf(me, incumbent);
    const newcomerScore = scoreOf(me, newcomer);
    expect(incumbentFirst).toBeGreaterThan(newcomerScore);

    const afterTwoPasses = scoreOf(me, incumbent, {
      feedback: feedback({
        declinedByMe: 2,
        lastPairedAt: NOW - 30 * 60 * 1000,
      }),
    });
    expect(afterTwoPasses).toBeLessThan(newcomerScore);
  });
});
