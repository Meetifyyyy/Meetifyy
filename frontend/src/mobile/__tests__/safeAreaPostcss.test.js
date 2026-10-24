import { describe, it, expect } from 'vitest';
import postcss from 'postcss';
import { withNativeNavigationInset, safeAreaPostcss } from '../safeAreaPostcss';

const PAIR = 'var(--navigation-bar-inset, 0px)';

describe('withNativeNavigationInset', () => {
  it('pairs a bare env() with the native inset', () => {
    expect(withNativeNavigationInset('env(safe-area-inset-bottom)')).toBe(
      `max(env(safe-area-inset-bottom), ${PAIR})`,
    );
  });

  it('keeps the env() fallback', () => {
    expect(withNativeNavigationInset('env(safe-area-inset-bottom, 12px)')).toBe(
      `max(env(safe-area-inset-bottom, 12px), ${PAIR})`,
    );
  });

  it('rewrites inside calc() and other functions', () => {
    expect(withNativeNavigationInset('calc(12px + env(safe-area-inset-bottom, 0px))')).toBe(
      `calc(12px + max(env(safe-area-inset-bottom, 0px), ${PAIR}))`,
    );
    expect(withNativeNavigationInset('max(16px, env(safe-area-inset-bottom, 0px))')).toBe(
      `max(16px, max(env(safe-area-inset-bottom, 0px), ${PAIR}))`,
    );
  });

  it('rewrites every occurrence in one value', () => {
    const out = withNativeNavigationInset(
      'env(safe-area-inset-bottom, 0px) env(safe-area-inset-bottom, 4px)',
    );
    expect(out.match(/--navigation-bar-inset/g)).toHaveLength(2);
  });

  it('handles a var() fallback with its own parentheses', () => {
    expect(withNativeNavigationInset('env(safe-area-inset-bottom, var(--x, 3px))')).toBe(
      `max(env(safe-area-inset-bottom, var(--x, 3px)), ${PAIR})`,
    );
  });

  it('leaves a value already paired with the native inset alone', () => {
    const paired = `max(env(safe-area-inset-bottom, 0px), ${PAIR})`;
    expect(withNativeNavigationInset(paired)).toBe(paired);
    expect(withNativeNavigationInset(withNativeNavigationInset('env(safe-area-inset-bottom)'))).toBe(
      `max(env(safe-area-inset-bottom), ${PAIR})`,
    );
  });

  it('does not touch the top inset', () => {
    const v = 'env(safe-area-inset-top, 0px)';
    expect(withNativeNavigationInset(v)).toBe(v);
  });

  it('pairs the left and right insets with the side insets', () => {
    expect(withNativeNavigationInset('calc(14px + env(safe-area-inset-left, 0px))')).toBe(
      'calc(14px + max(env(safe-area-inset-left, 0px), var(--side-inset-left, 0px)))',
    );
    expect(withNativeNavigationInset('env(safe-area-inset-right)')).toBe(
      'max(env(safe-area-inset-right), var(--side-inset-right, 0px))',
    );
  });

  it('leaves an already-paired side inset alone', () => {
    const v = 'max(env(safe-area-inset-left, 0px), var(--side-inset-left, 0px))';
    expect(withNativeNavigationInset(v)).toBe(v);
  });

  it('ignores values without a safe-area env()', () => {
    expect(withNativeNavigationInset('12px')).toBe('12px');
    expect(withNativeNavigationInset(undefined)).toBe(undefined);
  });
});

describe('safeAreaPostcss', () => {
  it('rewrites declarations and settles in one pass', async () => {
    const css = '.a { padding-bottom: calc(8px + env(safe-area-inset-bottom, 0px)); top: env(safe-area-inset-top, 0px); }';
    const out = await postcss([safeAreaPostcss()]).process(css, { from: undefined });
    expect(out.css).toContain(`padding-bottom: calc(8px + max(env(safe-area-inset-bottom, 0px), ${PAIR}))`);
    expect(out.css).toContain('top: env(safe-area-inset-top, 0px)');
  });
});
