import { describe, it, expect } from 'vitest';
import {
  nextChromeState, TOP_ZONE_PX, JITTER_PX, HIDE_AFTER_PX, MIN_SCROLLABLE_PX,
} from '../useAutoHideChrome';

/**
 * The rules behind the auto-hiding mobile chrome.
 *
 * Almost all of "intelligently" is about not flapping: a nav bar that
 * disappears and reappears while a thumb rests on the screen is far worse
 * than one that never moves.
 */
const TALL = 5000;
const start = (over = {}) => ({ lastY: 0, downTravel: 0, hidden: false, ...over });
const scrollTo = (state, y, scrollable = TALL) => nextChromeState(state, { y, scrollable });
/** The same move, but with the soft keyboard up. */
const scrollToWithKeyboard = (state, y, scrollable = TALL) =>
  nextChromeState(state, { y, scrollable, keyboardOpen: true });

/** Walk down the page in realistic increments. */
const scrollDownBy = (state, px, from = 200) => scrollTo(state, from + px);

describe('nextChromeState', () => {
  describe('at the top of the page', () => {
    it('always shows, however the user got there', () => {
      const hidden = start({ lastY: 400, hidden: true, downTravel: 200 });
      expect(scrollTo(hidden, 10).hidden).toBe(false);
    });

    it('shows anywhere inside the top zone', () => {
      const hidden = start({ lastY: 400, hidden: true });
      expect(scrollTo(hidden, TOP_ZONE_PX - 1).hidden).toBe(false);
    });

    it('resets accumulated travel, so leaving the top starts fresh', () => {
      const s = scrollTo(start({ lastY: 400, downTravel: 60 }), 20);
      expect(s.downTravel).toBe(0);
    });
  });

  describe('jitter', () => {
    it('ignores movement below the threshold entirely', () => {
      const s = start({ lastY: 300 });
      const after = scrollTo(s, 300 + JITTER_PX - 1);
      expect(after).toBe(s);   // same object: nothing moved at all
    });

    it('does not lose slow drift, because lastY is not advanced', () => {
      // Three sub-threshold nudges then a real one still measures from 300,
      // rather than resetting the baseline each time and never accumulating.
      let s = start({ lastY: 300 });
      s = scrollTo(s, 302); s = scrollTo(s, 304); s = scrollTo(s, 305);
      expect(s.lastY).toBe(300);
    });
  });

  describe('hiding', () => {
    it('does not hide on a small downward nudge', () => {
      expect(scrollDownBy(start({ lastY: 200 }), HIDE_AFTER_PX - 10).hidden).toBe(false);
    });

    it('hides once downward travel is sustained', () => {
      expect(scrollDownBy(start({ lastY: 200 }), HIDE_AFTER_PX + 1).hidden).toBe(true);
    });

    it('accumulates travel across several scrolls', () => {
      // A slow, continuous scroll should still eventually hide.
      let s = start({ lastY: 200 });
      for (let y = 220; y <= 300; y += 20) s = scrollTo(s, y);
      expect(s.hidden).toBe(true);
    });
  });

  describe('revealing', () => {
    it('reveals on the first real upward movement', () => {
      // No threshold: asking for the nav back is explicit intent.
      const hidden = start({ lastY: 800, hidden: true, downTravel: 300 });
      expect(scrollTo(hidden, 800 - JITTER_PX - 1).hidden).toBe(false);
    });

    it('clears travel so a flick up then down does not hide instantly', () => {
      const hidden = start({ lastY: 800, hidden: true, downTravel: 300 });
      const revealed = scrollTo(hidden, 700);
      expect(revealed.downTravel).toBe(0);
      expect(scrollDownBy(revealed, 10, 700).hidden).toBe(false);
    });
  });

  describe('a page with nowhere to scroll', () => {
    it('never hides', () => {
      // Otherwise the nav disappears with no way to bring it back.
      const s = scrollTo(start({ lastY: 200 }), 400, MIN_SCROLLABLE_PX - 1);
      expect(s.hidden).toBe(false);
    });

    it('reveals again if it was already hidden when content shrank', () => {
      const hidden = start({ lastY: 400, hidden: true });
      expect(scrollTo(hidden, 500, 50).hidden).toBe(false);
    });
  });

  describe('while the soft keyboard is open', () => {
    /*
     * Opening the keyboard shrinks the layout viewport and makes the browser
     * scroll the focused field into view. That arrives here as one large
     * delta — well past the hide threshold — so the chrome hid; then the
     * keyboard settled, the counter-scroll read as an upward flick, and it
     * revealed again. The bottom nav flickering in and out while the keyboard
     * animated, most visibly when writing a comment on a post.
     */
    it('does not hide, however far the viewport jumps', () => {
      const jumped = scrollToWithKeyboard(start({ lastY: 200 }), 200 + HIDE_AFTER_PX * 4);
      expect(jumped.hidden).toBe(false);
      expect(jumped.downTravel).toBe(0);
    });

    it('reveals chrome that was already hidden when the field was tapped', () => {
      // Otherwise the nav animates up from off-screen to sit behind the
      // keyboard, which is the flicker seen from the other direction.
      const hiddenState = start({ lastY: 400, hidden: true, downTravel: HIDE_AFTER_PX });
      expect(scrollToWithKeyboard(hiddenState, 420).hidden).toBe(false);
    });

    it('adopts the scrolled-to position, so closing does not replay the jump', () => {
      // `lastY` must advance even though nothing else does. Left behind, the
      // first real scroll after dismissal would measure its delta against a
      // pre-keyboard position and hide instantly.
      const after = scrollToWithKeyboard(start({ lastY: 200 }), 900);
      expect(after.lastY).toBe(900);

      const resumed = scrollTo(after, 905);
      expect(resumed.hidden).toBe(false);
      expect(resumed.downTravel).toBe(0);
    });

    it('resumes normal hiding once the keyboard is gone', () => {
      const typed = scrollToWithKeyboard(start({ lastY: 200 }), 600);
      const scrolled = scrollTo(typed, 600 + HIDE_AFTER_PX + JITTER_PX);
      expect(scrolled.hidden).toBe(true);
    });

    it('is ignored on a page with nowhere to scroll, same as always', () => {
      expect(scrollToWithKeyboard(start({ lastY: 200 }), 900, 0).hidden).toBe(false);
    });
  });

  it('is stable: repeating the same position changes nothing', () => {
    const s = scrollTo(start({ lastY: 200 }), 400);
    expect(scrollTo(s, 400)).toBe(s);
  });
});
