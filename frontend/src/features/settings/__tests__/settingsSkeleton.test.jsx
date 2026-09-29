/** @vitest-environment jsdom */
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import SettingsSkeleton from '../components/skeletons/SettingsSkeleton';

/**
 * The Settings chunk-load fallback.
 *
 * Everything on the Settings root is static and arrives with the chunk, so the
 * fallback draws only the real frame and top bar. Skeleton icon tiles, label
 * bars and chevrons stood for nothing that was loading, and twice drifted into
 * a second layout the page then snapped into - these tests pin that they stay
 * gone, and that the header is the real, working one.
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

  it('renders the real title and a working back button, not placeholders', () => {
    const { getByText, getByRole } = renderAt('/settings');
    expect(getByText('Settings')).toBeTruthy();
    expect(getByRole('button', { name: 'Go back' })).toBeTruthy();
  });

  it('does not skeletonise the static category list', () => {
    const { container } = renderAt('/settings');
    expect(container.querySelectorAll('[class*="skeleton"]').length).toBe(0);
    expect(container.querySelectorAll('[class*="rowItem"]').length).toBe(0);
  });

  it('keeps the split frame, so the page lands in the same shape', () => {
    const { container } = renderAt('/settings');
    expect(container.querySelector('[class*="listPane"]')).toBeTruthy();
    expect(container.querySelector('[class*="detailPane"]')).toBeTruthy();
  });

  it('leaves the title blank on a panel URL rather than guessing it', () => {
    const { container, queryByText, getByRole } = renderAt('/settings/interests');
    expect(queryByText('Settings')).toBeNull();
    expect(getByRole('button', { name: 'Go back' })).toBeTruthy();
    expect(container.querySelector('[class*="topBarTitle"]').textContent).toBe('');
  });
});
