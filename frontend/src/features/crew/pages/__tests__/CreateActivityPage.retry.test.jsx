/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

/**
 * A "Publish" retry after a failed create must send the byte-identical body,
 * so it carries the same idempotency key and the server replays the first
 * result instead of creating a second activity. Two things used to change the
 * body between attempts: the cover was uploaded again (new URL), and the
 * "start already passed" correction kept seconds the form never stores.
 */

const { create, commitDraftImage } = vi.hoisted(() => ({
  create: vi.fn(),
  commitDraftImage: vi.fn(),
}));

vi.mock('@shared/api/apiClient', () => ({
  activitiesApi: { create, inviteFriends: vi.fn() },
}));
vi.mock('@shared/utils/draftImageCache', () => ({
  commitDraftImage,
  removeDraftImage: vi.fn(),
}));
vi.mock('@shared/context/AuthContext', () => ({
  useAuth: () => ({ currentUser: { id: 'u1', verificationStatus: 'VERIFIED' }, collegeName: null }),
}));
vi.mock('@shared/hooks/useSystemBars', () => ({ useSystemBars: () => {} }));
vi.mock('@shared/hooks/useAmbientTint', () => ({ useAmbientTint: () => {} }));
vi.mock('@shared/hooks/useOverlayBack', () => ({ useOverlayBack: () => {} }));
vi.mock('@shared/hooks/useScrollLock', () => ({ useScrollLock: () => {} }));
vi.mock('@shared/hooks/useSmartBack', () => ({ useSmartBack: () => vi.fn() }));
vi.mock('@shared/utils/toast', () => ({ showToast: vi.fn() }));
vi.mock('@shared/lib/idb', () => ({ idbDelete: vi.fn() }));
vi.mock('@shared/stores/verificationModalStore', () => ({ openVerificationModal: vi.fn() }));
vi.mock('@shared/components/modals/ImageSearchModal', () => ({ default: () => null }));
vi.mock('@shared/components/modals/InviteFriendsModal', () => ({
  default: () => <div data-testid="invite-modal" />,
}));

import CreateActivityPage from '../CreateActivityPage';

const COVER_DRAFT = 'blob:http://localhost/cover-draft-1';

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[{ pathname: '/crew/create', state: { prefill: { coverImage: COVER_DRAFT } } }]}>
        <CreateActivityPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  vi.useFakeTimers({ toFake: ['Date'], shouldAdvanceTime: true });
  // 22 Oct 2026, 10:00:00 local.
  vi.setSystemTime(new Date(2026, 9, 22, 10, 0, 0));

  let uploads = 0;
  // Each commit lands at a new storage URL, as the real upload does.
  commitDraftImage.mockReset().mockImplementation(async () => {
    uploads += 1;
    return `https://cdn.example/activities/cover-${uploads}.webp`;
  });
  create.mockReset()
    .mockRejectedValueOnce(new Error('Network request failed'))
    .mockResolvedValueOnce({ id: 'activity-1', title: 'Sunset run' });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

async function publishAndSettle(expectedCalls) {
  fireEvent.click(screen.getByText('Publish'));
  await waitFor(() => expect(create).toHaveBeenCalledTimes(expectedCalls));
}

describe('CreateActivityPage retry', () => {
  it('re-sends the identical body, and so the same key, after a failed create', async () => {
    renderPage();

    fireEvent.change(screen.getAllByPlaceholderText('Untitled activity')[0], { target: { value: 'Sunset run' } });
    fireEvent.change(screen.getByPlaceholderText('Add location'), { target: { value: 'Main gate' } });

    // Start 10:05 today; the end follows at 11:05.
    fireEvent.click(screen.getByText('Date & Time'));
    fireEvent.click(screen.getByText('22', { selector: 'button' }));
    fireEvent.click(screen.getByText('10:05am', { selector: 'button' }));
    fireEvent.click(screen.getByText('Done'));

    // The chosen start lapses before Publish is pressed (the form's "now" has
    // not ticked yet), so Publish moves it to the next 5-minute slot.
    vi.setSystemTime(new Date(2026, 9, 22, 10, 6, 20, 700));

    await publishAndSettle(1);
    // The failure puts the form back.
    await screen.findByText('Publish');
    await publishAndSettle(2);

    const [firstBody, firstOpts] = create.mock.calls[0];
    const [retryBody, retryOpts] = create.mock.calls[1];

    expect(commitDraftImage).toHaveBeenCalledTimes(1);
    expect(firstBody.coverImage).toBe('https://cdn.example/activities/cover-1.webp');
    // Exactly what the form stores (10:10), with no stray seconds.
    expect(firstBody.startDate).toBe(new Date(2026, 9, 22, 10, 10).toISOString());
    expect(firstBody.endDate).toBe(new Date(2026, 9, 22, 11, 10).toISOString());

    expect(JSON.stringify(retryBody)).toBe(JSON.stringify(firstBody));
    expect(retryOpts.idempotencyKey).toBeTruthy();
    expect(retryOpts.idempotencyKey).toBe(firstOpts.idempotencyKey);
  });
});
