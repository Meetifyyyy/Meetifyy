/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';

/**
 * "Can't find your college? Request it" on the Campus picker. The form posts
 * to the existing POST /api/auth/request-college, whose DTO requires all four
 * fields and forbids any other, so the body is pinned exactly.
 */

const requestCollege = vi.fn();
let currentUser = { id: 'u1', displayName: 'Asha Rao', email: 'asha@gmail.com' };

vi.mock('@shared/api/apiClient', () => ({
  campusAffiliationApi: { requestCollege: (...a) => requestCollege(...a) },
}));
vi.mock('@shared/context/AuthContext', () => ({ useAuth: () => ({ currentUser }) }));
vi.mock('@shared/hooks/useOverlayBack', () => ({ useOverlayBack: () => {} }));
vi.mock('@shared/hooks/useScrollLock', () => ({ useScrollLock: () => {} }));

const { RequestCollegeCard, requestCollegeErrorMessage } = await import('../RequestCollege');

function openForm(props = {}) {
  render(<RequestCollegeCard {...props} />);
  fireEvent.click(screen.getByRole('button', { name: /request it/i }));
  return screen.getByRole('dialog');
}

const field = (label) => screen.getByLabelText(label, { exact: false });

describe('Request your college', () => {
  beforeEach(() => {
    requestCollege.mockReset();
    currentUser = { id: 'u1', displayName: 'Asha Rao', email: 'asha@gmail.com' };
  });
  afterEach(cleanup);

  it('shows the account name and email read-only and prefills the searched name', () => {
    openForm({ initialName: 'Hill College' });
    expect(screen.getByText('Asha Rao')).toBeTruthy();
    expect(screen.getByText('asha@gmail.com')).toBeTruthy();
    expect(screen.queryByLabelText(/your name/i)).toBeNull();
    expect(field('College name').value).toBe('Hill College');
  });

  it('validates before sending', async () => {
    openForm();
    fireEvent.change(field('College name'), { target: { value: 'ab' } });
    fireEvent.change(field('Your college email'), { target: { value: 'not-an-email' } });
    fireEvent.click(screen.getByRole('button', { name: /send request/i }));

    expect(await screen.findByText(/3 to 120 characters/)).toBeTruthy();
    expect(screen.getByText(/address your college gave you/)).toBeTruthy();
    expect(requestCollege).not.toHaveBeenCalled();
  });

  it('sends exactly the DTO fields and shows the success state', async () => {
    requestCollege.mockResolvedValue({ success: true });
    openForm();
    fireEvent.change(field('College name'), { target: { value: '  Hill College ' } });
    fireEvent.change(field('Your college email'), { target: { value: 'Asha@Hill.AC.in ' } });
    fireEvent.click(screen.getByRole('button', { name: /send request/i }));

    await waitFor(() => expect(requestCollege).toHaveBeenCalledTimes(1));
    expect(requestCollege).toHaveBeenCalledWith({
      name: 'Asha Rao',
      collegeName: 'Hill College',
      collegeEmail: 'asha@hill.ac.in',
      personalEmail: 'asha@gmail.com',
    });
    expect(await screen.findByText(/We.ll let you know at/)).toBeTruthy();
    expect(screen.getByText(/Hill College is added/)).toBeTruthy();
  });

  it('asks for name and email when the account has none to offer', async () => {
    currentUser = { id: 'u1', email: 'x@meetifyy.user' };
    requestCollege.mockResolvedValue({ success: true });
    openForm();
    fireEvent.change(field('Your name'), { target: { value: 'Ravi K' } });
    fireEvent.change(field('Your email'), { target: { value: 'ravi@mail.com' } });
    fireEvent.change(field('College name'), { target: { value: 'Hill College' } });
    fireEvent.change(field('Your college email'), { target: { value: 'ravi@hill.edu' } });
    fireEvent.click(screen.getByRole('button', { name: /send request/i }));

    await waitFor(() => expect(requestCollege).toHaveBeenCalled());
    expect(requestCollege.mock.calls[0][0]).toMatchObject({ name: 'Ravi K', personalEmail: 'ravi@mail.com' });
  });

  it('shows the rate-limit message on 429 and keeps the form', async () => {
    requestCollege.mockRejectedValue(Object.assign(new Error('Too many'), { status: 429 }));
    openForm();
    fireEvent.change(field('College name'), { target: { value: 'Hill College' } });
    fireEvent.change(field('Your college email'), { target: { value: 'a@hill.edu' } });
    fireEvent.click(screen.getByRole('button', { name: /send request/i }));

    expect((await screen.findByRole('alert')).textContent).toMatch(/already sent a few requests/);
    expect(screen.getByRole('button', { name: /send request/i })).toBeTruthy();
  });

  it('keeps technical errors off the screen', () => {
    expect(requestCollegeErrorMessage({ status: 500, message: 'Internal' })).toMatch(/Couldn't send/);
    expect(requestCollegeErrorMessage({ status: 400, message: 'API error 400' })).toMatch(/Couldn't send/);
    expect(requestCollegeErrorMessage({ status: 400, message: ['College name is required'] })).toBe(
      'College name is required',
    );
    expect(requestCollegeErrorMessage(new TypeError('Failed to fetch'))).toMatch(/Couldn't send/);
  });
});
