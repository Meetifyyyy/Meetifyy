/** @vitest-environment jsdom */
import { describe, it, expect, afterEach } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { BrowserRouter, Route, Routes, useLocation } from 'react-router-dom';
import { SmartBackTracker, useSmartNavigation } from '../useSmartNavigation';

/**
 * Tapping Home collapses onto the /home entry already in history: a delta
 * computed from the saved stack. When the browser's entries were replaced
 * underneath that stack (a sign-in redirect, a reload partway through), the
 * delta landed on Crew and Home "flickered back". The jump must be checked.
 */
let nav;
function Harness() {
  const { smartNavigate } = useSmartNavigation();
  nav = smartNavigate;
  const location = useLocation();
  return <div data-testid="where">{location.pathname}</div>;
}

afterEach(cleanup);

describe('a history jump that misses', () => {
  it('lands on the page that was asked for', async () => {
    window.history.replaceState(null, '', '/');
    render(
      <BrowserRouter>
        <SmartBackTracker />
        <Routes><Route path="*" element={<Harness />} /></Routes>
      </BrowserRouter>,
    );
    const where = () => screen.getByTestId('where').textContent;

    await act(async () => { nav('/home'); });
    await act(async () => { nav('/crew'); });
    await act(async () => { nav('/profile/me'); });
    expect(where()).toBe('/profile/me');

    // The entry the stack believes is /home now holds /crew: what a redirect
    // through another site leaves behind while sessionStorage keeps the stack.
    const idx = window.history.state.idx;
    await act(async () => {
      window.history.go(-2);
      await new Promise((r) => window.addEventListener('popstate', r, { once: true }));
    });
    window.history.replaceState({ ...window.history.state }, '', '/crew');
    await act(async () => {
      window.history.go(2);
      await new Promise((r) => window.addEventListener('popstate', r, { once: true }));
    });
    expect(window.history.state.idx).toBe(idx);

    await act(async () => { nav('/home'); });
    await waitFor(() => expect(where()).toBe('/home'));
  });
});
