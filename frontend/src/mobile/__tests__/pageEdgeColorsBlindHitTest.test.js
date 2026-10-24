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

  it('keeps reading the page while an ignored overlay is all that is hit over an inert #root', () => {
    const appRoot = document.createElement('div');
    appRoot.id = 'root';
    const page = document.createElement('div');
    page.style.backgroundColor = 'rgb(253, 253, 253)';
    appRoot.appendChild(page);
    const overlay = document.createElement('div');
    overlay.setAttribute('data-bars-ignore', '');
    document.body.append(appRoot, overlay);
    vi.spyOn(page, 'getBoundingClientRect').mockReturnValue({ width: window.innerWidth });
    // <body> paints the blue page gradient; reading it was the bug.
    document.body.style.backgroundImage = 'radial-gradient(circle, #d8e6fa, #d4e2f6)';

    document.elementsFromPoint = () => [page, appRoot];
    expect(readPageEdgeColors().bottom).toBe('#fdfdfd');

    // The viewer is closing: #root is inert, hit-testing sees only the fading
    // overlay and the document.
    appRoot.setAttribute('inert', '');
    document.elementsFromPoint = () => [overlay, document.body, document.documentElement];
    expect(readPageEdgeColors().bottom).toBe('#fdfdfd');
  });
});
