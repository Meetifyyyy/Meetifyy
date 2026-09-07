/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import MessagingRestrictedModal from '../MessagingRestrictedModal';

vi.mock('@shared/hooks/useOverlayBack', () => ({
  useOverlayBack: () => {},
}));
vi.mock('@shared/hooks/useScrollLock', () => ({
  useScrollLock: () => {},
}));

/**
 * The dialog a locked Message button opens.
 *
 * The behaviours worth protecting are the ones that would make it a liability
 * rather than an explanation: wrong copy, a dialog with no way out, and — most
 * importantly — a dialog that does something.
 */
describe('<MessagingRestrictedModal>', () => {
  afterEach(cleanup);

  it('shows the title and the explanation', () => {
    render(<MessagingRestrictedModal onClose={() => {}} />);

    expect(screen.getByText('Messaging Restricted')).toBeTruthy();
    expect(
      screen.getByText(
        'Direct messaging between first-year students and students from other ' +
          'years is temporarily restricted to help keep first-year students safe.',
      ),
    ).toBeTruthy();
  });

  it('is announced as a modal dialog labelled by its own title', () => {
    render(<MessagingRestrictedModal onClose={() => {}} />);

    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.getAttribute('aria-labelledby')).toBe(
      'messaging-restricted-title',
    );
    expect(dialog.getAttribute('aria-describedby')).toBe(
      'messaging-restricted-desc',
    );
  });

  it('moves focus to the dismiss button, so a keyboard user lands on the way out', () => {
    render(<MessagingRestrictedModal onClose={() => {}} />);
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: 'Got it' }),
    );
  });

  it('offers exactly one action — it explains, it does not ask', () => {
    render(<MessagingRestrictedModal onClose={() => {}} />);
    expect(screen.getAllByRole('button')).toHaveLength(1);
  });

  it('dismisses on the button', () => {
    vi.useFakeTimers();
    const onClose = vi.fn();
    render(<MessagingRestrictedModal onClose={onClose} />);

    fireEvent.click(screen.getByRole('button', { name: 'Got it' }));
    vi.advanceTimersByTime(300);

    expect(onClose).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('dismisses on Escape', () => {
    vi.useFakeTimers();
    const onClose = vi.fn();
    render(<MessagingRestrictedModal onClose={onClose} />);

    fireEvent.keyDown(screen.getByRole('dialog').parentElement, {
      key: 'Escape',
    });
    vi.advanceTimersByTime(300);

    expect(onClose).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('renders nothing when not visible', () => {
    render(<MessagingRestrictedModal visible={false} onClose={() => {}} />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('does not name either cohort, so it reads identically in both directions', () => {
    render(<MessagingRestrictedModal onClose={() => {}} />);
    const text = screen.getByRole('dialog').textContent;
    expect(text).not.toMatch(/\b20\d{2}\b/);
    expect(text).not.toMatch(/first-year student\b(?!s)/);
  });
});
