/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
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
  relate: vi.fn(),
  unrelate: vi.fn(),
  remove: vi.fn(),
}));

vi.mock('@shared/api/apiClient', () => ({ confessionsApi: api }));
vi.mock('@shared/context/AuthContext', () => ({
  useAuth: () => ({ isLoggedIn: true, currentUser: { id: 'me', username: 'me' }, refreshCurrentUser: vi.fn() }),
}));
vi.mock('@shared/hooks/useCampusAffiliation', () => ({
  useHasCampusAccess: () => true,
  useCampusDeniedHandler: () => () => {},
  useCampusAffiliation: () => ({ isActive: true, affiliation: { collegeName: 'GLA University' } }),
}));
vi.mock('@features/campus/components/affiliation/CampusAffiliationGate', () => ({ default: ({ children }) => children }));
vi.mock('@shared/hooks/useSmartBack', () => ({ useSmartBack: () => vi.fn() }));
vi.mock('@shared/utils/toast', () => ({ showToast: vi.fn() }));
vi.mock('@shared/components/modals/ReportModal/LazyReportModal', () => ({
  default: ({ isOpen, targetType, targetId }) => (isOpen ? <div data-testid="report">{targetType}:{targetId}</div> : null),
}));

const { default: ConfessionsPage } = await import('../pages/ConfessionsPage');

const C = (over = {}) => ({
  id: 'c1', handle: 'lunar.koi', content: 'I still haven’t found the third floor.',
  createdAt: new Date().toISOString(), relateCount: 3, relatedByMe: false, isMine: false, ...over,
});

const renderPage = () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
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
    fireEvent.change(area, { target: { value: 'short' } });
    expect(post.disabled).toBe(true);
    fireEvent.change(area, { target: { value: '  A brand new confession here.  ' } });
    fireEvent.click(post);
    await waitFor(() => expect(api.create).toHaveBeenCalledWith('A brand new confession here.'));
    await waitFor(() => expect(screen.queryByLabelText('Your confession')).toBeNull());
    const cards = screen.getAllByRole('article');
    expect(within(cards[0]).getByText('A brand new confession here.')).toBeTruthy();
    expect(within(cards[0]).getByText('You')).toBeTruthy();
  });

  it('relates at once and rolls back if the server refuses', async () => {
    let refuse;
    api.relate.mockImplementationOnce(() => new Promise((_, reject) => { refuse = reject; }));
    renderPage();
    const card = (await screen.findByText('@lunar.koi')).closest('article');
    fireEvent.click(within(card).getByRole('button', { name: /Relate/ }));
    // Shown before the server has answered.
    expect(await within(card).findByText('Related')).toBeTruthy();
    expect(within(card).getByText('4')).toBeTruthy();
    refuse(Object.assign(new Error('nope'), { status: 500 }));
    await waitFor(() => expect(within(card).getByText('Relate')).toBeTruthy());
    expect(within(card).getByText('3')).toBeTruthy();
  });

  it('sends one request for a double tap on Relate', async () => {
    let finish;
    api.relate.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    renderPage();
    const card = (await screen.findByText('@lunar.koi')).closest('article');
    const button = within(card).getByRole('button', { name: /Relate/ });
    fireEvent.click(button);
    fireEvent.click(button);
    await within(card).findByText('Related');
    expect(api.relate).toHaveBeenCalledTimes(1);
    expect(api.unrelate).not.toHaveBeenCalled();
    finish({ relateCount: 4, relatedByMe: true });
    await waitFor(() => expect(within(card).getByText('4')).toBeTruthy());
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
  it('draws the deck at once for someone the device has never seen', () => {
    api.getMe.mockReturnValue(new Promise(() => {}));
    renderPage();
    // Synchronously, in the first render: no spinner first.
    expect(screen.getByText('01')).toBeTruthy();
    expect(screen.queryByLabelText('Loading')).toBeNull();
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

  it('switches the deck to the feed in place when the server says there is a name', async () => {
    api.getMe.mockResolvedValue({ profile: { handle: 'lunar.koi' } });
    renderPage();
    expect(screen.getByText('01')).toBeTruthy();
    expect((await screen.findAllByText('@lunar.koi')).length).toBeGreaterThan(0);
  });
});
