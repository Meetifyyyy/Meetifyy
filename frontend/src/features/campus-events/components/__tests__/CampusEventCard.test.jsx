/** @vitest-environment jsdom */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import CampusEventCard from '../CampusEventCard';

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const baseEvent = {
  id: 'ev-1',
  campusId: 'campus-1',
  title: 'AI Hackathon 2026',
  hostedBy: 'Tech Club',
  eventDate: '2026-10-15T09:00:00.000Z',
  startTime: '2026-10-15T09:00:00.000Z',
  endTime: '2026-10-15T18:00:00.000Z',
  venue: 'Auditorium 1',
  posterUrl: 'https://example.com/poster.jpg',
  registrationUrl: 'https://example.com/register',
  status: 'PUBLISHED',
  creator: {
    id: 'user-1',
    displayName: 'Organizer Rep',
    avatar: 'https://example.com/avatar.jpg',
  },
};

describe('CampusEventCard Component', () => {
  it('renders core event information from real event object', () => {
    const { getByText, getByAltText } = render(
      <MemoryRouter>
        <CampusEventCard event={baseEvent} scope="upcoming" />
      </MemoryRouter>,
    );

    expect(getByText('AI Hackathon 2026')).toBeTruthy();
    expect(getByText('Tech Club')).toBeTruthy();
    expect(getByText('15 OCT')).toBeTruthy();
    expect(getByAltText('AI Hackathon 2026')).toBeTruthy();
  });

  it('omits upcoming, live now, and ended tags on published events and only shows Draft for drafts', () => {
    const { queryByText } = render(
      <MemoryRouter>
        <CampusEventCard event={baseEvent} />
      </MemoryRouter>,
    );
    expect(queryByText('Upcoming')).toBeNull();
    expect(queryByText('Live now')).toBeNull();
    expect(queryByText('Ended')).toBeNull();
    cleanup();

    const draftEvent = { ...baseEvent, status: 'DRAFT' };
    const { getByText: getByTextDraft } = render(
      <MemoryRouter>
        <CampusEventCard event={draftEvent} />
      </MemoryRouter>,
    );
    expect(getByTextDraft('Draft')).toBeTruthy();
  });

  it('navigates to event details page when card is clicked', () => {
    const { getByRole } = render(
      <MemoryRouter>
        <CampusEventCard event={baseEvent} />
      </MemoryRouter>,
    );

    const article = getByRole('article');
    fireEvent.click(article);
    expect(mockNavigate).toHaveBeenCalledWith('/campus/events/ev-1');
  });

  it('renders manage controls only when canManage is true and stops click propagation', () => {
    const onEdit = vi.fn();
    const onDelete = vi.fn();

    const { getByTitle } = render(
      <MemoryRouter>
        <CampusEventCard
          event={baseEvent}
          canManage={true}
          onEdit={onEdit}
          onDelete={onDelete}
        />
      </MemoryRouter>,
    );

    const editBtn = getByTitle('Edit event');
    const deleteBtn = getByTitle('Delete event');
    expect(editBtn).toBeTruthy();
    expect(deleteBtn).toBeTruthy();

    fireEvent.click(editBtn);
    expect(onEdit).toHaveBeenCalledWith(baseEvent);
    expect(mockNavigate).not.toHaveBeenCalled();

    fireEvent.click(deleteBtn);
    expect(onDelete).toHaveBeenCalledWith(baseEvent);
    expect(mockNavigate).not.toHaveBeenCalled();
    cleanup();

    const { queryByTitle: queryByTitleNoManage } = render(
      <MemoryRouter>
        <CampusEventCard event={baseEvent} canManage={false} />
      </MemoryRouter>,
    );
    expect(queryByTitleNoManage('Edit event')).toBeNull();
  });

  it('handles events without poster and without creator gracefully', () => {
    const minimalEvent = {
      ...baseEvent,
      posterUrl: null,
      creator: null,
    };

    const { getByText, queryByAltText } = render(
      <MemoryRouter>
        <CampusEventCard event={minimalEvent} scope="upcoming" />
      </MemoryRouter>,
    );

    expect(getByText('AI Hackathon 2026')).toBeTruthy();
    expect(getByText('Tech Club')).toBeTruthy();
    expect(queryByAltText('AI Hackathon 2026')).toBeNull();
  });
});
