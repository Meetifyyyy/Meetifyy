/** @vitest-environment jsdom */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

let completion;
vi.mock('@shared/context/AuthContext', () => ({
  useAuth: () => ({ currentUser: { id: 'u1', profileCompletion: completion } }),
}));

import ActionDot from '../ActionDot';
import { useProfileActionNeeded } from '@shared/hooks/useProfileActionNeeded';

function Probe() {
  const a = useProfileActionNeeded();
  return (
    <div>
      <span>Settings</span>
      {a.any && <ActionDot />}
      {a.needsPersonalEmail && <span>Add a personal email</span>}
      {a.needsGender && <span>Add your gender</span>}
    </div>
  );
}

afterEach(cleanup);

describe('ActionDot', () => {
  it('is non-numeric and carries visually hidden text, not colour alone', () => {
    render(<ActionDot />);
    const dot = screen.getByTestId('action-dot');
    expect(dot.textContent).toBe('(action needed)');
    expect(dot.textContent).not.toMatch(/\d/);
  });
});

describe('dot conditions follow the flags, regardless of snooze', () => {
  it('shows for needsGender even when the prompt is snoozed', () => {
    completion = { needsGender: true, needsPersonalEmail: false, promptSnoozed: true };
    render(<Probe />);
    expect(screen.getByTestId('action-dot')).not.toBeNull();
    expect(screen.getByText('Add your gender')).not.toBeNull();
    expect(screen.queryByText('Add a personal email')).toBeNull();
  });

  it('shows the email prompt for needsPersonalEmail only', () => {
    completion = { needsGender: false, needsPersonalEmail: true };
    render(<Probe />);
    expect(screen.getByText('Add a personal email')).not.toBeNull();
    expect(screen.queryByText('Add your gender')).toBeNull();
  });

  it('disappears once both flags are cleared', () => {
    completion = { needsGender: false, needsPersonalEmail: false, promptSnoozed: false };
    render(<Probe />);
    expect(screen.queryByTestId('action-dot')).toBeNull();
  });

  it('is absent for an older payload with no profileCompletion', () => {
    completion = undefined;
    render(<Probe />);
    expect(screen.queryByTestId('action-dot')).toBeNull();
  });
});
