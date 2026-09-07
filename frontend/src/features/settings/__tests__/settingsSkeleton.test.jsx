/** @vitest-environment jsdom */
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import SettingsSkeleton from '../components/skeletons/SettingsSkeleton';
import { SETTINGS_TREE } from '../pages/SettingsRoute';

/**
 * A skeleton is only worth showing if it is the shape of what replaces it. This
 * one had drifted a restructure behind the real page — three labelled sections
 * of seven flat rows, against a root that renders one card of category rows —
 * so it collapsed into a different layout on mount.
 *
 * The row count is asserted against SETTINGS_TREE rather than hardcoded, so
 * adding or removing a root entry fails here instead of silently reintroducing
 * the mismatch this rewrite fixed.
 */
function renderAt(path) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/settings" element={<SettingsSkeleton />} />
        <Route path="/settings/:panel" element={<SettingsSkeleton />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('SettingsSkeleton', () => {
  afterEach(cleanup);

  it('draws one placeholder row per root entry, plus Log Out', () => {
    const { container } = renderAt('/settings');
    const rows = container.querySelectorAll('[class*="rowItem"]');
    expect(rows.length).toBe(SETTINGS_TREE.length + 1);
  });

  it('gives each list row the icon, two text bars and chevron the real row has', () => {
    const { container } = renderAt('/settings');
    const firstRow = container.querySelector('[class*="rowItem"]');
    // icon tile + text column + chevron
    expect(firstRow.children.length).toBe(3);
    expect(firstRow.querySelector('[class*="rowText"]').children.length).toBe(2);
  });

  it('renders both panes, so the split layout has no gap on load', () => {
    const { container } = renderAt('/settings');
    expect(container.querySelector('[class*="listPane"]')).toBeTruthy();
    expect(container.querySelector('[class*="detailPane"]')).toBeTruthy();
  });

  it('renders on a panel URL too', () => {
    const { container } = renderAt('/settings/interests');
    expect(container.querySelector('[class*="detailPane"]')).toBeTruthy();
    expect(container.querySelectorAll('[class*="detailRow"]').length).toBe(4);
  });
});
