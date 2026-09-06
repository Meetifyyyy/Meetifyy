/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

/**
 * Where the sheet starts, and how the flow leaves and re-enters that screen.
 *
 * The roster is the entry point now, so the wiring worth pinning is the seam
 * between it and the form that already existed: the first thing an idle user
 * sees, the one action that leaves it, and both ways back — since Back at step
 * one used to be absent (there was nothing behind it) and, in the interim, a
 * press that clamped to itself and swallowed the gesture.
 */

const somebody = {
  user: { id: 'u9', username: 'riya', displayName: 'Riya', avatar: null, course: null, branch: null, passingYear: null, interests: [], bio: null },
  activity: 'study', timePreference: 'now', area: null, optionalDetail: null, joinedAt: Date.now(),
};
const listQueue = vi.fn();
const withPeople = () => listQueue.mockResolvedValue({ ok: true, data: { status: 'ok', people: [somebody] } });
const withNobody = () => listQueue.mockResolvedValue({ ok: true, data: { status: 'ok', people: [] } });

vi.mock('../../utils/matchSocketClient', () => ({
  default: { acquire: () => () => {}, listQueue: (...a) => listQueue(...a), on: () => () => {} },
}));
vi.mock('@shared/components/avatar/Avatar', () => ({ getProcessedAvatarUrl: () => '' }));
vi.mock('@shared/hooks/useScrollLock', () => ({ useScrollLock: () => {} }));
vi.mock('@shared/hooks/useOverlayBack', () => ({ useOverlayBack: () => {} }));

const { InstantMatchContext } = await import('../../context/InstantMatchContext');
const { default: InstantMatchSheet } = await import('../InstantMatchSheet');
const { STEP_PEOPLE, STEP_ACTIVITY, STEP_TIME } = await import('../../constants/matchConstants');

const NOOP = () => {};

function renderSheet(overrides = {}) {
  const setStep = vi.fn();
  const value = {
    isVerified: true,
    sheetOpen: true,
    step: STEP_PEOPLE,
    formData: { activity: '', timePreference: '', optionalDetail: '', location: { area: '', gps: null } },
    status: 'idle',
    error: null,
    busy: false,
    connected: true,
    restoring: false,
    recentMatch: null,
    chat: null,
    activeMatch: null,
    closeSheet: NOOP, setStep, updateFormData: NOOP, startSearch: NOOP,
    dismissError: NOOP, cancelSearch: NOOP,
    ...overrides,
  };
  render(
    <InstantMatchContext.Provider value={value}>
      <InstantMatchSheet />
    </InstantMatchContext.Provider>,
  );
  return { setStep };
}

beforeEach(() => { listQueue.mockReset(); withPeople(); });
afterEach(cleanup);

describe('Instant Match sheet entry', () => {
  it('opens on the roster rather than on the first question', async () => {
    renderSheet();
    expect(await screen.findByText('Riya')).toBeTruthy();
    expect(screen.getByText("Who's searching")).toBeTruthy();
    expect(screen.queryByText("What're you up for?")).toBeNull();
    // It is the roster's own read, not the boot state read, that fills it.
    expect(listQueue).toHaveBeenCalled();
  });

  it('drops its heading when there is no list to head', async () => {
    withNobody();
    renderSheet();

    expect(await screen.findByText('Nobody yet')).toBeTruthy();
    // The visible title and its eyebrow go with the list they described…
    expect(screen.queryByText("Who's searching")).toBeNull();
    expect(screen.queryByText('Right now')).toBeNull();
    expect(screen.queryByText('On Instant Match this minute.')).toBeNull();
    // …but the dialog keeps a name for anyone not looking at it.
    expect(screen.getByRole('heading', { name: /who is searching on instant match/i })).toBeTruthy();
  });

  it('shows no progress dots on a screen where nothing is answered', async () => {
    renderSheet();
    await screen.findByText('Riya');
    expect(screen.queryByLabelText('Progress')).toBeNull();
  });

  it('leaves the roster for step one through its one action', async () => {
    const { setStep } = renderSheet();
    await screen.findByText('Riya');
    fireEvent.click(screen.getByRole('button', { name: /find my match/i }));
    expect(setStep).toHaveBeenCalledWith(STEP_ACTIVITY);
  });

  it('gives step one a Back that returns to the roster', () => {
    const { setStep } = renderSheet({ step: STEP_ACTIVITY });
    fireEvent.click(screen.getByRole('button', { name: /^back$/i }));
    expect(setStep).toHaveBeenCalledWith(STEP_PEOPLE);
  });

  it('still walks the form back one question at a time', () => {
    const { setStep } = renderSheet({ step: STEP_TIME, formData: { activity: 'study', timePreference: '', optionalDetail: '', location: { area: '', gps: null } } });
    fireEvent.click(screen.getByRole('button', { name: /^back$/i }));
    expect(setStep).toHaveBeenCalledWith(STEP_ACTIVITY);
  });

  it('does not put the roster behind the boot skeleton — it loads on its own', async () => {
    renderSheet({ restoring: true });
    expect(await screen.findByText('Riya')).toBeTruthy();
    expect(listQueue).toHaveBeenCalled();
  });
});

describe('a result still outranks the roster', () => {
  const candidate = {
    id: 'u2', username: 'ridhima', displayName: 'Ridhima', avatar: null,
    course: 'B.Tech', branch: 'CSE', passingYear: 2028, interests: [], bio: null,
  };

  it('shows the matched panel, not the roster, when a pairing is live', async () => {
    renderSheet({
      step: STEP_PEOPLE,
      status: 'matched',
      recentMatch: { matchId: 'm1', candidate, activity: 'study', chatId: 'c1', matchedAt: Date.now() },
      openMatchChat: NOOP,
      leaveMatch: NOOP,
      matchPartner: candidate,
      chat: null,
    });

    // The panel really is the thing on screen, not an empty body.
    expect(screen.getByText(/Ridhima/)).toBeTruthy();
    expect(screen.queryByText('Riya')).toBeNull();
    // …and the roster's action does not survive underneath it.
    expect(screen.queryByRole('button', { name: /find my match/i })).toBeNull();
  });
});
