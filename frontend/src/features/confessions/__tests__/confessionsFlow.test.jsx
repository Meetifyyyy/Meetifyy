/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

/**
 * Confessions end to end in the client: first visit (deck, then the name),
 * a returning visit (straight to the feed), and the feed's own actions. The
 * API is the only thing faked; the hooks and query cache are the real ones.
 */
globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
if (!window.matchMedia) window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });

const api = vi.hoisted(() => ({
  getMe: vi.fn(),
  checkHandle: vi.fn(),
  createProfile: vi.fn(),
  list: vi.fn(),
  create: vi.fn(),
  get: vi.fn(),
  react: vi.fn(),
  unreact: vi.fn(),
  remove: vi.fn(),
}));

vi.mock('@shared/api/apiClient', () => ({ confessionsApi: api }));
vi.mock('@shared/context/AuthContext', () => ({
  useAuth: () => ({
    isLoggedIn: true,
    currentUser: { id: 'me', username: 'me', displayName: 'Priya Sharma', email: 'priya.sharma@gla.ac.in' },
    refreshCurrentUser: vi.fn(),
  }),
}));
vi.mock('@shared/hooks/useCampusAffiliation', () => ({
  useHasCampusAccess: () => true,
  useCampusDeniedHandler: () => () => {},
  useCampusAffiliation: () => ({ isActive: true, affiliation: { collegeName: 'GLA University' } }),
}));
vi.mock('@features/campus/components/affiliation/CampusAffiliationGate', () => ({ default: ({ children }) => children }));
vi.mock('@shared/hooks/useSmartBack', () => ({ useSmartBack: () => vi.fn() }));
vi.mock('@shared/utils/toast', () => ({ showToast: vi.fn() }));
vi.mock('@shared/components/share/ShareSheet', () => ({
  default: ({ isOpen, kind, entity }) => (isOpen ? <div data-testid="share">{kind}:{entity?.id}</div> : null),
}));
vi.mock('@shared/components/modals/ReportModal/LazyReportModal', () => ({
  default: ({ isOpen, targetType, targetId }) => (isOpen ? <div data-testid="report">{targetType}:{targetId}</div> : null),
}));

const { default: ConfessionsPage } = await import('../pages/ConfessionsPage');

const counts = (over = {}) => ({ love: 0, funny: 0, sad: 0, surprised: 0, relatable: 0, ...over });
const C = (over = {}) => ({
  id: 'c1', handle: 'lunar.koi', content: 'I still haven’t found the third floor.',
  createdAt: new Date().toISOString(), isMine: false,
  reactions: counts({ love: 2, funny: 1 }), reactionCount: 3, myReaction: null, relateCount: 3, relatedByMe: false,
  ...over,
});
/** What the server answers a reaction request with. */
const S = (myReaction, over = {}) => {
  const reactions = counts(over);
  const total = Object.values(reactions).reduce((a, b) => a + b, 0);
  return { reactions, reactionCount: total, myReaction, relateCount: total, relatedByMe: myReaction !== null };
};

const newClient = () => new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });

const renderPage = (qc = newClient()) => {
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter><ConfessionsPage /></MemoryRouter>
    </QueryClientProvider>,
  );
};

const typeHandle = (value) => {
  fireEvent.change(screen.getByLabelText('Anonymous name'), { target: { value } });
};

beforeEach(() => {
  Object.values(api).forEach((fn) => fn.mockReset());
  window.localStorage.clear();
  api.list.mockResolvedValue({ confessions: [C()], nextCursor: null });
});

afterEach(() => {
  cleanup();
});

