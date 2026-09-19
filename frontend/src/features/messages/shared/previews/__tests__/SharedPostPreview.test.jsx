/** @vitest-environment jsdom */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { SharedPostPreview } from '../SharedPostPreview';

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

vi.mock('@shared/api/apiClient', () => ({
  getMediaUrl: (u) => (u ? `http://media/${u}` : null),
}));

vi.mock('@shared/hooks/usePostLookup', () => ({
  usePostLookup: () => vi.fn(() => null),
}));

vi.mock('@shared/hooks/useUsersMap', () => ({
  useUsersMap: () => ({}),
}));

function renderWithRouter(ui) {
  return render(
    <MemoryRouter>
      {ui}
    </MemoryRouter>
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('SharedPostPreview Component', () => {
  it('renders text-only post preview with author and exact date', () => {
    const post = {
      id: 'post-123',
      authorName: 'Ishita Rao',
      authorUsername: 'ishita',
      text: 'Spent the afternoon reading papers instead of writing mine.',
      createdAt: '2026-09-07T07:49:00.000Z',
    };

    renderWithRouter(<SharedPostPreview post={post} />);

    expect(screen.getByText('Ishita Rao')).toBeDefined();
    expect(screen.getByText('@ishita')).toBeDefined();
    expect(screen.getByText('Spent the afternoon reading papers instead of writing mine.')).toBeDefined();
    expect(screen.getByRole('article')).toBeDefined();
  });

  it('navigates to post detail on card click', () => {
    const post = {
      id: 'post-123',
      authorName: 'Ishita Rao',
      authorUsername: 'ishita',
      text: 'Sample text',
    };

    renderWithRouter(<SharedPostPreview post={post} />);

    const card = screen.getByRole('article');
    fireEvent.click(card);

    expect(mockNavigate).toHaveBeenCalledWith('/post/post-123', {
      state: { from: 'chat' },
    });
  });

  it('preserves landscape aspect ratio for single media', () => {
    const post = {
      id: 'post-landscape',
      authorName: 'Sarthak Saini',
      media: [{ url: 'landscape.jpg', width: 1920, height: 1080, aspectRatio: 1.7778 }],
      text: 'Landscape photo',
    };

    const { container } = renderWithRouter(<SharedPostPreview post={post} />);

    const mediaSingle = container.querySelector('[class*="mediaSingle"]');
    expect(mediaSingle).toBeDefined();
    expect(mediaSingle.getAttribute('data-aspect-ratio')).toBe('1.7778');

    const img = container.querySelector('img');
    expect(img).toBeDefined();
    expect(img.getAttribute('src')).toBe('http://media/landscape.jpg');
  });

  it('preserves portrait aspect ratio for single media', () => {
    const post = {
      id: 'post-portrait',
      authorName: 'Sarthak Saini',
      media: [{ url: 'poster.png', width: 800, height: 1000, aspectRatio: 0.8 }],
      text: 'Facing Failed to fetch error?',
    };

    const { container } = renderWithRouter(<SharedPostPreview post={post} />);

    const mediaSingle = container.querySelector('[class*="mediaSingle"]');
    expect(mediaSingle).toBeDefined();
    expect(mediaSingle.getAttribute('data-aspect-ratio')).toBe('0.8');

    const img = container.querySelector('img');
    expect(img).toBeDefined();
    expect(img.getAttribute('src')).toBe('http://media/poster.png');
  });

  it('preserves square aspect ratio for single media', () => {
    const post = {
      id: 'post-square',
      authorName: 'Sarthak Saini',
      media: [{ url: 'square.png', width: 600, height: 600, aspectRatio: 1 }],
      text: 'Square graphic',
    };

    const { container } = renderWithRouter(<SharedPostPreview post={post} />);

    const mediaSingle = container.querySelector('[class*="mediaSingle"]');
    expect(mediaSingle).toBeDefined();
    expect(mediaSingle.getAttribute('data-aspect-ratio')).toBe('1');
  });

  it('renders video play overlay for video media', () => {
    const post = {
      id: 'post-video',
      authorName: 'Sarthak Saini',
      media: [{ url: 'clip.mp4', type: 'video', isVideo: true }],
      text: 'Check this clip out',
    };

    const { container } = renderWithRouter(<SharedPostPreview post={post} />);

    const playOverlay = container.querySelector('[class*="videoPlayOverlay"]');
    expect(playOverlay).toBeDefined();
  });

  it('renders full poll options preview and top-right poll badge when post is poll-only (no media)', () => {
    const post = {
      id: 'post-poll-only',
      authorName: 'Ishita Rao',
      poll: {
        question: 'Favorite programming language?',
        options: [
          { id: '1', text: 'JavaScript', votes: 10 },
          { id: '2', text: 'Python', votes: 20 },
        ],
        totalVotes: 30,
      },
    };

    const { container } = renderWithRouter(<SharedPostPreview post={post} />);

    // Top-right poll badge
    const pollBadgeTop = container.querySelector('[class*="pollBadgeTop"]');
    expect(pollBadgeTop).toBeDefined();

    expect(screen.getByText('Favorite programming language?')).toBeDefined();
    expect(screen.getByText('JavaScript')).toBeDefined();
    expect(screen.getByText('Python')).toBeDefined();
    expect(screen.getByText('33%')).toBeDefined();
    expect(screen.getByText('67%')).toBeDefined();
  });

  it('renders poll icon on top right side and NO poll UI below media when post has both poll and media', () => {
    const post = {
      id: 'post-poll-media',
      authorName: 'Sarthak Saini',
      text: 'yes',
      media: [{ url: 'blue-character.png', width: 1200, height: 800, aspectRatio: 1.5 }],
      poll: {
        question: 'Is this the best character ever created in the universe?',
        options: [
          { id: '1', text: 'no', votes: 5 },
          { id: '2', text: 'ok', votes: 0 },
          { id: '3', text: 'yes', votes: 0 },
        ],
        totalVotes: 5,
      },
    };

    const { container } = renderWithRouter(<SharedPostPreview post={post} />);

    // 1. Media thumbnail must be visible
    const img = container.querySelector('img');
    expect(img).toBeDefined();
    expect(img.getAttribute('src')).toBe('http://media/blue-character.png');

    // 2. Poll icon must be rendered on the top right side of the card
    const pollBadgeTop = container.querySelector('[class*="pollBadgeTop"]');
    expect(pollBadgeTop).toBeDefined();

    // 3. No poll UI below media (compactPollRow and pollPreviewWidget are not rendered)
    const compactPollRow = container.querySelector('[class*="compactPollRow"]');
    expect(compactPollRow).toBeNull();
    const pollWidget = container.querySelector('[class*="pollPreviewWidget"]');
    expect(pollWidget).toBeNull();

    // 4. Poll options, percentages, and voting bars must NOT be rendered
    expect(screen.queryByText('100%')).toBeNull();
    expect(screen.queryByText('no')).toBeNull();
    expect(screen.queryByText('ok')).toBeNull();
  });

  it('renders unavailable state when post is null or marked deleted', () => {
    renderWithRouter(<SharedPostPreview post={null} />);

    expect(screen.getByRole('alert')).toBeDefined();
    expect(screen.getByText('This post is no longer available')).toBeDefined();
  });
});
