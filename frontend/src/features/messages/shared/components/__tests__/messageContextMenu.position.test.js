import { describe, it, expect } from 'vitest';
import { computeMenuPosition, MENU_GAP, MENU_EDGE_MARGIN } from '../MessageContextMenu';

const viewport = { width: 400, height: 800 };
const size = { width: 180, height: 220 };

describe('computeMenuPosition', () => {
  it('opens below-right of the press when there is room', () => {
    const { x, y } = computeMenuPosition({ x: 50, y: 100 }, size, viewport);
    expect(x).toBe(50 + MENU_GAP);
    expect(y).toBe(100 + MENU_GAP);
  });

  it('flips above the press point near the bottom, mirroring it exactly', () => {
    const pressY = viewport.height - 40; // 760
    const { y } = computeMenuPosition({ x: 50, y: pressY }, size, viewport);
    // must sit a full gap ABOVE the press, not 2*gap too low
    expect(y + size.height).toBe(pressY - MENU_GAP);
    expect(y + size.height).toBeLessThan(pressY);
  });

  it('flips left of the press point near the right edge', () => {
    const pressX = viewport.width - 20; // 380
    const { x } = computeMenuPosition({ x: pressX, y: 100 }, size, viewport);
    expect(x + size.width).toBe(pressX - MENU_GAP);
  });

  it('treats both axes symmetrically when both overflow', () => {
    const press = { x: viewport.width - 20, y: viewport.height - 40 };
    const { x, y } = computeMenuPosition(press, size, viewport);
    expect(x + size.width).toBe(press.x - MENU_GAP);
    expect(y + size.height).toBe(press.y - MENU_GAP);
  });

  it('never escapes the viewport, even when the menu is taller than the space', () => {
    const tall = { width: 180, height: 700 };
    const { x, y } = computeMenuPosition({ x: 10, y: 780 }, tall, viewport);
    expect(y).toBeGreaterThanOrEqual(MENU_EDGE_MARGIN);
    expect(y + tall.height).toBeLessThanOrEqual(viewport.height - MENU_EDGE_MARGIN);
    expect(x).toBeGreaterThanOrEqual(MENU_EDGE_MARGIN);
  });

  it('positions from the untransformed size, so a scaled measurement would differ', () => {
    // the entry animation is scale(0.92); measuring mid-animation reports ~8% short
    const real = computeMenuPosition({ x: 50, y: 760 }, size, viewport);
    const scaled = computeMenuPosition({ x: 50, y: 760 }, { width: 180 * 0.92, height: 220 * 0.92 }, viewport);
    expect(real.y).not.toBe(scaled.y);
  });
});
