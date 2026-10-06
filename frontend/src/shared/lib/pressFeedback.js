/**
 * Press feedback for tappable controls, one implementation for the whole app.
 *
 * WHY NOT CSS
 * This used to be a global `:active { transform: scale(.96) }`. It could not be
 * smooth: a transition belongs to the element's computed style, and any
 * component that sets its own `transition` (nearly all of them - to fade a
 * colour, say) replaces the list that included `transform`. The scale then
 * applied and was removed in a single frame - a snap on touch-down, a snap on
 * release - and a component that disliked the snap (the bottom bar) could only
 * opt out of its OWN `opacity`, not of the global scale it kept getting.
 *
 * WHAT THIS DOES
 * One delegated listener. On pointer-down it plays a short Web Animation on the
 * control's `scale` property; on release it plays back from wherever it had got
 * to, so a quick tap that ends before the press finishes still eases out instead
 * of jumping. Web Animations are not subject to the element's `transition`
 * list, `scale` composes with an element's own `transform`, and neither
 * property takes part in layout - nothing shifts and nothing reflows.
 *
 * WHAT IT LEAVES ALONE
 *   - disabled controls, and anything inside `[data-no-press]`;
 *   - controls that style their own pressed state, in ANY property (opacity,
 *     background, colour, transform...): read from the stylesheets before the
 *     press plays — see hasOwnPressStyle. Two effects for one tap read as the
 *     control reacting twice;
 *   - large targets (cards, media tiles, list rows): shrinking a photo or a whole
 *     row under the finger is not feedback, it is distortion;
 *   - everything, when the person has asked for reduced motion.
 */

const PRESS_MS = 90;
const RELEASE_MS = 170;
const EASING = 'cubic-bezier(0.2, 0.8, 0.2, 1)';

// A control bigger than this is a surface, not a button.
const MAX_HEIGHT = 96;
const MAX_WIDTH = 520;

const TARGET_SELECTOR = [
  'button',
  'a[href]',
  '[role="button"]',
  '[role="tab"]',
  '[role="menuitem"]',
  '[role="switch"]',
  'summary',
  'input[type="button"]',
  'input[type="submit"]',
  'input[type="reset"]',
].join(',');

/** How far the control shrinks: the smaller it is, the more it takes to be felt. */
export function pressScaleFor(width) {
  if (width < 120) return 0.92;
  if (width < 260) return 0.95;
  return 0.975;
}

/** Whether a control of this size and state should react to a press. */
export function isPressable(el, size) {
  if (!el) return false;
  if (el.disabled || el.getAttribute('aria-disabled') === 'true') return false;
  if (el.closest('[data-no-press]')) return false;
  const { width, height } = size;
  if (!width || !height) return false;
  return height <= MAX_HEIGHT && width <= MAX_WIDTH;
}

function prefersReducedMotion() {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/*
 * Controls that style their OWN pressed state.
 *
 * This used to be detected one frame after the press, and only by a change of
 * `transform`. A control whose press is an opacity dip, a tint, a colour or a
 * shadow (the Crew tabs' `:active { opacity: .85 }`, row tints, pills) was not
 * detected at all, so it got both: its own effect AND this scale — two
 * different responses to one tap, which reads as the control reacting twice.
 * A transform press was caught, but only after the scale had already played
 * for a frame, so even those twitched.
 *
 * The answer is in the stylesheets, so it is read from them: every rule with
 * `:active` names the element it styles when pressed — the compound that
 * carries the pseudo-class (`.likeBtn:active svg` styles `.likeBtn`'s child,
 * but it is `.likeBtn` being pressed). Those compounds, with `:active` taken
 * out, are matched against the control BEFORE anything plays. A control that
 * matches has its own press and is left entirely to it.
 *
 * Rescanned only when the number of stylesheets changes (a lazily loaded
 * route brings its CSS with it); a press itself costs one `matches` per rule.
 */
let pressSelectors = [];
let scannedSheetCount = -1;

/** Splits a selector list on top-level commas (not those inside `:not(a, b)`). */
function splitSelectorList(text) {
  const parts = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '(') depth += 1;
    else if (ch === ')') depth -= 1;
    else if (ch === ',' && depth === 0) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(text.slice(start));
  return parts.map((part) => part.trim()).filter(Boolean);
}

/**
 * The pressed element's own selector from one complex selector, or null:
 * everything up to the end of the compound that carries `:active`, with
 * `:active` removed. `:active` inside `:not(...)` / `:has(...)` is not a press.
 */
export function pressedElementSelector(selector) {
  let depth = 0;
  let at = -1;
  for (let i = 0; i < selector.length; i += 1) {
    const ch = selector[i];
    if (ch === '(') depth += 1;
    else if (ch === ')') depth -= 1;
    else if (depth === 0 && selector.startsWith(':active', i)) { at = i; break; }
  }
  if (at === -1) return null;
  let end = selector.length;
  depth = 0;
  for (let i = at; i < selector.length; i += 1) {
    const ch = selector[i];
    if (ch === '(') depth += 1;
    else if (ch === ')') depth -= 1;
    else if (depth === 0 && /[\s>+~]/.test(ch)) { end = i; break; }
  }
  const base = (selector.slice(0, at) + selector.slice(at + ':active'.length, end)).trim();
  // A bare `:active` (or one under `*`) would claim every control on the page.
  if (!base || base === '*' || /[\s>+~]$/.test(base)) return null;
  return base;
}

