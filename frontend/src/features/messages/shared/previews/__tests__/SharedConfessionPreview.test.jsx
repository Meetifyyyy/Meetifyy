/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => ({
  ...(await vi.importActual('react-router-dom')),
  useNavigate: () => mockNavigate,
}));
const api = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@shared/api/apiClient', () => ({ confessionsApi: api }));
vi.mock('@shared/context/AuthContext', () => ({ useAuth: () => ({ isLoggedIn: true, currentUser: { id: 'me' } }) }));
vi.mock('@shared/hooks/useCampusAffiliation', () => ({
  useHasCampusAccess: () => true,
  useCampusDeniedHandler: () => () => {},
}));

const { SharedConfessionPreview } = await import('../SharedConfessionPreview');

const renderCard = (id = 'cf1') => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter><SharedConfessionPreview confessionId={id} /></MemoryRouter>
  </QueryClientProvider>,
);

const confession = {
  id: 'cf1',
  handle: 'quiet.fern',
  content: 'I have never once read the syllabus.',
  createdAt: new Date().toISOString(),
  isMine: false,
  reactions: { love: 0, funny: 4, sad: 0, surprised: 0, relatable: 2 },
  reactionCount: 6,
  myReaction: null,
};

beforeEach(() => {
  api.get.mockReset();
  mockNavigate.mockReset();
});
afterEach(cleanup);

describe('<SharedConfessionPreview>', () => {
  it('looks the confession up by id and shows it under its handle only', async () => {
    api.get.mockResolvedValue({ confession });
    renderCard();
    expect(screen.getByLabelText('Loading confession')).toBeTruthy();
    expect(await screen.findByText('@quiet.fern')).toBeTruthy();
    expect(api.get).toHaveBeenCalledWith('cf1', expect.anything());
    expect(screen.getByText('I have never once read the syllabus.')).toBeTruthy();
    expect(screen.getByText(/Anonymous confession/)).toBeTruthy();
    expect(screen.getByText('6 reactions: 4 Funny, 2 Relatable')).toBeTruthy();
  });

  it('opens the original confession', async () => {
    api.get.mockResolvedValue({ confession });
    renderCard();
    fireEvent.click(await screen.findByRole('link', { name: /Confession by @quiet.fern/ }));
    expect(mockNavigate).toHaveBeenCalledWith('/campus/confessions/cf1', { state: { from: 'chat' } });
  });

  it.each([404, 403])('says only that it is unavailable on a %i, and offers no way in', async (status) => {
    api.get.mockRejectedValue(Object.assign(new Error('nope'), { status }));
    renderCard();
    expect(await screen.findByText('This confession is no longer available')).toBeTruthy();
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.queryByText(/@/)).toBeNull();
  });

  it('offers a retry when it could not be fetched', async () => {
    // A network failure is retried twice on its own before it is shown.
    api.get.mockRejectedValue(Object.assign(new Error('down'), { status: 503 }));
    renderCard();
    expect(await screen.findByText('Couldn’t load this confession.', {}, { timeout: 4000 })).toBeTruthy();
    expect(api.get).toHaveBeenCalledTimes(3);
    api.get.mockResolvedValue({ confession });
    fireEvent.click(screen.getByRole('button', { name: /Retry/ }));
    expect(await screen.findByText('@quiet.fern')).toBeTruthy();
  });
});
