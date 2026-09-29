import { describe, it, expect, vi } from 'vitest';

const platform = { current: 'android' };
const setStyle = vi.fn(async () => {});
const setColors = vi.fn(async () => {});
const setIcons = vi.fn(async () => {});
const getInsets = vi.fn(async () => ({ top: 32, bottom: 48 }));

vi.mock('@capacitor/core', () => ({
  Capacitor: { getPlatform: () => platform.current },
  registerPlugin: () => ({ setColors, setIcons, getInsets }),
  SystemBars: { setStyle },
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
   * The two values --color-nav-surface actually takes. Pure black and pure
   * white are the extremes, so getting either wrong means the status bar
   * clock is invisible against its own background.
   */
  it('handles the chrome surface at both ends', () => {
    expect(needsLightIcons('#000000')).toBe(true);
    expect(needsLightIcons('#FFFFFF')).toBe(false);
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

  /**
   * Android's eight-digit form is #AARRGGBB, so the first pair is opacity.
   * Reading it as red shifts every channel by one, which is how a fully
   * transparent white used to be measured as cyan.
   */
  it('skips the alpha pair in the eight-digit form', () => {
    expect(needsLightIcons('#FF202020')).toBe(true);
    expect(needsLightIcons('#FFFFFFFF')).toBe(false);
  });

  /**
   * The values the open screen sets while it runs edge to edge. The bar is
   * see-through, so the RGB half is all that is left to say whether the clock
   * should be drawn light or dark.
   */
  it('reads the theme out of a fully transparent bar colour', () => {
    expect(needsLightIcons('#00FFFFFF')).toBe(false); // light theme, dark icons
    expect(needsLightIcons('#00000000')).toBe(true); // dark theme, light icons
  });

  it('never claims light icons for a colour it cannot read', () => {
    expect(needsLightIcons('nonsense')).toBe(false);
  });
});

describe('createCapacitorSystemBars', () => {
  /**
   * The bars are painted by the page; the native side only sets which way the
   * icons are drawn. Nothing here may carry a bar colour any more — a colour
   * sent natively is a second painter that has to be kept in step with the page.
   */
  it('sends only the icon appearance to the native side', async () => {
    setIcons.mockClear();
    const bars = createCapacitorSystemBars({ getComputed: () => '#ffffff' });
    await bars.setIcons({ status: false, navigation: true });
    expect(setIcons).toHaveBeenCalledWith({ statusLightIcons: false, navLightIcons: true });
  });

  it('makes no bridge call when the icons have not changed', async () => {
    setIcons.mockClear();
    const bars = createCapacitorSystemBars({ getComputed: () => '#ffffff' });
    await bars.setIcons({ status: true, navigation: true });
    await bars.setIcons({ status: true, navigation: true });
    expect(setIcons).toHaveBeenCalledTimes(1);
    await bars.setIcons({ status: false, navigation: true });
    expect(setIcons).toHaveBeenCalledTimes(2);
  });

  it('persists the theme, not a bar colour', async () => {
    setColors.mockClear();
    const bars = createCapacitorSystemBars({ getComputed: () => '#000000' });
    await bars.persistTheme({ force: true });
    expect(setColors).toHaveBeenCalledWith({
      background: '#000000',
      lightIcons: true,
      theme: 'light',
      preferenceSet: false,
    });
    const sent = setColors.mock.calls[0][0];
    expect(sent).not.toHaveProperty('statusBackground');
    expect(sent).not.toHaveProperty('navBackground');
  });

  it('does nothing when the colour cannot be resolved', async () => {
    // A variable read before the stylesheets load returns ''. Pushing that
    // would reject in the plugin, or worse, paint the window black.
    setColors.mockClear();
    const bars = createCapacitorSystemBars({ getComputed: () => '' });
    await expect(bars.persistTheme()).resolves.toBeUndefined();
    expect(setColors).not.toHaveBeenCalled();
  });

  it('survives a platform where the plugin does not exist', async () => {
    setIcons.mockRejectedValue(new Error('not implemented'));
    const bars = createCapacitorSystemBars({ getComputed: () => '#202020' });
    await expect(bars.setIcons({ status: true, navigation: true })).resolves.toBeUndefined();
    setIcons.mockResolvedValue(undefined);
  }, 5000);

  it('reads the bars\' heights from the native side', async () => {
    const bars = createCapacitorSystemBars({ getComputed: () => '#ffffff' });
    await expect(bars.getInsets()).resolves.toEqual({ top: 32, bottom: 48 });
  });

  it('leaves the Android bars to SystemUi: Capacitor setStyle repaints them', async () => {
    setStyle.mockClear();
    platform.current = 'android';
    await createCapacitorSystemBars({ getComputed: () => '#ffffff' }).setIcons({ status: false, navigation: false });
    expect(setStyle).not.toHaveBeenCalled();

    platform.current = 'ios';
    await createCapacitorSystemBars({ getComputed: () => '#ffffff' }).setIcons({ status: false, navigation: false });
    expect(setStyle).toHaveBeenCalled();
  });
});