function collectPressSelectors(rules, out) {
  for (const rule of rules) {
    if (rule.selectorText && rule.selectorText.includes(':active')) {
      for (const part of splitSelectorList(rule.selectorText)) {
        const base = pressedElementSelector(part);
        if (base) out.add(base);
      }
    }
    // @media, @supports, @layer and nested style rules.
    if (rule.cssRules && rule.cssRules.length) collectPressSelectors(rule.cssRules, out);
  }
}

function currentPressSelectors(doc) {
  const sheets = doc.styleSheets;
  if (!sheets || sheets.length === scannedSheetCount) return pressSelectors;
  const found = new Set();
  for (const sheet of sheets) {
    let rules;
    try {
      rules = sheet.cssRules;
    } catch (_) {
      continue; // a cross-origin sheet (web fonts) cannot be read, and has no controls
    }
    if (rules) collectPressSelectors(rules, found);
  }
  scannedSheetCount = sheets.length;
  pressSelectors = [...found].filter((selector) => {
    try {
      doc.documentElement.matches(selector);
      return true;
    } catch (_) {
      return false;
    }
  });
  return pressSelectors;
}

/** True when the stylesheets give this control a pressed state of its own. */
export function hasOwnPressStyle(el, doc = document) {
  return currentPressSelectors(doc).some((selector) => el.matches(selector));
}

/** For tests: forget the scan. */
export function __resetPressSelectors() {
  pressSelectors = [];
  scannedSheetCount = -1;
}

/**
 * Starts listening. Returns the function that stops it.
 * Safe to call where Web Animations are missing: it then does nothing.
 */
export function installPressFeedback(root = document) {
  if (typeof window === 'undefined' || typeof Element === 'undefined' || typeof Element.prototype.animate !== 'function') {
    return () => {};
  }

  let current = null;

  const release = () => {
    if (!current) return;
    const { animation } = current;
    current = null;
    // Play back from the current progress, a little slower than the press.
    animation.playbackRate = -(PRESS_MS / RELEASE_MS);
    animation.play();
    const done = () => animation.cancel();
    animation.onfinish = done;
    animation.oncancel = null;
  };

  const onDown = (event) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    if (!(event.target instanceof Element)) return;
    const el = event.target.closest(TARGET_SELECTOR);
    if (!el || prefersReducedMotion()) return;

    const size = { width: el.offsetWidth, height: el.offsetHeight };
    if (!isPressable(el, size)) return;
    // Its own :active styling is its press feedback; never add a second.
    if (hasOwnPressStyle(el, el.ownerDocument || document)) return;

    release();
    const transformBefore = getComputedStyle(el).transform;
    const animation = el.animate(
      [{ scale: '1' }, { scale: String(pressScaleFor(size.width)) }],
      { duration: PRESS_MS, easing: EASING, fill: 'forwards' },
    );
    current = { el, animation };

    // `:active` is applied by the browser around this event, so look one frame
    // later: a control that restyles its own transform on press owns the effect.
    requestAnimationFrame(() => {
      if (current?.animation !== animation) return;
      if (getComputedStyle(el).transform !== transformBefore) {
        current = null;
        animation.cancel();
      }
    });
  };

  /*
   * The stylesheet scan, done while idle rather than on a press: the first
   * scan of the whole app's CSS took ~20 ms in development, which a tap must
   * not pay. Rescanned the same way when a route brings new stylesheets.
   */
  const doc = root.ownerDocument || root;
  const idle = (fn) => (typeof window.requestIdleCallback === 'function'
    ? window.requestIdleCallback(fn, { timeout: 2000 })
    : window.setTimeout(fn, 200));
  let idleScan = 0;
  const scheduleScan = () => {
    if (idleScan) return;
    idleScan = idle(() => {
      idleScan = 0;
      currentPressSelectors(doc);
    });
  };
  scheduleScan();
  const headObserver = typeof MutationObserver === 'function' && doc.head
    ? new MutationObserver(scheduleScan)
    : null;
  headObserver?.observe(doc.head, { childList: true });

  const opts = { capture: true, passive: true };
  root.addEventListener('pointerdown', onDown, opts);
  // A scroll or drag that takes the gesture away ends in pointercancel.
  root.addEventListener('pointerup', release, opts);
  root.addEventListener('pointercancel', release, opts);
  root.addEventListener('dragstart', release, opts);
  window.addEventListener('blur', release);

  return () => {
    headObserver?.disconnect();
    release();
    root.removeEventListener('pointerdown', onDown, opts);
    root.removeEventListener('pointerup', release, opts);
    root.removeEventListener('pointercancel', release, opts);
    root.removeEventListener('dragstart', release, opts);
    window.removeEventListener('blur', release);
  };
}