describe('first visit', () => {
  beforeEach(() => {
    api.getMe.mockResolvedValue({ profile: null });
  });

  it('shows the three-slide deck, then the name screen, and remembers the deck was seen', async () => {
    renderPage();
    expect(await screen.findByText('01')).toBeTruthy();
    const headings = screen.getAllByRole('heading', { level: 2, hidden: true }).map((h) => h.textContent.trim());
    expect(headings).toEqual(['Say it, no name.', 'One name. Only yours.', 'You’re not alone.']);

    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    fireEvent.click(screen.getByRole('button', { name: /Choose your name/ }));

    expect(await screen.findByLabelText('Anonymous name')).toBeTruthy();
    expect(window.localStorage.getItem('meetifyy:confessions:deck-seen:me')).toBe('1');
    // The feed is not asked for until there is a profile.
    expect(api.list).not.toHaveBeenCalled();
  });

  it('can skip the deck', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Skip' }));
    expect(await screen.findByLabelText('Anonymous name')).toBeTruthy();
  });

  it('still shows the deck to another account on the same device', async () => {
    window.localStorage.setItem('meetifyy:confessions:deck-seen:someone-else', '1');
    renderPage();
    expect(await screen.findByRole('button', { name: 'Skip' })).toBeTruthy();
  });

  it('goes straight to the name once the deck has been seen', async () => {
    window.localStorage.setItem('meetifyy:confessions:deck-seen:me', '1');
    renderPage();
    expect(await screen.findByLabelText('Anonymous name')).toBeTruthy();
    expect(screen.queryByText('Speak')).toBeNull();
  });
});

describe('choosing the name', () => {
  beforeEach(() => {
    window.localStorage.setItem('meetifyy:confessions:deck-seen:me', '1');
    api.getMe.mockResolvedValue({ profile: null });
  });

  it('flags a malformed name locally without asking the server', async () => {
    renderPage();
    await screen.findByLabelText('Anonymous name');
    typeHandle('1abc');
    expect(screen.getByText('Start with a letter.')).toBeTruthy();
    await new Promise((r) => setTimeout(r, 450));
    expect(api.checkHandle).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Slip in unseen' }).disabled).toBe(true);
  });

  it('shows a taken name as taken and keeps the button off', async () => {
    api.checkHandle.mockResolvedValue({ handle: 'quiet.fox', available: false, reason: 'taken' });
    renderPage();
    await screen.findByLabelText('Anonymous name');
    typeHandle('quiet.fox');
    expect(await screen.findByText('Already taken. Try another.')).toBeTruthy();
    expect(api.checkHandle).toHaveBeenCalledWith('quiet.fox', expect.anything());
    expect(screen.getByRole('button', { name: 'Slip in unseen' }).disabled).toBe(true);
  });

  it('says so when name checks are rate limited', async () => {
    api.checkHandle.mockRejectedValue(Object.assign(new Error('slow down'), { status: 429, code: 'rate_limited' }));
    renderPage();
    await screen.findByLabelText('Anonymous name');
    typeHandle('midnight.moth');
    expect(await screen.findByText(/Checking too fast/)).toBeTruthy();
  });

  it('creates the profile and opens the feed', async () => {
    api.checkHandle.mockResolvedValue({ handle: 'midnight.moth', available: true, reason: null });
    api.createProfile.mockResolvedValue({ profile: { handle: 'midnight.moth', createdAt: new Date().toISOString() } });
    renderPage();
    await screen.findByLabelText('Anonymous name');
    typeHandle('midnight.moth');
    await screen.findByText('It’s yours if you want it.');
    fireEvent.click(screen.getByRole('button', { name: 'Slip in unseen' }));
    expect(await screen.findByText('Write a confession…')).toBeTruthy();
    expect(api.createProfile).toHaveBeenCalledWith('midnight.moth');
    expect(await screen.findByText('@lunar.koi')).toBeTruthy();
  });

  it('shows the server refusing a name taken in the meantime', async () => {
    api.checkHandle.mockResolvedValue({ handle: 'midnight.moth', available: true, reason: null });
    api.createProfile.mockRejectedValue(Object.assign(new Error('taken'), { status: 409, code: 'handle_taken' }));
    renderPage();
    await screen.findByLabelText('Anonymous name');
    typeHandle('midnight.moth');
    await screen.findByText('It’s yours if you want it.');
    fireEvent.click(screen.getByRole('button', { name: 'Slip in unseen' }));
    expect(await screen.findByText('Someone just took that one. Try another.')).toBeTruthy();
  });
});

