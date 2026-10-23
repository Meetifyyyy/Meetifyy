/** @vitest-environment jsdom */
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { OfflineScreen, OfflineState } from '../StateViews';


afterEach(cleanup);

describe('OfflineState wording', () => {
  it('says the device is offline and never what is or is not kept on it', () => {
    const { container } = render(<OfflineState />);
    expect(screen.getByText("You're offline")).toBeTruthy();
    expect(screen.getByText('Connect to the internet to see this.')).toBeTruthy();
    expect(container.textContent).not.toMatch(/saved|stored|on this device/i);
  });
});

describe('OfflineScreen', () => {
  it('renders the offline state inside one screen-level wrapper', () => {
    const { container } = render(<OfflineScreen message="Campus will load when you are back online." />);
    const wrapper = container.querySelector('[data-offline-screen]');
    expect(wrapper).not.toBeNull();
    expect(wrapper.textContent).toContain("You're offline");
    expect(wrapper.textContent).toContain('Campus will load');
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('offers a way out only when the page has nowhere else to leave by', () => {
    const onBack = vi.fn();
    render(<OfflineScreen onBack={onBack} />);
    fireEvent.click(screen.getByRole('button', { name: 'Go back' }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  // jsdom does no layout, so the centring is pinned where it is defined.
  describe('stylesheet', () => {
    // vitest runs from the frontend root.
    const css = readFileSync('src/shared/components/ui/StateViews.module.css', 'utf8');
    const rule = (selector, from = 0) => {
      const start = css.indexOf(selector, from);
      return css.slice(start, css.indexOf('}', start));
    };

    it('centres its content both ways', () => {
      const base = rule('.screen {');
      expect(base).toMatch(/display:\s*flex/);
      expect(base).toMatch(/align-items:\s*center/);
      expect(base).toMatch(/justify-content:\s*center/);
    });

    it('on a phone, spans exactly the visible screen: under the status bar, above the bottom bar', () => {
      const phone = css.slice(css.indexOf('@media (max-width: 768px)'));
      const fixed = rule('.screen {', css.indexOf('@media (max-width: 768px)'));
      expect(fixed).toMatch(/position:\s*fixed/);
      expect(fixed).toMatch(/top:\s*var\(--status-bar-inset/);
      expect(fixed).toMatch(/bottom:\s*var\(--bottom-nav-clearance/);
      expect(fixed).toMatch(/left:\s*0/);
      expect(fixed).toMatch(/right:\s*0/);
      // A page with no bottom bar only keeps the home-indicator inset.
      expect(phone).toMatch(/data-no-bottom-nav\]\)\s*\.screen\s*\{[^}]*safe-area-inset-bottom/);
    });

    it('on a wide screen stays an ordinary block, so the website layout is untouched', () => {
      const wide = css.slice(0, css.indexOf('@media'));
      expect(wide).not.toMatch(/position:\s*fixed/);
    });
  });
});
