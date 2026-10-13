/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readPageEdgeColors } from '../pageEdgeColors';

/**
 * While a View Transition is on screen the page cannot hit-test:
 * elementsFromPoint returns only <html>, whose inline background is the launch
 * colour. A theme switch moves nothing, so the elements found by the last real
 * hit-test are reused and read in the new theme.
 */
describe('readPageEdgeColors while hit-testing is blind', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
    delete document.elementsFromPoint;
  });

  it('reads the last edge elements again instead of <html>', () => {
    const bar = document.createElement('div');
    bar.style.backgroundColor = 'rgb(0, 0, 0)';
    document.body.appendChild(bar);
    vi.spyOn(bar, 'getBoundingClientRect').mockReturnValue({ width: window.innerWidth });
    document.documentElement.style.background = 'rgb(255, 255, 255)';

    document.elementsFromPoint = () => [bar];
    expect(readPageEdgeColors().top).toBe('#000000');

    // The theme changes and a transition starts: only <html> is hit now.
    bar.style.backgroundColor = 'rgb(17, 17, 17)';
    document.elementsFromPoint = () => [document.documentElement];
    expect(readPageEdgeColors().top).toBe('#111111');
  });
});
