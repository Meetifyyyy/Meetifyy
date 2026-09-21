import { describe, it, expect } from 'vitest';

import { resolveInitialTheme, shouldFollowSystem } from '../resolveTheme';

describe('resolveInitialTheme', () => {
  describe('with no explicit choice, it follows the device', () => {
    it('opens dark on a dark device', () => {
      expect(resolveInitialTheme({ prefersDark: true })).toBe('dark');
    });

    it('opens light on a light device', () => {
      expect(resolveInitialTheme({ prefersDark: false })).toBe('light');
    });

    /**
     * The regression this exists for. `localStorage.theme` is written on every
     * theme change, including the ones this function causes, so it is present
     * from the first render whether or not anyone chose it. Honouring it
     * without the flag would follow the device exactly once and then freeze.
     */
    it('ignores a stored value that nobody chose', () => {
      expect(
        resolveInitialTheme({ stored: 'light', preferenceSet: false, prefersDark: true }),
      ).toBe('dark');
    });
  });

  describe('an explicit choice wins', () => {
    it('keeps light on a dark device', () => {
      expect(
        resolveInitialTheme({ stored: 'light', preferenceSet: true, prefersDark: true }),
      ).toBe('light');
    });

    it('keeps dark on a light device', () => {
      expect(
        resolveInitialTheme({ stored: 'dark', preferenceSet: true, prefersDark: false }),
      ).toBe('dark');
    });
  });

  describe('it never returns anything but a real theme', () => {
    it.each([
      ['a corrupt stored value', { stored: 'purple', preferenceSet: true, prefersDark: true }],
      ['an empty stored value', { stored: '', preferenceSet: true, prefersDark: false }],
      ['nothing at all', {}],
      ['undefined', undefined],
    ])('falls back to the device for %s', (_label, args) => {
      expect(['light', 'dark']).toContain(resolveInitialTheme(args));
    });
  });
});

describe('shouldFollowSystem', () => {
  it('follows the device until the user chooses', () => {
    expect(shouldFollowSystem({ preferenceSet: false })).toBe(true);
    expect(shouldFollowSystem({})).toBe(true);
  });

  /**
   * Someone who picked light on a dark phone meant it. Having the OS overrule
   * them at sunset is the bug this prevents.
   */
  it('stops following once they have', () => {
    expect(shouldFollowSystem({ preferenceSet: true })).toBe(false);
  });
});
