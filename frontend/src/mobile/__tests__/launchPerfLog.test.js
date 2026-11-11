import { describe, it, expect } from 'vitest';
import { collectLaunchPerf, launchPerfEnabled, recordLaunchPerf } from '../launchPerfLog';

const fakePerf = {
  getEntriesByType: (type) => ({
    navigation: [{ responseEnd: 24.4, domInteractive: 310, domContentLoadedEventEnd: 478 }],
    paint: [{ name: 'first-contentful-paint', startTime: 700 }],
    mark: [
      { name: 'meetifyy:home-painted', startTime: 760.6 },
      { name: 'meetifyy:auth-decided', startTime: 650 },
      { name: 'someone-else', startTime: 5 },
    ],
  })[type] || [],
};

describe('launch perf log', () => {
  it('is off unless the flag is set', () => {
    expect(launchPerfEnabled({ getItem: () => null })).toBe(false);
    expect(launchPerfEnabled({ getItem: () => '1' })).toBe(true);
    expect(launchPerfEnabled({ getItem: () => { throw new Error('blocked'); } })).toBe(false);
    const target = {};
    expect(recordLaunchPerf({ enabled: false, target })).toBeNull();
    expect(target.__meetifyyPerf).toBeUndefined();
  });

  it('lists the launch in order, in whole milliseconds, with only the app\'s own marks', () => {
    const entries = collectLaunchPerf(fakePerf);
    expect(entries.map((e) => e.name)).toEqual([
      'response end',
      'dom interactive (entry script evaluated)',
      'dom content loaded',
      'auth-decided',
      'first-contentful-paint',
      'home-painted',
    ]);
    expect(entries.at(-1).at).toBe(761);
  });
});
