/** @vitest-environment jsdom */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { toISODate, addDaysISO } from '../../utils/eventDateTime';

const create = vi.hoisted(() => vi.fn().mockResolvedValue({ id: 'event', status: 'PUBLISHED' }));
vi.mock('@shared/api/apiClient', () => ({ getMediaUrl: (v) => v }));
vi.mock('@shared/utils/mediaPipeline', () => ({ processAndUploadImage: vi.fn() }));
vi.mock('@shared/utils/toast', () => ({ showToast: vi.fn() }));
vi.mock('@shared/hooks/useOverlayBack', () => ({ useOverlayBack: () => {} }));
vi.mock('@shared/hooks/useScrollLock', () => ({ useScrollLock: () => {} }));
vi.mock('@shared/hooks/useCampusEvents', () => ({
  useCreateCampusEvent: () => ({ mutateAsync: create }),
  useUpdateCampusEvent: () => ({}),
  usePublishCampusEvent: () => ({}),
}));

import CampusEventForm from '../CampusEventForm';

afterEach(() => {
  cleanup();
  create.mockClear();
});

const tomorrow = addDaysISO(toISODate(new Date()), 1);
const inThreeDays = addDaysISO(toISODate(new Date()), 3);

const fillText = (label, value) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

/** Types into a time box and presses Enter, the way a person would. */
const typeTime = (label, value) => {
  const box = screen.getByLabelText(label);
  fireEvent.focus(box);
  fireEvent.change(box, { target: { value } });
  fireEvent.keyDown(box, { key: 'Enter' });
};

/** Opens a date box and picks a day from its calendar by its full label. */
const pickDate = (label, iso) => {
  fireEvent.click(screen.getByLabelText(label));
  const [y, m, d] = iso.split('-').map(Number);
  const full = new Date(y, m - 1, d).toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  });
  const dialog = screen.getByRole('dialog', { name: 'Choose a date' });
  fireEvent.click(within(dialog).getByRole('button', { name: full }));
};

const fillBasics = () => {
  fillText('Event title *', 'Meet');
  fillText('Hosted by (organizer) *', 'Campus');
  fillText('Venue *', 'Hall');
};

const submit = () => fireEvent.click(screen.getByRole('button', { name: 'Publish event' }));

describe('CampusEventForm - when', () => {
  it('single day: one date, end follows it, exact minutes survive', async () => {
    render(<CampusEventForm onClose={vi.fn()} />);
    fillBasics();
    pickDate('Date', tomorrow);
    typeTime('Starts', '9:07');
    typeTime('Ends', '10:23');
    submit();

    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    const { startTime, endTime } = create.mock.calls[0][0];
    expect(new Date(startTime).getMinutes()).toBe(7);
    expect(new Date(endTime).getMinutes()).toBe(23);
    expect(new Date(endTime).getDate()).toBe(new Date(startTime).getDate());
  });

  it('moving the start moves the end, keeping the length', () => {
    render(<CampusEventForm onClose={vi.fn()} />);
    pickDate('Date', tomorrow);
    typeTime('Starts', '9:00');
    // No end yet: an hour is assumed.
    expect(screen.getByLabelText('Ends').value).toBe('10:00 AM');
    typeTime('Ends', '11:30');
    typeTime('Starts', '10:00');
    expect(screen.getByLabelText('Ends').value).toBe('12:30 PM');
  });

  it('single day refuses an end before the start and points to multi-day', async () => {
    render(<CampusEventForm onClose={vi.fn()} />);
    fillBasics();
    pickDate('Date', tomorrow);
    typeTime('Starts', '10:00 PM');
    typeTime('Ends', '1:00 AM');
    expect(screen.getByText(/Choose Multi-day/)).toBeTruthy();
    submit();
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/End time must be after/));
    expect(create).not.toHaveBeenCalled();
  });

  it('multi-day: separate start and end dates', async () => {
    render(<CampusEventForm onClose={vi.fn()} />);
    fillBasics();
    fireEvent.click(screen.getByRole('radio', { name: 'Multi-day' }));
    pickDate('Start date', tomorrow);
    pickDate('End date', inThreeDays);
    typeTime('Start time', '9:00 AM');
    typeTime('End time', '6:00 PM');
    submit();

    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    const { startTime, endTime } = create.mock.calls[0][0];
    const days = Math.round((new Date(endTime) - new Date(startTime)) / 86400000);
    expect(days).toBe(2);
  });

  it('switching back to single day drops the stale end date', async () => {
    render(<CampusEventForm onClose={vi.fn()} />);
    fillBasics();
    fireEvent.click(screen.getByRole('radio', { name: 'Multi-day' }));
    pickDate('Start date', tomorrow);
    pickDate('End date', inThreeDays);
    fireEvent.click(screen.getByRole('radio', { name: 'Single day' }));
    expect(screen.queryByLabelText('End date')).toBeNull();
    typeTime('Starts', '9:00 AM');
    typeTime('Ends', '10:00 AM');
    submit();

    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    const { startTime, endTime } = create.mock.calls[0][0];
    expect(new Date(endTime).getDate()).toBe(new Date(startTime).getDate());
  });

  it('an end time list only offers later slots, with their length', () => {
    render(<CampusEventForm onClose={vi.fn()} />);
    pickDate('Date', tomorrow);
    typeTime('Starts', '9:00 AM');
    const ends = screen.getByLabelText('Ends');
    fireEvent.focus(ends);
    const options = within(screen.getByRole('listbox')).getAllByRole('option');
    expect(options[0].textContent).toContain('9:15 AM');
    expect(options[0].textContent).toContain('15 min');
  });
});

describe('CampusEventForm - leaving', () => {
  it('plays its exit before it asks to be removed, on every way out', () => {
    vi.useFakeTimers();
    try {
      const onClose = vi.fn();
      render(<CampusEventForm onClose={onClose} />);

      fireEvent.click(screen.getByRole('button', { name: 'Close' }));
      // Still mounted, mid-animation.
      expect(onClose).not.toHaveBeenCalled();
      expect(screen.getByRole('dialog')).toBeTruthy();

      // A second press while leaving does not queue another close.
      fireEvent.click(screen.getByRole('button', { name: 'Close' }));
      vi.advanceTimersByTime(400);
      expect(onClose).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('CampusEventForm - system bars', () => {
  it('keeps the app\'s status bar following the page underneath while open', () => {
    // Sampled through the form, the status bar took the form's colour the
    // moment it mounted, ahead of the sheet reaching the top of the screen.
    render(<CampusEventForm onClose={vi.fn()} />);
    const overlay = screen.getByRole('dialog').parentElement;
    expect(overlay.hasAttribute('data-bars-ignore')).toBe(true);
  });
});

describe('CampusEventForm - phone layout', () => {
  it('fills the screen whether or not the app marks the overlay for the keyboard', () => {
    // CSS modules are not applied in jsdom, so read the source. The overlay is
    // marked `data-keyboard-overlay` in the installed app; its padding must be
    // cleared by a rule that does not depend on that marker.
    const css = readFileSync(resolve(import.meta.dirname, '../CampusEventForm.module.css'), 'utf8');
    const phone = css.slice(css.indexOf('@media (max-width: 768px)'));
    const plainOverlay = phone.match(/(?:^|\n) {2}\.overlay \{([^}]*)\}/)?.[1] ?? '';
    expect(plainOverlay).toMatch(/padding:\s*0\s*;/);
    expect(plainOverlay).toMatch(/align-items:\s*stretch/);
  });
});
