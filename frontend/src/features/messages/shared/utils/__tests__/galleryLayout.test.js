import { describe, expect, it } from 'vitest';
import {
  GRID_GAP, GRID_MIN_TILE, GRID_PAGE_MAX, STRIP_GAP, STRIP_MAX_COLUMNS, STRIP_MIN_TILE,
  gridColumns, gridPageSize, stripColumns,
} from '../galleryLayout';

describe('preview row capacity', () => {
  it('asks for nothing until it has been measured', () => {
    expect(stripColumns(0)).toBe(0);
    expect(stripColumns(Number.NaN)).toBe(0);
    expect(stripColumns(-10)).toBe(0);
  });

  it('fits as many minimum tiles as the width allows, including the gaps', () => {
    for (const width of [250, 290, 360, 420, 560, 900]) {
      const columns = stripColumns(width);
      const used = columns * STRIP_MIN_TILE + (columns - 1) * STRIP_GAP;
      expect(used).toBeLessThanOrEqual(width);
      if (columns < STRIP_MAX_COLUMNS) {
        // One more tile would not have fitted.
        expect(used + STRIP_MIN_TILE + STRIP_GAP).toBeGreaterThan(width);
      }
    }
  });

  it('never goes below one tile or above the cap', () => {
    expect(stripColumns(10)).toBe(1);
    expect(stripColumns(10_000)).toBe(STRIP_MAX_COLUMNS);
  });

  it('grows with the space it has', () => {
    expect(stripColumns(290)).toBeLessThan(stripColumns(560));
  });
});

describe('full gallery sizing', () => {
  it('chooses columns from the width, never fewer than two', () => {
    expect(gridColumns(0)).toBe(0);
    expect(gridColumns(120)).toBe(2);
    expect(gridColumns(336)).toBe(3);
    expect(gridColumns(584)).toBeGreaterThanOrEqual(5);
    const columns = gridColumns(700);
    expect(columns * GRID_MIN_TILE + (columns - 1) * GRID_GAP).toBeLessThanOrEqual(700);
  });

  it('requests enough to fill the screen plus a row, in whole rows', () => {
    const width = 336;
    const columns = gridColumns(width);
    const tile = (width - GRID_GAP * (columns - 1)) / columns;
    const height = 600;

    const size = gridPageSize(width, height);

    expect(size % columns).toBe(0);
    const rows = size / columns;
    expect(rows * (tile + GRID_GAP)).toBeGreaterThanOrEqual(height + tile); // overscan row
  });

  it('asks for more on a taller screen, and never past the cap', () => {
    expect(gridPageSize(336, 900)).toBeGreaterThan(gridPageSize(336, 400));
    expect(gridPageSize(336, 100_000)).toBe(GRID_PAGE_MAX);
  });

  it('asks for at least two rows, and for nothing before it is measured', () => {
    expect(gridPageSize(336, 20)).toBeGreaterThanOrEqual(gridColumns(336) * 2);
    expect(gridPageSize(0, 600)).toBe(0);
    expect(gridPageSize(336, 0)).toBe(0);
  });
});
