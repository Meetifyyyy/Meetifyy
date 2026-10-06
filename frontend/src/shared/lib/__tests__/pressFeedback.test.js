/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installPressFeedback, isPressable, pressScaleFor, pressedElementSelector, __resetPressSelectors } from '../pressFeedback';

function sized(el, width, height) {
  Object.defineProperty(el, 'offsetWidth', { value: width, configurable: true });
  Object.defineProperty(el, 'offsetHeight', { value: height, configurable: true });
  return el;
}

function pointer(type, target, init = {}) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.assign(event, { pointerType: 'touch', button: 0, ...init });
  target.dispatchEvent(event);
}

describe('press scale', () => {
  it('shrinks small controls more than wide ones, so the change is about as visible', () => {
    expect(pressScaleFor(40)).toBeLessThan(pressScaleFor(200));
    expect(pressScaleFor(200)).toBeLessThan(pressScaleFor(400));
    expect(pressScaleFor(400)).toBeGreaterThan(0.95);
  });
});

describe('isPressable', () => {
  const button = () => document.createElement('button');

  it('accepts an ordinary control and rejects surfaces', () => {
    expect(isPressable(button(), { width: 120, height: 44 })).toBe(true);
    expect(isPressable(button(), { width: 360, height: 200 })).toBe(false); // card-sized
    expect(isPressable(button(), { width: 900, height: 44 })).toBe(false); // full-bleed
    expect(isPressable(button(), { width: 0, height: 0 })).toBe(false); // not rendered
  });

  it('rejects disabled controls and anything opted out', () => {
    const disabled = button();
    disabled.disabled = true;
    expect(isPressable(disabled, { width: 100, height: 40 })).toBe(false);

    const aria = button();
    aria.setAttribute('aria-disabled', 'true');
    expect(isPressable(aria, { width: 100, height: 40 })).toBe(false);

    const wrap = document.createElement('div');
    wrap.setAttribute('data-no-press', '');
    const inner = button();
    wrap.append(inner);
    expect(isPressable(inner, { width: 100, height: 40 })).toBe(false);
  });
});

describe('installPressFeedback', () => {
  let animations;
  let stop;

  beforeEach(() => {
    animations = [];
    Element.prototype.animate = vi.fn(function animate(keyframes, options) {
      const animation = {
        keyframes, options, el: this, playbackRate: 1,
        play: vi.fn(), cancel: vi.fn(), onfinish: null, oncancel: null,
      };
      animations.push(animation);
      return animation;
    });
    window.matchMedia = vi.fn(() => ({ matches: false }));
    stop = installPressFeedback(document);
  });

  afterEach(() => {
    stop();
    delete Element.prototype.animate;
    document.body.innerHTML = '';
    document.head.querySelectorAll('style[data-test]').forEach((n) => n.remove());
    __resetPressSelectors();
  });


  const mount = (tag = 'button', width = 100, height = 44) => {
    const el = sized(document.createElement(tag), width, height);
    if (tag === 'a') el.setAttribute('href', '#');
    document.body.append(el);
    return el;
  };

  const addCss = (css) => {
    const style = document.createElement('style');
    style.setAttribute('data-test', '');
    style.textContent = css;
    document.head.append(style);
  };

  it('leaves a control with its own non-transform press alone (one effect, not two)', () => {
    addCss('.chip:active { opacity: 0.85; }');
    const el = mount();
    el.className = 'chip';
    pointer('pointerdown', el);
    expect(animations).toHaveLength(0);
  });

  it('recognises the pressed control in a rule that styles its child', () => {
    addCss('.likeBtn:active:not(:disabled) svg { transform: scale(.8); }');
    const el = mount();
    el.className = 'likeBtn';
    pointer('pointerdown', el);
    expect(animations).toHaveLength(0);
  });

  it('still presses controls with no press style of their own', () => {
    addCss('.chip:active { opacity: 0.85; }');
    const el = mount();
    el.className = 'other';
    pointer('pointerdown', el);
    expect(animations).toHaveLength(1);
  });

  it('plays a scale animation on press, on the control that was pressed', () => {
    const el = mount();
    pointer('pointerdown', el);

    expect(animations).toHaveLength(1);
    const [animation] = animations;
    expect(animation.el).toBe(el);
    expect(animation.keyframes).toEqual([{ scale: '1' }, { scale: String(pressScaleFor(100)) }]);
    expect(animation.options.fill).toBe('forwards');
  });

  it('finds the control from a child (an icon inside a button)', () => {
    const el = mount();
    const icon = document.createElement('span');
    el.append(icon);
    pointer('pointerdown', icon);
    expect(animations[0].el).toBe(el);
  });

  it('eases back from where it got to on release, slower than the press, then clears itself', () => {
    const el = mount();
    pointer('pointerdown', el);
    const [animation] = animations;

    pointer('pointerup', el);

    expect(animation.playbackRate).toBeLessThan(0);
    expect(Math.abs(animation.playbackRate)).toBeLessThan(1);
    expect(animation.play).toHaveBeenCalled();
    expect(animation.cancel).not.toHaveBeenCalled();
    animation.onfinish();
    expect(animation.cancel).toHaveBeenCalled(); // the held scale is dropped, not left behind
  });

  it('releases on a cancelled gesture too (the touch became a scroll)', () => {
    const el = mount();
    pointer('pointerdown', el);
    pointer('pointercancel', el);
    expect(animations[0].play).toHaveBeenCalled();
  });

  it('works for links, and ignores plain text, big surfaces and opted-out controls', () => {
    pointer('pointerdown', mount('a'));
    expect(animations).toHaveLength(1);

    pointer('pointerdown', mount('div'));
    pointer('pointerdown', mount('button', 400, 300));
    const optedOut = mount();
    optedOut.setAttribute('data-no-press', '');
    pointer('pointerdown', optedOut);
    expect(animations).toHaveLength(1);
  });

  it('ignores a secondary mouse button', () => {
    pointer('pointerdown', mount(), { pointerType: 'mouse', button: 2 });
    expect(animations).toHaveLength(0);
  });

  it('does nothing when the person asked for reduced motion', () => {
    window.matchMedia = vi.fn(() => ({ matches: true }));
    pointer('pointerdown', mount());
    expect(animations).toHaveLength(0);
  });

  it('settles a press that never got its release before starting the next one', () => {
    pointer('pointerdown', mount());
    pointer('pointerdown', mount());
    expect(animations).toHaveLength(2);
    expect(animations[0].play).toHaveBeenCalled();
  });

  it('stops listening when uninstalled', () => {
    stop();
    pointer('pointerdown', mount());
    expect(animations).toHaveLength(0);
  });
});

