/** @vitest-environment jsdom */
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import AuthShell from '../shared/ui/AuthShell';

/**
 * The story column must show the route's own copy on the very first frame.
 *
 * The route group mounts <AuthShell> with no props around a lazy page, so the
 * shell used to paint its generic default ("Your campus, finally connected.")
 * and swap to the page's copy once the page chunk loaded: a visible flicker
 * on every reload of /login. Rendering the shell alone, with no page inside
 * to report anything, is exactly that first frame.
 */
afterEach(cleanup);

const firstFrame = (path) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <AuthShell>{null}</AuthShell>
    </MemoryRouter>,
  );

describe('AuthShell first paint', () => {
  it.each([
    ['/login', /Good to see/],
    ['/forgot-password', /Locked out\?/],
    ['/reset-password', /Almost there\./],
  ])('%s shows its own headline before the page loads', (path, headline) => {
    firstFrame(path);
    expect(screen.getByRole('heading', { level: 2 }).textContent).toMatch(headline);
    expect(screen.queryByText(/finally connected/)).toBeNull();
  });
});
