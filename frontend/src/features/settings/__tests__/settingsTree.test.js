import { describe, it, expect, vi } from 'vitest';

// The module pulls in the whole settings screen. Only the tree constants are
// under test, so its heavy leaves are stubbed rather than rendered.
vi.mock('@shared/context/AuthContext', () => ({ useAuth: () => ({}) }));
vi.mock('@shared/api/apiClient', () => ({
  // Added with the cookie migration: AuthContext reads this to decide
  // whether a cookie session is worth recovering.
  readCsrfCookie: () => '', apiClient: {} }));
vi.mock('@shared/lib/supabase', () => ({ supabase: {}, isSupabaseConfigured: false }));

const { SETTINGS_TREE, SETTINGS_CATEGORIES, SETTINGS_PANELS, PANEL_PARENT } =
  await import('../pages/SettingsRoute');

/**
 * Settings is two levels: Settings -> category -> setting. The tree is the only
 * description of that shape — the root list, each category's list, which URLs
 * are valid and where Back goes are all derived from it.
 *
 * These tests exist because those four used to be separate hand-maintained
 * lists, which is how a panel could be reachable in the UI and rejected by the
 * URL. They also pin the two structural rules the restructure was for: nothing
 * destructive on the root, and no category that exists only to hold one thing.
 */
describe('the Settings tree', () => {
  const categories = SETTINGS_TREE.filter((e) => e.items);
  const leaves = SETTINGS_TREE.filter((e) => !e.items);

  it('addresses every panel it can open', () => {
    for (const entry of categories) {
      for (const item of [...entry.items, ...(entry.danger || [])]) {
        if (item.panel) expect(SETTINGS_PANELS).toContain(item.panel);
      }
    }
    for (const leaf of leaves) expect(SETTINGS_PANELS).toContain(leaf.panel);
  });

  it('gives every panel inside a category somewhere to go back to', () => {
    for (const entry of categories) {
      for (const item of entry.items) {
        if (item.panel) expect(PANEL_PARENT[item.panel]).toBe(entry.slug);
      }
    }
  });

  /** A root leaf closes to the root, so it must NOT claim a parent. */
  it('leaves root-level settings without a parent', () => {
    for (const leaf of leaves) expect(PANEL_PARENT[leaf.panel]).toBeUndefined();
  });

  it('uses each slug exactly once, so a URL means one thing', () => {
    const slugs = SETTINGS_TREE.map((e) => e.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    expect(new Set(SETTINGS_PANELS).size).toBe(SETTINGS_PANELS.length);
  });

  /**
   * The reason Delete Account moved. A destructive action must not be one
   * mis-tap from the row that changes a display name, so it lives in a
   * category's `danger` list and never in `items` or at the root.
   */
  it('keeps destructive actions off the root and out of the ordinary lists', () => {
    for (const entry of SETTINGS_TREE) {
      expect(entry.action).toBeUndefined();
      for (const item of entry.items || []) {
        expect(item.action).not.toBe('delete');
      }
    }
    const danger = categories.flatMap((c) => c.danger || []).map((d) => d.action);
    expect(danger).toContain('delete');
  });

  it('does not create a category that holds a single setting', () => {
    for (const entry of categories) {
      expect(entry.items.length).toBeGreaterThan(1);
    }
  });

  it('describes every root entry, since the root is only categories', () => {
    for (const entry of SETTINGS_TREE) {
      expect(entry.label).toBeTruthy();
      expect(entry.description).toBeTruthy();
      expect(entry.icon).toBeTruthy();
    }
  });

  it('exposes exactly the categories that have items', () => {
    expect(SETTINGS_CATEGORIES).toEqual(categories.map((c) => c.slug));
  });

  /**
   * Interests is the one setting here people come back to, and it is not an
   * account detail — it feeds the feed. It was nested under Account, two steps
   * in behind settings that get touched once. Its place at the root is the
   * point, so it is pinned rather than left to the generic invariants above,
   * all of which a nested Interests would also satisfy.
   */
  it('opens Interests from the root rather than from inside Account', () => {
    const interests = SETTINGS_TREE.find((e) => e.slug === 'interests');
    expect(interests).toBeDefined();
    expect(interests.panel).toBe('interests');
    expect(PANEL_PARENT.interests).toBeUndefined();

    for (const category of categories) {
      const nested = [...category.items, ...(category.danger || [])];
      expect(nested.map((i) => i.panel)).not.toContain('interests');
    }
  });
});