describe('controls that style their own pressed state', () => {
  let animations;
  let stop;
  let frames;
  let transform;

  beforeEach(() => {
    animations = [];
    frames = [];
    transform = 'none';
    Element.prototype.animate = vi.fn(function animate() {
      const animation = { playbackRate: 1, play: vi.fn(), cancel: vi.fn() };
      animations.push(animation);
      return animation;
    });
    window.matchMedia = vi.fn(() => ({ matches: false }));
    window.requestAnimationFrame = vi.fn((cb) => { frames.push(cb); return frames.length; });
    window.getComputedStyle = vi.fn(() => ({ transform }));
    stop = installPressFeedback(document);
  });
  afterEach(() => {
    stop();
    delete Element.prototype.animate;
    document.body.innerHTML = '';
    __resetPressSelectors();
  });

  const press = () => {
    const el = sized(document.createElement('button'), 100, 44);
    document.body.append(el);
    pointer('pointerdown', el);
    return el;
  };

  it('keeps going when the control\'s transform is unchanged by the press', () => {
    press();
    frames.forEach((cb) => cb());
    expect(animations[0].cancel).not.toHaveBeenCalled();
  });

  it('steps aside once the control\'s own :active transform appears, so the two never stack', () => {
    press();
    transform = 'matrix(0.96, 0, 0, 0.96, 0, 0)'; // the component's own pressed style took effect
    frames.forEach((cb) => cb());
    expect(animations[0].cancel).toHaveBeenCalledTimes(1);
  });

  it('does not touch a newer press when an older frame callback arrives late', () => {
    press();
    press();
    transform = 'matrix(0.96, 0, 0, 0.96, 0, 0)';
    frames[0](); // belongs to the first, already-released press
    expect(animations[0].cancel).not.toHaveBeenCalled();
  });
});

describe('installPressFeedback without Web Animations', () => {
  it('does nothing and returns a no-op disposer', () => {
    const original = Element.prototype.animate;
    delete Element.prototype.animate;
    const stop = installPressFeedback(document);
    expect(typeof stop).toBe('function');
    expect(() => stop()).not.toThrow();
    if (original) Element.prototype.animate = original;
  });
});

describe('pressedElementSelector', () => {
  it('keeps the compound that carries :active and drops the rest', () => {
    expect(pressedElementSelector('.a:active')).toBe('.a');
    expect(pressedElementSelector('.a:active:not(:disabled) svg')).toBe('.a:not(:disabled)');
    expect(pressedElementSelector('.wrap .btn:active > .icon')).toBe('.wrap .btn');
    expect(pressedElementSelector('.tabsPills .tabActive:active')).toBe('.tabsPills .tabActive');
  });

  it('ignores :active that is not a press of the element', () => {
    expect(pressedElementSelector('.a:not(:active)')).toBeNull();
    expect(pressedElementSelector(':active')).toBeNull();
    expect(pressedElementSelector('.a')).toBeNull();
  });
});
