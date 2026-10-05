/**
 * How many gallery tiles fit, from the space the gallery actually has.
 *
 * These decide both the layout AND how much to ask the server for: a preview
 * row requests exactly the tiles that fit in it, and the full gallery requests
 * enough to fill the screen it is on plus one row of overscan. Nothing is
 * requested "in case" and nothing is requested twice.
 */

export const STRIP_MIN_TILE = 72;
export const STRIP_GAP = 12;
export const STRIP_MAX_COLUMNS = 8;

export const GRID_MIN_TILE = 96;
export const GRID_GAP = 8;
export const GRID_MIN_COLUMNS = 2;
export const GRID_PAGE_MAX = 60;

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

/** Columns in the details preview row for a given inner width. */
export function stripColumns(width) {
  if (!Number.isFinite(width) || width <= 0) return 0;
  return clamp(Math.floor((width + STRIP_GAP) / (STRIP_MIN_TILE + STRIP_GAP)), 1, STRIP_MAX_COLUMNS);
}

/** Columns in the full gallery grid for a given inner width. */
export function gridColumns(width) {
  if (!Number.isFinite(width) || width <= 0) return 0;
  return Math.max(GRID_MIN_COLUMNS, Math.floor((width + GRID_GAP) / (GRID_MIN_TILE + GRID_GAP)));
}

/**
 * Items for the first page of the full gallery: the rows that fill the visible
 * height, plus one more so the first scroll never reveals an empty edge.
 * Tiles stretch to fill the width, so the tile size is derived, not assumed.
 */
export function gridPageSize(width, height) {
  const columns = gridColumns(width);
  if (columns === 0 || !Number.isFinite(height) || height <= 0) return 0;
  const tile = (width - GRID_GAP * (columns - 1)) / columns;
  const rows = Math.ceil(height / (tile + GRID_GAP)) + 1;
  return clamp(columns * rows, columns * 2, GRID_PAGE_MAX);
}
