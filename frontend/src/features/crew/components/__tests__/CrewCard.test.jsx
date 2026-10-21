/** @vitest-environment jsdom */
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

vi.mock('@shared/api/apiClient', () => ({ getMediaUrl: (key) => key }));
vi.mock('@shared/stores/savedActivitiesStore', () => ({
  useSavedActivitiesStore: (select) => select({ savedActivities: [], toggleSaveActivity: vi.fn() }),
}));
// The two dialogs open from the card's menu. Each renders a button so a press
// inside a dialog can be checked against the card behind it.
vi.mock('../modals/ShareActivityModal', () => ({
  default: () => <button type="button">inside share dialog</button>,
}));
vi.mock('@shared/components/modals/ReportModal/ReportModal', () => ({
  default: () => <button type="button">inside report dialog</button>,
}));

import CrewCard from '../cards/CrewCard';

afterEach(cleanup);

const activity = {
  id: 'act-1',
  title: 'Sunday run',
  startDate: '2030-01-05T06:00:00.000Z',
  visibility: 'COLLEGE_ONLY',
  collegeName: 'Example College',
  members: [],
};

function renderCard() {
  const onClick = vi.fn();
  render(<CrewCard activity={activity} onClick={onClick} />);
  return onClick;
}

it('opens the activity when the card is pressed', () => {
  const onClick = renderCard();
  fireEvent.click(screen.getByRole('heading', { name: 'Sunday run' }));
  expect(onClick).toHaveBeenCalledWith('act-1');
});

it('does not open the activity when the three-dot menu is used', async () => {
  const onClick = renderCard();
  fireEvent.click(screen.getByRole('button', { name: 'More options' }));
  fireEvent.click(await screen.findByRole('menuitem', { name: /share/i }));
  expect(onClick).not.toHaveBeenCalled();
});

it('does not open the activity when a press lands inside its share or report dialog', async () => {
  const onClick = renderCard();

  fireEvent.click(screen.getByRole('button', { name: 'More options' }));
  fireEvent.click(await screen.findByRole('menuitem', { name: /share/i }));
  fireEvent.click(await screen.findByRole('button', { name: 'inside share dialog' }));

  fireEvent.click(screen.getByRole('button', { name: 'More options' }));
  fireEvent.click(await screen.findByRole('menuitem', { name: /report/i }));
  fireEvent.click(await screen.findByRole('button', { name: 'inside report dialog' }));

  expect(onClick).not.toHaveBeenCalled();
});

it('shows no college tag, even for a college-only activity', () => {
  renderCard();
  expect(screen.queryByText('Example College')).toBeNull();
});
