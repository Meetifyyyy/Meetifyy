/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { findKeyboardSheet, riseSheet, sheetTravel } from '../keyboardSheetRise';

const rect = (top, bottom, width = 360, height = bottom - top) => ({ top, bottom, width, height, left: 0, right: width });

afterEach(() => {
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

describe('findKeyboardSheet', () => {
  const mount = (html) => {
    document.body.innerHTML = html;
    return document.getElementById('f');
  };

  it('finds the sheet inside a full-screen scrim', () => {
    const field = mount('<div id="scrim" style="position:fixed"><div id="sheet"><form><input id="f"></form></div></div>');
    vi.spyOn(document.getElementById('scrim'), 'getBoundingClientRect').mockReturnValue(rect(0, window.innerHeight, window.innerWidth));
    expect(findKeyboardSheet(field).id).toBe('sheet');
  });

  it('is the fixed element itself when that is not full screen', () => {
    const field = mount('<div id="sheet" style="position:fixed"><input id="f"></div>');
    vi.spyOn(document.getElementById('sheet'), 'getBoundingClientRect').mockReturnValue(rect(400, 700, 360));
    expect(findKeyboardSheet(field).id).toBe('sheet');
  });

  it('ignores a field that is not in an overlay', () => {
    expect(findKeyboardSheet(mount('<main><input id="f"></main>'))).toBeNull();
  });

  it('leaves a composer that rises by its own transform alone', () => {
    const field = mount('<div style="position:fixed" data-keyboard-dock><input id="f"></div>');
    expect(findKeyboardSheet(field)).toBeNull();
  });
});

describe('sheetTravel', () => {
  it('follows the bottom edge of a sheet standing on the bottom of the screen', () => {
    expect(sheetTravel({ top: 500, bottom: 800 }, { top: 300, bottom: 500 }, 800)).toBe(300);
  });

  it('follows the middle of a centred dialog', () => {
    expect(sheetTravel({ top: 300, bottom: 500 }, { top: 200, bottom: 400 }, 800)).toBe(100);
  });
});

describe('riseSheet', () => {
  const sheet = () => {
    const el = document.createElement('div');
    el.animate = vi.fn(() => ({}));
    return el;
  };

  it('slides from where layout left the sheet, on the keyboard timing', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: false }));
    const el = sheet();
    expect(riseSheet(el, 280, { duration: 250, delay: -40 })).toBe(true);
    const [frames, options] = el.animate.mock.calls[0];
    expect(frames.translate).toEqual(['0 280px', '0 0']);
    expect(options).toMatchObject({ duration: 250, delay: -40 });
  });

  it('does nothing for a sheet that did not move, a jump, or reduced motion', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: false }));
    const el = sheet();
    expect(riseSheet(el, 0.5, { duration: 250 })).toBe(false);
    expect(riseSheet(el, 280, { duration: 0 })).toBe(false);
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    expect(riseSheet(el, 280, { duration: 250 })).toBe(false);
    expect(el.animate).not.toHaveBeenCalled();
  });
});
