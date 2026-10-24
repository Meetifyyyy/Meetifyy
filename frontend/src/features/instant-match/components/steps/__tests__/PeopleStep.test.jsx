/** @vitest-environment jsdom */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

/**
 * The screen Instant Match opens on.
 *
 * What is worth pinning here is that it reports the queue rather than
 * decorating it: whatever the server sends is what appears, and a field nobody
 * filled in produces no line at all. The rows are also asserted to be inert —
 * Instant Match pairs people through the queue, and a pressable row would
 * promise otherwise.
 */

vi.mock('@shared/components/avatar/Avatar', () => ({
  getProcessedAvatarUrl: (key) => (key ? `https://cdn.test/${key}` : ''),
}));
vi.mock('@shared/hooks/useScrollLock', () => ({ useScrollLock: () => {} }));
vi.mock('@shared/hooks/useOverlayBack', () => ({ useOverlayBack: () => {} }));

const { InstantMatchContext } = await import('../../../context/InstantMatchContext');
const { default: PeopleStep } = await import('../PeopleStep');

const person = (overrides = {}) => ({
  user: {
    id: 'u1', username: 'riya', displayName: 'Riya', avatar: null,
    course: 'B.Tech', branch: 'CSE', passingYear: 2028, interests: [], bio: null,
  },
  activity: 'study',
  timePreference: 'now',
  optionalDetail: null,
  area: null,
  joinedAt: Date.now() - 4 * 60 * 1000,
  ...overrides,
});

const requestMatch = vi.fn(async () => true);

const show = (props = {}) =>
  render(
    <InstantMatchContext.Provider value={{ requestMatch, busy: false }}>
      <PeopleStep people={[]} loading={false} error={null} retry={() => {}} {...props} />
    </InstantMatchContext.Provider>,
  );

/** The list sits one tap behind the summary box. */
const openList = () => fireEvent.click(screen.getByRole('button', { name: /searching/i }));

afterEach(cleanup);

describe('PeopleStep', () => {
  it('shows the people the server says are searching, as it described them', () => {
    show({
      people: [person({
        activity: 'coffee',
        timePreference: '30min',
        area: 'cafeteria',
        optionalDetail: 'the one near the gate',
      })],
    });
    openList();

    expect(screen.getByText('Riya')).toBeTruthy();
    expect(screen.getByText('Coffee')).toBeTruthy();
    expect(screen.getByText('In 30 minutes')).toBeTruthy();
    expect(screen.getByText('the one near the gate')).toBeTruthy();
    expect(screen.getByText(/Cafeteria/)).toBeTruthy();
    expect(screen.getByText('waiting 4m')).toBeTruthy();
  });

  it('omits a line entirely when that person gave nothing for it', () => {
    show({ people: [person()] });
    openList();
    // No area was given, so no area is claimed — not "unknown", not a blank.
    expect(screen.queryByText(/📍/)).toBeNull();
  });

  it('folds everyone into one summary before the list is opened', () => {
    show({ people: [person(), person({ user: { ...person().user, id: 'u2', displayName: 'Sana' } })] });
    expect(screen.getByText('Riya and Sana are searching')).toBeTruthy();
    // The rows themselves are one tap away, not on the first screen.
    expect(screen.queryByRole('list', { name: /people searching/i })).toBeNull();
  });

  it('asks before sending a match request, then sends it for that person', () => {
    requestMatch.mockClear();
    const riya = person();
    show({ people: [riya] });
    openList();

    fireEvent.click(screen.getByRole('button', { name: /send a match request to riya/i }));
    // Nothing is sent on the first tap.
    expect(requestMatch).not.toHaveBeenCalled();
    expect(screen.getByRole('alertdialog')).toBeTruthy();
    expect(screen.getByText('Send a match request to @riya?')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /send request/i }));
    expect(requestMatch).toHaveBeenCalledWith(riya);
  });

  it('slides back from the list to the summary', () => {
    show({ people: [person()] });
    openList();
    fireEvent.click(screen.getByRole('button', { name: /^back$/i }));
    expect(screen.getByText('Riya is searching')).toBeTruthy();
  });

  it('says so in a word when the queue is empty', () => {
    show({ people: [] });
    expect(screen.getByText('Nobody yet')).toBeTruthy();
    expect(screen.getByText('Be the first.')).toBeTruthy();
  });

  it('shows a loader — not a list that is not there yet — while it reads', () => {
    show({ people: null, loading: true });
    expect(screen.getByRole('status')).toBeTruthy();
    expect(screen.getByText('Loading who is searching')).toBeTruthy();
    expect(screen.queryByRole('list')).toBeNull();
  });

  it('surfaces a failed read, and offers the read again', () => {
    const retry = vi.fn();
    show({ people: null, error: 'The server is taking too long to respond', retry });

    expect(screen.getByText('The server is taking too long to respond')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(retry).toHaveBeenCalled();
  });
});
