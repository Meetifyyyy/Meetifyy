import { describe, it, expect, vi } from 'vitest';

vi.mock('@capacitor/core', () => ({
  registerPlugin: () => ({ setColors: vi.fn(async () => {}) }),
  SystemBars: { setStyle: vi.fn(async () => {}) },
  SystemBarsStyle: { Dark: 'DARK', Light: 'LIGHT', Default: 'DEFAULT' },
}));

const { toHexColor, needsLightIcons, createCapacitorSystemBars } = await import(
  '../systemBars'
);

describe('toHexColor', () => {
  /**
   * `getComputedStyle` returns whatever the stylesheet wrote, and browsers
   * normalise hex to `rgb()`. Android's Color.parseColor reads hex and named
   * colours only, so an un-converted `rgb()` string is rejected by the plugin
   * and the bars silently keep the wrong colour.
   */
  it('converts the rgb() form a browser returns', () => {
    expect(toHexColor('rgb(32, 32, 32)')).toBe('#202020');
    expect(toHexColor('rgba(255, 255, 255, 1)')).toBe('#ffffff');
  });

  it('passes six- and eight-digit hex through', () => {
    expect(toHexColor('#202020')).toBe('#202020');
    expect(toHexColor('#FF202020')).toBe('#FF202020');
  });

  it('expands the three-digit form Android cannot read', () => {
    expect(toHexColor('#abc')).toBe('#aabbcc');
  });

  it('tolerates the whitespace getPropertyValue leaves behind', () => {
    expect(toHexColor('  #202020  ')).toBe('#202020');
  });

  it.each([
    ['a named colour', 'rebeccapurple'],
    ['a CSS variable that did not resolve', 'var(--color-bg-white)'],
    ['an empty string', ''],
    ['undefined', undefined],
  ])('returns null for %s rather than guessing', (_label, input) => {
    expect(toHexColor(input)).toBeNull();
  });
});

describe('needsLightIcons', () => {
  it('asks for light icons on a dark surface', () => {
    expect(needsLightIcons('#202020')).toBe(true);
    expect(needsLightIcons('#121212')).toBe(true);
  });

  it('asks for dark icons on a light surface', () => {
    expect(needsLightIcons('#FFFFFF')).toBe(false);
    expect(needsLightIcons('#FDFDFD')).toBe(false);
  });

  /**
   * Luminance, not a channel average. Averaging calls a saturated blue light
   * when the eye reads it as dark, and the bar icons come out invisible
   * against it.
   */
  it('weights the channels by perceived brightness', () => {
    expect(needsLightIcons('#2563eb')).toBe(true); // the brand blue reads dark
    expect(needsLightIcons('#00ff00')).toBe(false); // green reads light
    expect(needsLightIcons('#0000ff')).toBe(true); // blue reads dark
  });

  it('never claims light icons for a colour it cannot read', () => {
    expect(needsLightIcons('nonsense')).toBe(false);
  });
});

describe('createCapacitorSystemBars', () => {
  it('does nothing when the colour cannot be resolved', async () => {
    // A variable read before the stylesheets load returns ''. Pushing that
    // would reject in the plugin, or worse, paint the bars black.
    const bars = createCapacitorSystemBars({ getComputed: () => '' });
    await expect(bars.apply()).resolves.toBeUndefined();
  });

  it('survives a platform where neither plugin exists', async () => {
    const bars = createCapacitorSystemBars({ getComputed: () => '#202020' });
    await expect(bars.apply()).resolves.toBeUndefined();
  });
});
