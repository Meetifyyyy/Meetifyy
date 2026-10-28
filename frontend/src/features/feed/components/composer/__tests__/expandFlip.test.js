/** @vitest-environment jsdom */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { cubicBezier, playFlip } from '../useExpandFlip';

/**
 * The composer's expand/collapse draws the card's edge (a clip) and the content
 * after it (a slide) together. They were two animations, the clip on the main
 * thread and the slide on the compositor, so a busy main thread let the content
 * run into the card: "Find your communities" closed the gap under the composer
 * and the edge then jumped shut. Here both are written by one frame loop; jsdom
 * has no layout, so positions are stubbed and frames are stepped by hand.
 */
let frames;
let now;
beforeEach(() => {
  frames = [];
  now = 0;
  vi.stubGlobal('requestAnimationFrame', (cb) => frames.push(cb));
  vi.stubGlobal('cancelAnimationFrame', () => { frames = []; });
});
afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

/** Runs the pending frame at `ms` after the animation's first frame. */
const step = (ms) => {
  now = ms;
  const pending = frames;
  frames = [];
  pending.forEach((cb) => cb(now));
};

function feed() {
  document.body.innerHTML = `
    <div id="feed">
      <div id="anchor"><span id="shadow"></span><div id="card"></div></div>
      <a id="communities"></a>
      <article id="post"></article>
      <nav id="fixed" style="position: fixed"></nav>
    </div>`;
  const top = { anchor: 0, communities: 130, post: 300, fixed: 600 };
  Object.entries(top).forEach(([id, y]) => {
    document.getElementById(id).getBoundingClientRect = () => ({ top: y, bottom: y + 100 });
  });
  const $ = (id) => document.getElementById(id);
  return { card: $('card'), anchor: $('anchor'), shadow: $('shadow'), moved: [$('communities'), $('post'), $('shadow')], fixed: $('fixed') };
}

const clipOf = (card) => Number(/inset\(0px 0px ([\d.]+)px/.exec(card.style.clipPath)?.[1]);
const slideOf = (el) => Number(/^0px (-?[\d.]+)px$/.exec(el.style.translate)?.[1]);

describe('the composer collapse', () => {
  it('moves the content after the card by exactly what the clip closes, in every frame', async () => {
    const { card, anchor, shadow, moved, fixed } = feed();
    const flip = playFlip(card, anchor, 52, true, shadow);
    const seen = [];
    for (const ms of [0, 40, 90, 140, 200, 280]) {
      step(ms);
      const closed = clipOf(card);
      seen.push(closed);
      moved.forEach((el) => expect(slideOf(el)).toBeCloseTo(-closed, 5));
    }
    expect(seen[0]).toBe(0);
    expect(seen.at(-1)).toBe(52);
    expect(seen).toEqual([...seen].sort((a, b) => a - b));
    // Out of the flow, so it never moved.
    expect(fixed.style.translate).toBeFalsy();
    await expect(flip.finished).resolves.toBe(true);
  });

  it('holds the shut frame until the collapsed layout commits, then puts back what was inline', () => {
    const { card, anchor, shadow, moved } = feed();
    moved[1].style.willChange = 'opacity';
    const flip = playFlip(card, anchor, 52, true, shadow);
    step(0);
    step(400);
    expect(clipOf(card)).toBe(52);
    expect(moved[0].style.willChange).toBe('transform');
    flip.cancel();
    expect(card.style.clipPath).toBeFalsy();
    expect(moved[0].style.translate).toBeFalsy();
    expect(moved[0].style.willChange).toBeFalsy();
    expect(moved[1].style.willChange).toBe('opacity');
  });

  it('reports a collapse cancelled by a re-expand as not finished', async () => {
    const { card, anchor, shadow } = feed();
    const flip = playFlip(card, anchor, 52, true, shadow);
    step(0);
    flip.cancel();
    await expect(flip.finished).resolves.toBe(false);
  });
});

describe('the composer expand', () => {
  it('is clipped shut before its first paint, and leaves nothing inline when done', async () => {
    const { card, anchor, shadow, moved } = feed();
    const flip = playFlip(card, anchor, 52, false, shadow);
    // Drawn at once, not on the next frame: the full height never shows unclipped.
    expect(clipOf(card)).toBe(52);
    moved.forEach((el) => expect(slideOf(el)).toBe(-52));
    step(0);
    step(140);
    const midway = clipOf(card);
    expect(midway).toBeGreaterThan(0);
    expect(midway).toBeLessThan(52);
    moved.forEach((el) => expect(slideOf(el)).toBeCloseTo(-midway, 5));
    step(280);
    expect(card.style.clipPath).toBeFalsy();
    moved.forEach((el) => expect(el.style.translate).toBeFalsy());
    await expect(flip.finished).resolves.toBe(true);
  });
});

describe('cubicBezier', () => {
  it('runs from 0 to 1 without stepping back, front-loaded like cubic-bezier(0.2, 0, 0, 1)', () => {
    const ease = cubicBezier(0.2, 0, 0, 1);
    const values = Array.from({ length: 21 }, (_, i) => ease(i / 20));
    expect(values[0]).toBe(0);
    expect(values[20]).toBe(1);
    values.slice(1).forEach((v, i) => expect(v).toBeGreaterThanOrEqual(values[i]));
    expect(ease(0.5)).toBeGreaterThan(0.85);
  });
});