describe('the feed', () => {
  beforeEach(() => {
    api.getMe.mockResolvedValue({ profile: { handle: 'midnight.moth', createdAt: new Date().toISOString() } });
  });

  it('skips onboarding for someone with a name', async () => {
    renderPage();
    expect(await screen.findByText('@lunar.koi')).toBeTruthy();
    expect(screen.queryByLabelText('Anonymous name')).toBeNull();
    expect(screen.queryByText('Skip')).toBeNull();
  });

  it('posts a confession and puts it at the top', async () => {
    api.create.mockResolvedValue({ confession: C({ id: 'new', handle: 'midnight.moth', content: 'A brand new confession here.', isMine: true, relateCount: 0 }) });
    renderPage();
    await screen.findByText('@lunar.koi');
    fireEvent.click(screen.getByRole('button', { name: /Write a confession/ }));
    const area = await screen.findByLabelText('Your confession');
    const post = screen.getByRole('button', { name: 'Post' });
    fireEvent.change(area, { target: { value: 'fourteen chars' } });
    // Too short: tapping send explains instead of posting.
    fireEvent.click(post);
    expect(await screen.findByText('Write at least 15 characters')).toBeTruthy();
    expect(api.create).not.toHaveBeenCalled();
    fireEvent.change(area, { target: { value: '  A brand new confession here.  ' } });
    fireEvent.click(post);
    await waitFor(() => expect(api.create).toHaveBeenCalledWith('A brand new confession here.'));
    await waitFor(() => expect(screen.queryByLabelText('Your confession')).toBeNull());
    const cards = screen.getAllByRole('article');
    expect(within(cards[0]).getByText('A brand new confession here.')).toBeTruthy();
    expect(within(cards[0]).queryByText('You')).toBeNull();
  });

  /** A card nobody has reacted to yet: the only one with a React button. */
  const fresh = (over = {}) => C({ reactions: counts(), reactionCount: 0, relateCount: 0, ...over });
  const cardOf = async (handle = '@lunar.koi') => (await screen.findByText(handle)).closest('article');
  const summaryOf = (card) => within(card).getByRole('button', { name: /See all reactions/ });
  /** Your reaction, as the summary tells a screen reader; never shown apart. */
  const yours = (card) => /You reacted (\w+)/.exec(summaryOf(card).getAttribute('aria-label'))?.[1] ?? null;

  /**
   * Reacts the way the card offers: the picker when nobody has reacted yet,
   * the counts modal once anybody has.
   */
  const tapReaction = async (card, label) => {
    const react = within(card).queryByRole('button', { name: 'React' });
    if (react) {
      fireEvent.click(react);
      fireEvent.click(within(within(card).getByRole('radiogroup')).getByRole('radio', { name: label }));
      return;
    }
    fireEvent.click(summaryOf(card));
    const dialog = await screen.findByRole('dialog', { name: 'Reactions' });
    fireEvent.click(within(dialog).getByRole('button', { name: new RegExp(`^${label},`) }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  };

  it('offers a React button and the five, labelled, only while nobody has reacted', async () => {
    api.list.mockResolvedValue({ confessions: [fresh()], nextCursor: null });
    renderPage();
    const card = await cardOf();
    const react = within(card).getByRole('button', { name: 'React' });
    expect(react.textContent).toBe('React');
    expect(within(card).queryByRole('button', { name: /See all reactions/ })).toBeNull();
    fireEvent.click(react);
    const picker = within(card).getByRole('radiogroup', { name: 'Choose a reaction' });
    expect(within(picker).getAllByRole('radio').map((r) => r.textContent)).toEqual([
      '❤️Love', '😂Funny', '😢Sad', '😮Surprised', '🤝Relatable',
    ]);
    fireEvent.keyDown(picker, { key: 'Escape' });
    expect(within(card).queryByRole('radiogroup')).toBeNull();
  });

  it('once there are reactions, shows only what everybody chose, never yours apart', async () => {
    api.list.mockResolvedValue({ confessions: [C({ myReaction: 'love', relatedByMe: true })], nextCursor: null });
    renderPage();
    const card = await cardOf();
    expect(within(card).queryByRole('button', { name: 'React' })).toBeNull();
    expect(within(card).queryByRole('radiogroup')).toBeNull();
    // The summary is the whole control: each kind present and the total.
    expect(summaryOf(card).textContent).toBe('❤️😂3');
    expect(yours(card)).toBe('Love');
  });

  it('lists every kind present, all five once all are there', async () => {
    api.list.mockResolvedValue({
      confessions: [C({ reactions: counts({ love: 1, funny: 4, sad: 2, surprised: 1, relatable: 3 }), reactionCount: 11 })],
      nextCursor: null,
    });
    renderPage();
    expect(summaryOf(await cardOf()).textContent).toBe('😂🤝😢❤️😮11');
  });

  it('opens every kind’s count, most first, from the summary', async () => {
    api.list.mockResolvedValue({
      confessions: [C({ reactions: counts({ love: 2, funny: 5, sad: 1 }), reactionCount: 8 })],
      nextCursor: null,
    });
    renderPage();
    fireEvent.click(summaryOf(await cardOf()));
    const dialog = await screen.findByRole('dialog', { name: 'Reactions' });
    expect(within(dialog).getByRole('heading', { name: 'Reactions' }).nextSibling.textContent).toBe('8 reactions');
    // Left to right, highest first; equal counts keep the picker's order.
    expect(within(dialog).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      '😂5Funny', '❤️2Love', '😢1Sad', '😮0Surprised', '🤝0Relatable',
    ]);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('reacts, changes and takes back from the counts modal', async () => {
    api.list.mockResolvedValue({
      confessions: [C({ reactions: counts({ love: 2, funny: 5 }), reactionCount: 7 })],
      nextCursor: null,
    });
    api.react.mockImplementation((_id, r) => Promise.resolve(S(r, { love: 2, funny: 5, [r]: (r === 'love' ? 3 : r === 'funny' ? 6 : 1) })));
    api.unreact.mockResolvedValue(S(null, { love: 2, funny: 5 }));
    renderPage();
    const card = await cardOf();
    // A kind nobody has chosen yet can still be chosen there.
    await tapReaction(card, 'Sad');
    await waitFor(() => expect(yours(card)).toBe('Sad'));
    await waitFor(() => expect(api.react).toHaveBeenCalledWith('c1', 'sad'));
    await waitFor(() => expect(within(card).getByTitle('8 reactions: 5 Funny, 2 Love, 1 Sad')).toBeTruthy());

    // Another kind changes it: one count moves, the total stays.
    await tapReaction(card, 'Love');
    expect(await within(card).findByTitle('8 reactions: 5 Funny, 3 Love')).toBeTruthy();
    await waitFor(() => expect(api.react).toHaveBeenLastCalledWith('c1', 'love'));

    // Your own again takes it back.
    fireEvent.click(summaryOf(card));
    const dialog = await screen.findByRole('dialog', { name: 'Reactions' });
    const love = within(dialog).getByRole('button', { name: /^Love, 3/ });
    expect(love.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(love);
    await waitFor(() => expect(api.unreact).toHaveBeenCalledWith('c1'));
    await waitFor(() => expect(yours(card)).toBeNull());
    expect(within(card).getByTitle('7 reactions: 5 Funny, 2 Love')).toBeTruthy();
  });

  it('taking back the only reaction fades the summary out as it was, then shows React', async () => {
    api.list.mockResolvedValue({
      confessions: [C({ reactions: counts({ funny: 1 }), reactionCount: 1, relateCount: 1, myReaction: 'funny', relatedByMe: true })],
      nextCursor: null,
    });
    api.unreact.mockResolvedValue(S(null));
    renderPage();
    const card = await cardOf();
    fireEvent.click(summaryOf(card));
    const dialog = await screen.findByRole('dialog', { name: 'Reactions' });
    fireEvent.click(within(dialog).getByRole('button', { name: /^Funny, 1/ }));
    // The modal closes first; then the summary leaves showing 1, never 0.
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const leaving = summaryOf(card);
    expect(leaving.hasAttribute('data-leaving')).toBe(true);
    expect(leaving.textContent).toBe('😂1');
    expect(await within(card).findByRole('button', { name: 'React' })).toBeTruthy();
    await waitFor(() => expect(api.unreact).toHaveBeenCalledWith('c1'));
  });

  it('shows the anonymous name’s first letter as its avatar', async () => {
    renderPage();
    const card = await cardOf();
    expect(within(card).getByText('L')).toBeTruthy();
    expect(card.querySelector('svg[shape-rendering]')).toBeNull();
  });

  it('a first reaction shows at once and rolls back if the server refuses', async () => {
    api.list.mockResolvedValue({ confessions: [fresh()], nextCursor: null });
    let refuse;
    api.react.mockImplementationOnce(() => new Promise((_, reject) => { refuse = reject; }));
    renderPage();
    const card = await cardOf();
    await tapReaction(card, /Sad/);
    // Before the server has answered: the button gives way to the summary.
    expect(within(card).queryByRole('radiogroup')).toBeNull();
    expect(await within(card).findByTitle('1 reaction: 1 Sad')).toBeTruthy();
    expect(yours(card)).toBe('Sad');
    expect(within(card).queryByRole('button', { name: 'React' })).toBeNull();
    await waitFor(() => expect(api.react).toHaveBeenCalledWith('c1', 'sad'));
    await act(async () => refuse(Object.assign(new Error('nope'), { status: 500 })));
    expect(await within(card).findByRole('button', { name: 'React' })).toBeTruthy();
    expect(within(card).queryByRole('button', { name: /See all reactions/ })).toBeNull();
  });

  it('sends each choice made in turn, ending on the last', async () => {
    api.react.mockImplementation((_id, r) => Promise.resolve(S(r, { love: 2, funny: 1, [r]: r === 'love' ? 3 : 1 })));
    renderPage();
    const card = await cardOf();
    await tapReaction(card, 'Sad');
    await waitFor(() => expect(yours(card)).toBe('Sad'));
    await tapReaction(card, 'Love');
    await waitFor(() => expect(yours(card)).toBe('Love'));
    await waitFor(() => expect(api.react).toHaveBeenLastCalledWith('c1', 'love'));
    await waitFor(() => expect(within(card).getByTitle('4 reactions: 3 Love, 1 Funny')).toBeTruthy());
    expect(api.unreact).not.toHaveBeenCalled();
  });

  it('holds taps made while a request is in flight and sends only the last', async () => {
    const finish = [];
    api.react.mockImplementation((_id, r) => new Promise((resolve) => { finish.push(() => resolve(S(r, { love: 2, funny: 1, [r]: r === 'love' ? 3 : 1 }))); }));
    renderPage();
    const card = await cardOf();
    await tapReaction(card, 'Sad');
    await waitFor(() => expect(api.react).toHaveBeenCalledTimes(1));
    await tapReaction(card, 'Surprised');
    await waitFor(() => expect(yours(card)).toBe('Surprised'));
    await tapReaction(card, 'Love');
    await waitFor(() => expect(yours(card)).toBe('Love'));
    expect(api.react).toHaveBeenCalledTimes(1);
    await act(async () => finish[0]());
    // The first answer does not flash back to Sad: the next is already due.
    expect(yours(card)).toBe('Love');
    await waitFor(() => expect(api.react).toHaveBeenCalledTimes(2));
    expect(api.react.mock.calls.map((c) => c[1])).toEqual(['sad', 'love']);
    await act(async () => finish[1]());
    await waitFor(() => expect(within(card).getByTitle('4 reactions: 3 Love, 1 Funny')).toBeTruthy());
  });

  it('keeps the reaction when a feed refetch from before it lands afterwards', async () => {
    const qc = newClient();
    let finishReact;
    api.react.mockImplementation(() => new Promise((resolve) => { finishReact = () => resolve(S('sad', { love: 2, funny: 1, sad: 1 })); }));
    renderPage(qc);
    const card = await cardOf();
    await tapReaction(card, 'Sad');
    await waitFor(() => expect(api.react).toHaveBeenCalledTimes(1));
    // A refetch starts now, and its (older) answer lands after the reaction.
    let finishList;
    api.list.mockImplementation(() => new Promise((resolve) => { finishList = () => resolve({ confessions: [C()], nextCursor: null }); }));
    act(() => { void qc.refetchQueries({ queryKey: ['confessions', 'feed'] }); });
    await waitFor(() => expect(finishList).toBeTypeOf('function'));
    await act(async () => finishReact());
    await act(async () => finishList());
    await waitFor(() => expect(yours(card)).toBe('Sad'));
    expect(within(card).getByTitle('4 reactions: 2 Love, 1 Funny, 1 Sad')).toBeTruthy();
  });

  it('drops a confession that has gone when reacting to it', async () => {
    api.react.mockRejectedValue(Object.assign(new Error('gone'), { status: 404 }));
    renderPage();
    await tapReaction(await cardOf(), 'Love');
    await waitFor(() => expect(screen.queryByText('@lunar.koi')).toBeNull());
  });

  it('opens the share sheet for a confession', async () => {
    renderPage();
    const card = (await screen.findByText('@lunar.koi')).closest('article');
    fireEvent.click(within(card).getByRole('button', { name: 'Share confession' }));
    expect((await screen.findByTestId('share')).textContent).toBe('confession:c1');
  });

  it('reports someone else’s confession as a CONFESSION', async () => {
    renderPage();
    const card = (await screen.findByText('@lunar.koi')).closest('article');
    fireEvent.click(within(card).getByRole('button', { name: 'More options' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: /Report/ }));
    expect((await screen.findByTestId('report')).textContent).toBe('CONFESSION:c1');
  });

  it('shows an empty state with a way to start', async () => {
    api.list.mockResolvedValue({ confessions: [], nextCursor: null });
    renderPage();
    expect(await screen.findByText('It’s quiet here. For now.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Write the first one' }));
    expect(await screen.findByLabelText('Your confession')).toBeTruthy();
  });

  it('shows a retry when the feed fails', async () => {
    api.list.mockRejectedValueOnce(Object.assign(new Error('down'), { status: 503 }));
    renderPage();
    expect(await screen.findByText('The confessions didn’t load.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('@lunar.koi')).toBeTruthy();
  });
});

describe('opening without waiting for the server', () => {
  it('never draws the deck before the server has answered', () => {
    api.getMe.mockReturnValue(new Promise(() => {}));
    renderPage();
    // The page's own frame and the feed's placeholders, in the first render.
    expect(screen.getByRole('heading', { name: 'Confessions' })).toBeTruthy();
    expect(screen.getByLabelText('Loading confessions')).toBeTruthy();
    expect(screen.queryByText('01')).toBeNull();
    expect(screen.queryByLabelText('Anonymous name')).toBeNull();
  });

  it('opens on the feed at once for an account the device knows has a name', async () => {
    window.localStorage.setItem('meetifyy:confessions:has-profile:me', '1');
    let answer;
    api.getMe.mockReturnValue(new Promise((r) => { answer = r; }));
    renderPage();
    expect(screen.getByLabelText('Confessions')).toBeTruthy();
    answer({ profile: { handle: 'lunar.koi' } });
    expect((await screen.findAllByText('@lunar.koi')).length).toBeGreaterThan(0);
  });

  it('remembers only whether there is a name, never the name', async () => {
    api.getMe.mockResolvedValue({ profile: { handle: 'lunar.koi' } });
    renderPage();
    await screen.findAllByText('@lunar.koi');
    await waitFor(() => expect(window.localStorage.getItem('meetifyy:confessions:has-profile:me')).toBe('1'));
    expect(JSON.stringify({ ...window.localStorage })).not.toContain('lunar.koi');
  });

  it('a returning account on a new device goes to the feed without the deck ever showing', async () => {
    api.getMe.mockResolvedValue({ profile: { handle: 'lunar.koi' } });
    const { container } = renderPage();
    const seen = [];
    const watch = new MutationObserver(() => { if (container.textContent.includes('Say it, no name.')) seen.push('deck'); });
    watch.observe(container, { childList: true, subtree: true, characterData: true });
    expect((await screen.findAllByText('@lunar.koi')).length).toBeGreaterThan(0);
    watch.disconnect();
    expect(seen).toEqual([]);
    expect(screen.queryByText('01')).toBeNull();
  });

  it('a device that last saw no name still asks before showing the deck', async () => {
    window.localStorage.setItem('meetifyy:confessions:has-profile:me', '0');
    api.getMe.mockResolvedValue({ profile: { handle: 'lunar.koi' } });
    renderPage();
    expect(screen.queryByText('01')).toBeNull();
    expect((await screen.findAllByText('@lunar.koi')).length).toBeGreaterThan(0);
  });

  it('re-asks an old cached "no name" instead of trusting it (named elsewhere since)', async () => {
    const qc = newClient();
    qc.setQueryData(['confessions', 'me'], { profile: null }, { updatedAt: Date.now() - 5 * 60_000 });
    api.getMe.mockResolvedValue({ profile: { handle: 'lunar.koi' } });
    renderPage(qc);
    expect(screen.queryByText('01')).toBeNull();
    expect((await screen.findAllByText('@lunar.koi')).length).toBeGreaterThan(0);
    expect(api.getMe).toHaveBeenCalledTimes(1);
  });

  it('opens on the deck at once from a fresh "no name" fetched on the way in', () => {
    const qc = newClient();
    qc.setQueryData(['confessions', 'me'], { profile: null });
    api.getMe.mockReturnValue(new Promise(() => {}));
    renderPage(qc);
    expect(screen.getByText('01')).toBeTruthy();
    expect(api.getMe).not.toHaveBeenCalled();
  });

  it('keeps the name screen through a background refetch of an aged "no name"', async () => {
    window.localStorage.setItem('meetifyy:confessions:deck-seen:me', '1');
    const qc = newClient();
    qc.setQueryData(['confessions', 'me'], { profile: null });
    renderPage(qc);
    const field = screen.getByLabelText('Anonymous name');
    fireEvent.change(field, { target: { value: 'half.typed' } });
    // What a window-focus refetch does once the answer has aged.
    api.getMe.mockReturnValue(new Promise(() => {}));
    act(() => { qc.invalidateQueries({ queryKey: ['confessions', 'me'] }); });
    await waitFor(() => expect(api.getMe).toHaveBeenCalledTimes(1));
    expect(screen.getByLabelText('Anonymous name')).toBe(field);
    expect(field.value).toBe('half.typed');
    expect(screen.queryByLabelText('Loading confessions')).toBeNull();
  });

  it('never asks again for a profile it already has', async () => {
    const qc = newClient();
    qc.setQueryData(['confessions', 'me'], { profile: { handle: 'lunar.koi' } }, { updatedAt: Date.now() - 60 * 60_000 });
    renderPage(qc);
    expect((await screen.findAllByText('@lunar.koi')).length).toBeGreaterThan(0);
    expect(api.getMe).not.toHaveBeenCalled();
  });
});

describe('privacy warning on the name', () => {
  beforeEach(() => {
    window.localStorage.setItem('meetifyy:confessions:deck-seen:me', '1');
    api.getMe.mockResolvedValue({ profile: null });
    api.checkHandle.mockResolvedValue({ handle: 'x', available: true, reason: null });
  });

  const WARNING = /looks like part of your name or email/;

  it('warns, without blocking, when the name contains part of the real name', async () => {
    renderPage();
    await screen.findByLabelText('Anonymous name');
    typeHandle('priya.writes');
    const warning = await screen.findByText(WARNING);
    // It never repeats the email or the name it matched.
    expect(warning.textContent).not.toMatch(/priya|sharma|gla\.ac\.in/i);
    await screen.findByText('It’s yours if you want it.');
    expect(screen.getByRole('button', { name: 'Slip in unseen' }).disabled).toBe(false);
  });

  it('says nothing for an unrelated name', async () => {
    renderPage();
    await screen.findByLabelText('Anonymous name');
    typeHandle('midnight.moth');
    await screen.findByText('It’s yours if you want it.');
    expect(screen.queryByText(WARNING)).toBeNull();
  });
});

describe('closing while a post is sending', () => {
  it('a post that lands after the sheet closed does not shut the next one', async () => {
    api.getMe.mockResolvedValue({ profile: { handle: 'midnight.moth' } });
    let land;
    api.create.mockImplementation(() => new Promise((r) => { land = r; }));
    renderPage();
    await screen.findByText('@lunar.koi');
    fireEvent.click(screen.getByRole('button', { name: /Write a confession/ }));
    fireEvent.change(await screen.findByLabelText('Your confession'), { target: { value: 'Sent, then closed before it landed.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Post' }));
    // Closed while it is still sending.
    fireEvent.click(screen.getAllByRole('button', { name: 'Close' }).find((b) => b.textContent === ''));
    await waitFor(() => expect(screen.queryByLabelText('Your confession')).toBeNull());
    await act(async () => { land({ confession: C({ id: 'late', content: 'Sent, then closed before it landed.', isMine: true }) }); });
    // Opened again after the post landed: it stays open.
    fireEvent.click(screen.getByRole('button', { name: /Write a confession/ }));
    const area = await screen.findByLabelText('Your confession');
    await new Promise((r) => setTimeout(r, 400));
    expect(screen.getByLabelText('Your confession')).toBe(area);
    expect(area.closest('[data-closing]')).toBeNull();
  });
});

describe('posting twice', () => {
  it('treats "already posted" as posted: the sheet closes and the feed refreshes', async () => {
    api.getMe.mockResolvedValue({ profile: { handle: 'midnight.moth' } });
    api.create.mockRejectedValue(Object.assign(new Error('dup'), { status: 409, code: 'duplicate_confession' }));
    renderPage();
    await screen.findByText('@lunar.koi');
    fireEvent.click(screen.getByRole('button', { name: /Write a confession/ }));
    fireEvent.change(await screen.findByLabelText('Your confession'), { target: { value: 'The retry of a post that went through.' } });
    const listCalls = api.list.mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: 'Post' }));
    await waitFor(() => expect(screen.queryByLabelText('Your confession')).toBeNull());
    await waitFor(() => expect(api.list.mock.calls.length).toBeGreaterThan(listCalls));
  });
});

describe('a link to one confession', () => {
  const renderAt = (path) => render(
    <QueryClientProvider client={newClient()}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/campus/confessions" element={<ConfessionsPage />} />
          <Route path="/campus/confessions/:id" element={<ConfessionsPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );

  beforeEach(() => {
    api.getMe.mockResolvedValue({ profile: { handle: 'midnight.moth', createdAt: '2026-01-01T00:00:00Z' } });
  });

  it('shows the confession first, once, above the feed', async () => {
    api.get.mockResolvedValue({ confession: C({ id: 'c9', handle: 'quiet.fern', content: 'The one from the chat link.' }) });
    api.list.mockResolvedValue({ confessions: [C(), C({ id: 'c9', handle: 'quiet.fern', content: 'The one from the chat link.' })], nextCursor: null });
    renderAt('/campus/confessions/c9');
    await screen.findByText('@lunar.koi');
    expect(api.get).toHaveBeenCalledWith('c9', expect.anything());
    const cards = screen.getAllByRole('article');
    expect(cards).toHaveLength(2);
    expect(within(cards[0]).getByText('@quiet.fern')).toBeTruthy();
  });

  it('says only that it is unavailable when the server will not serve it', async () => {
    api.get.mockRejectedValue(Object.assign(new Error('Confession not found.'), { status: 404 }));
    renderAt('/campus/confessions/c404');
    expect(await screen.findByText('This confession isn’t available')).toBeTruthy();
    expect(api.get).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('link', { name: 'See all confessions' })).toBeTruthy();
  });
});
