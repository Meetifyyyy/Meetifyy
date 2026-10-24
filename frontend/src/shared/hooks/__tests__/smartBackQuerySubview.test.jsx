/** @vitest-environment jsdom */
import { describe, it, expect, afterEach } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { SmartBackTracker, useSmartNavigation } from '../useSmartNavigation';

/**
 * The profile's followers list lives in `?tab=followers` and closes with
 * goBack('/profile/:name'). Opened as the first entry (a notification, a link,
 * a restored app) there is nothing behind it, so goBack falls back to the
 * profile path. That path equals the current one once the query is ignored,
 * and the close button used to do nothing.
 */
let back;
function Harness() {
  const { goBack } = useSmartNavigation();
  back = goBack;
  const location = useLocation();
  return <div data-testid="where">{`${location.pathname}${location.search}`}</div>;
}

afterEach(cleanup);

describe('goBack from a query-owned sub-view with no history behind it', () => {
  it('drops the query and lands on the page itself', async () => {
    render(
      <MemoryRouter initialEntries={['/profile/asha?tab=followers']}>
        <SmartBackTracker />
        <Routes><Route path="*" element={<Harness />} /></Routes>
      </MemoryRouter>,
    );
    const where = () => screen.getByTestId('where').textContent;
    expect(where()).toBe('/profile/asha?tab=followers');

    await act(async () => { back('/profile/asha'); });
    await waitFor(() => expect(where()).toBe('/profile/asha'));
  });

  it('still stays put when already exactly on the fallback', async () => {
    render(
      <MemoryRouter initialEntries={['/profile/asha']}>
        <SmartBackTracker />
        <Routes><Route path="*" element={<Harness />} /></Routes>
      </MemoryRouter>,
    );
    await act(async () => { back('/profile/asha'); });
    expect(screen.getByTestId('where').textContent).toBe('/profile/asha');
  });
});
