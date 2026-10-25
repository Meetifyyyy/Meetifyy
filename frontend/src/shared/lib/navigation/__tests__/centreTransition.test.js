/** @vitest-environment jsdom */
import { afterEach, describe, expect, it } from 'vitest';
import { PAGE_FADE_EARLY, measureFadeEarly } from '../centreTransition';

describe('measureFadeEarly', () => {
  /** Puts an element on screen where `box` says (jsdom has no layout of its own). */
  const place = (attrs, box) => {
    const el = document.createElement('button');
    for (const [name, value] of Object.entries(attrs)) el.setAttribute(name, value);
    el.getBoundingClientRect = () => ({
      left: box.x, top: box.y, right: box.x + box.width, bottom: box.y + box.height, ...box,
    });
    document.body.append(el);
    return el;
  };
  afterEach(() => { document.body.replaceChildren(); });

  it('is the spread that marks an element', () => {
    expect(PAGE_FADE_EARLY).toEqual({ 'data-page-fade-early': '' });
  });

  it('reports each marked element on screen, in CSS px from the window\'s top left', () => {
    place(PAGE_FADE_EARLY, { x: 12, y: 640, width: 70, height: 36 });
    place(PAGE_FADE_EARLY, { x: 100, y: 640, width: 70, height: 36 });
    place({}, { x: 0, y: 0, width: 300, height: 40 });
    expect(measureFadeEarly()).toEqual([
      { x: 12, y: 640, width: 70, height: 36 },
      { x: 100, y: 640, width: 70, height: 36 },
    ]);
  });

  it('leaves out elements that are empty or not on screen', () => {
    const { innerWidth, innerHeight } = window;
    place(PAGE_FADE_EARLY, { x: 0, y: 0, width: 0, height: 30 });
    place(PAGE_FADE_EARLY, { x: 0, y: -80, width: 50, height: 30 });
    place(PAGE_FADE_EARLY, { x: 0, y: innerHeight + 5, width: 50, height: 30 });
    place(PAGE_FADE_EARLY, { x: innerWidth + 5, y: 10, width: 50, height: 30 });
    expect(measureFadeEarly()).toEqual([]);
  });

  it('takes the first few of a page that marks too many', () => {
    for (let i = 0; i < 30; i += 1) place(PAGE_FADE_EARLY, { x: i, y: 10, width: 10, height: 10 });
    expect(measureFadeEarly()).toHaveLength(16);
  });
});
