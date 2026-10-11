/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const { auth } = vi.hoisted(() => ({ auth: { currentUser: null } }));
vi.mock('@shared/context/AuthContext', () => ({ useAuth: () => auth }));

import HelpActions from '../HelpActions';

afterEach(cleanup);

function tiles() {
  render(
    <MemoryRouter>
      <HelpActions linkFor={(v) => `/x?view=${v}`} onOpen={vi.fn()} />
    </MemoryRouter>,
  );
  return screen.getByRole('navigation', { name: 'Help actions' });
}

describe('HelpActions', () => {
  it('hides Your requests from a signed-out visitor', () => {
    auth.currentUser = null;
    const nav = tiles();
    expect(nav.getAttribute('data-count')).toBe('3');
    expect(nav.textContent).not.toMatch(/Your requests/);
    expect(nav.textContent).toMatch(/Report a problem/);
    expect(nav.textContent).toMatch(/Share an idea/);
  });

  it('shows Your requests once signed in', () => {
    auth.currentUser = { id: 'u1' };
    const nav = tiles();
    expect(nav.getAttribute('data-count')).toBe('4');
    expect(screen.getByRole('link', { name: /Your requests/ }).getAttribute('href')).toBe('/x?view=requests');
  });
});
