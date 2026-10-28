/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { findKeyboardSheet, riseSheet, sheetSlide } from '../keyboardSheetRise';

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

describe('sheetSlide', () => {
  it('a bottom sheet that only moves is followed by its edges, with nothing to fill', () => {
    expect(sheetSlide({ top: 500, bottom: 800 }, { top: 300, bottom: 600 }, 800)).toEqual({ travel: 200, extend: 0 });
  });

  it('a bottom sheet shortened to fit above the keyboard follows its top edge, its colour filling down to the keyboard', () => {
    // Measured on the I2208: rest 193-876, above a 328px keyboard 48-548.
    expect(sheetSlide({ top: 193, bottom: 876 }, { top: 48, bottom: 548 }, 875)).toEqual({ travel: 145, extend: 183 });
  });

  it('closing glides the top edge back down; the longer sheet grows behind the keyboard', () => {
    expect(sheetSlide({ top: 48, bottom: 548 }, { top: 193, bottom: 876 }, 875)).toEqual({ travel: -145, extend: 0 });
  });

  it('follows the middle of a centred dialog', () => {
    expect(sheetSlide({ top: 300, bottom: 500 }, { top: 200, bottom: 400 }, 800)).toEqual({ travel: 100, extend: 0 });
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
    expect(riseSheet(el, { travel: 280 }, { duration: 250, delay: -40 })).toBe(true);
    const [frames, options] = el.animate.mock.calls[0];
    expect(frames.translate).toEqual(['0 280px', '0 0']);
    expect(options).toMatchObject({ duration: 250, delay: -40 });
    expect(el.style.boxShadow).toBe('');
  });

  it('fills below a shortened sheet in its own colour for the slide, then puts its shadow back', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: false }));
    const el = sheet();
    const animation = {};
    el.animate = vi.fn(() => animation);
    el.style.backgroundColor = 'rgb(255, 255, 255)';
    el.style.boxShadow = 'rgba(0, 0, 0, 0.12) 0px -8px 32px 0px';
    document.body.appendChild(el);
    riseSheet(el, { travel: 145, extend: 183 }, { duration: 285, delay: -30 });
    expect(el.style.boxShadow).toBe('rgba(0, 0, 0, 0.12) 0px -8px 32px 0px, 0 183px 0 0 rgb(255, 255, 255)');
    animation.onfinish();
    expect(el.style.boxShadow).toBe('rgba(0, 0, 0, 0.12) 0px -8px 32px 0px');
  });

  it('fills nothing for a sheet with no colour of its own', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: false }));
    const el = sheet();
    document.body.appendChild(el);
    riseSheet(el, { travel: 145, extend: 183 }, { duration: 285 });
    expect(el.style.boxShadow).toBe('');
  });

  it('does nothing for a sheet that did not move, a jump, or reduced motion', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: false }));
    const el = sheet();
    expect(riseSheet(el, { travel: 0.5 }, { duration: 250 })).toBe(false);
    expect(riseSheet(el, { travel: 280 }, { duration: 0 })).toBe(false);
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    expect(riseSheet(el, { travel: 280 }, { duration: 250 })).toBe(false);
    expect(el.animate).not.toHaveBeenCalled();
  });
});
