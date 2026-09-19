/** @vitest-environment jsdom */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { PostReplyPreview, isPostReply } from '../PostReplyPreview';

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

vi.mock('@shared/api/apiClient', () => ({
  getMediaUrl: (u) => u ? `http://media/${u}` : null,
  postsApi: {
    getPostById: vi.fn(),
  },
}));

vi.mock('@shared/hooks/usePostLookup', () => ({
  usePostLookup: () => vi.fn(() => null),
}));

function renderWithProviders(ui) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        {ui}
      </MemoryRouter>
    </QueryClientProvider>
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('isPostReply', () => {
  it('identifies server snapshot post reply', () => {
    expect(isPostReply({ shareType: 'post', shareId: 'p1' })).toBe(true);
  });

  it('identifies live payload post reply', () => {
    expect(isPostReply({ payload: { post: { id: 'p1', text: 'Hello' } } })).toBe(true);
    expect(isPostReply({ payload: { inviteData: { post: { id: 'p1' } } } })).toBe(true);
    expect(isPostReply({ inviteData: { post: { id: 'p1' } } })).toBe(true);
    expect(isPostReply({ post: { id: 'p1' } })).toBe(true);
  });

  it('identifies postShare invite type', () => {
    expect(isPostReply({ inviteData: { type: 'postShare' } })).toBe(true);
    expect(isPostReply({ payload: { inviteData: { type: 'postShare' } } })).toBe(true);
  });

  it('rejects non-post replies', () => {
    expect(isPostReply(null)).toBe(false);
    expect(isPostReply(undefined)).toBe(false);
    expect(isPostReply({ text: 'just text' })).toBe(false);
    expect(isPostReply({ mediaType: 'image' })).toBe(false);
    expect(isPostReply({ shareType: 'profile' })).toBe(false);
    expect(isPostReply({ shareType: 'community' })).toBe(false);
    expect(isPostReply({ inviteData: { type: 'group_invite' } })).toBe(false);
  });
});

describe('PostReplyPreview Component', () => {
  it('renders text-only post preview', () => {
    const replyTo = {
      id: 'm1',
      senderName: 'Alex',
      payload: {
        post: {
          id: 'p1',
          text: 'This is a text-only post content for testing',
          author: {
            id: 'u1',
            displayName: 'Alex K',
            username: 'alexk',
            avatar: 'avatars/alex.png',
          },
        },
      },
    };

    renderWithProviders(<PostReplyPreview replyTo={replyTo} isMe={true} />);

    expect(screen.getByText('Alex K')).toBeDefined();
    expect(screen.getByText('@alexk')).toBeDefined();
    expect(screen.getByText(/This is a text-only post content/)).toBeDefined();
    expect(screen.getByText('You replied to Alex K')).toBeDefined();
  });

  it('renders single image post preview', () => {
    const replyTo = {
      id: 'm2',
      senderName: 'Sarah',
      payload: {
        post: {
          id: 'p2',
          text: 'Check this photo',
          media: [{ url: 'photos/vacation.jpg', type: 'image' }],
          author: {
            displayName: 'Sarah Connor',
            username: 'sarahc',
          },
        },
      },
    };

    renderWithProviders(<PostReplyPreview replyTo={replyTo} isMe={false} />);

    const img = screen.getByAltText('Post thumbnail');
    expect(img).toBeDefined();
    expect(img.getAttribute('src')).toBe('http://media/photos/vacation.jpg');
    expect(screen.getByText(/Check this photo/)).toBeDefined();
    expect(screen.getByText("Sarah replied to Sarah Connor's post")).toBeDefined();
  });

  it('renders video post with play overlay', () => {
    const replyTo = {
      id: 'm3',
      senderName: 'John',
      payload: {
        post: {
          id: 'p3',
          text: 'Watch this clip',
          media: [{ url: 'videos/clip.mp4', type: 'video' }],
          author: {
            displayName: 'John Doe',
            username: 'johnd',
          },
        },
      },
    };

    renderWithProviders(<PostReplyPreview replyTo={replyTo} isMe={true} />);

    expect(screen.getByLabelText('Video')).toBeDefined();
  });

  it('renders multi-media post with carousel badge', () => {
    const replyTo = {
      id: 'm4',
      senderName: 'Department',
      payload: {
        post: {
          id: 'p4',
          text: '48 Hours. 372 Students. 62 Teams.',
          media: [
            { url: 'photos/1.jpg', type: 'image' },
            { url: 'photos/2.jpg', type: 'image' },
            { url: 'photos/3.jpg', type: 'image' },
          ],
          author: {
            displayName: 'departmentofcea',
            username: 'departmentofcea',
          },
        },
      },
    };

    renderWithProviders(<PostReplyPreview replyTo={replyTo} isMe={true} />);

    const badge = screen.getByLabelText('Multiple photos');
    expect(badge).toBeDefined();
    expect(badge.textContent).toBe('3');
  });

  it('renders poll post preview', () => {
    const replyTo = {
      id: 'm5',
      senderName: 'Pollster',
      payload: {
        post: {
          id: 'p5',
          text: 'What is your favourite framework?',
          poll: {
            question: 'What is your favourite framework?',
            options: [
              { id: 'opt1', text: 'React', votes: 15 },
              { id: 'opt2', text: 'Vue', votes: 5 },
              { id: 'opt3', text: 'Svelte', votes: 10 },
            ],
          },
          author: {
            displayName: 'Dev Community',
            username: 'devcom',
          },
        },
      },
    };

    renderWithProviders(<PostReplyPreview replyTo={replyTo} isMe={true} />);

    expect(screen.getByText('What is your favourite framework?')).toBeDefined();
    expect(screen.getByText('React')).toBeDefined();
    expect(screen.getByText('Vue')).toBeDefined();
    expect(screen.getByText('+1 more option')).toBeDefined();
  });

  it('renders unavailable post cleanly', () => {
    const replyTo = {
      id: 'm6',
      isUnsent: true,
      senderName: 'Ghost',
    };

    renderWithProviders(<PostReplyPreview replyTo={replyTo} isMe={true} />);

    expect(screen.getByText('Post unavailable')).toBeDefined();
  });

  it('handles "You replied to yourself" when currentUser matches author', () => {
    const currentUser = { id: 'u_me', username: 'antigravity' };
    const replyTo = {
      id: 'm7',
      senderName: 'antigravity',
      payload: {
        post: {
          id: 'p7',
          text: 'My own post',
          author: {
            id: 'u_me',
            username: 'antigravity',
            displayName: 'Anti Gravity',
          },
        },
      },
    };

    renderWithProviders(
      <PostReplyPreview
        replyTo={replyTo}
        isMe={true}
        currentUser={currentUser}
      />
    );

    expect(screen.getByText('You replied to yourself')).toBeDefined();
  });

  it('handles "You replied to yourself" when replyTo.from is "me"', () => {
    const replyTo = {
      id: 'm_from_me',
      from: 'me',
      senderName: 'Someone Else',
      payload: {
        post: {
          id: 'p_other',
          text: 'A post shared earlier by me',
          author: {
            id: 'u_ishita',
            username: 'ishita',
            displayName: 'Ishita Rao',
          },
        },
      },
    };

    renderWithProviders(
      <PostReplyPreview
        replyTo={replyTo}
        isMe={true}
      />
    );

    expect(screen.getByText('You replied to yourself')).toBeDefined();
  });

  it('handles "You replied to yourself" when replyTo.senderId is "me"', () => {
    const replyTo = {
      id: 'm_sender_me',
      senderId: 'me',
      senderName: 'Me',
      payload: {
        post: {
          id: 'p_other',
          text: 'Another post',
          author: {
            id: 'u_ishita',
            username: 'ishita',
            displayName: 'Ishita Rao',
          },
        },
      },
    };

    renderWithProviders(
      <PostReplyPreview
        replyTo={replyTo}
        isMe={true}
      />
    );

    expect(screen.getByText('You replied to yourself')).toBeDefined();
  });

  it('navigates to post on card click', () => {
    const replyTo = {
      id: 'm8',
      payload: {
        post: {
          id: 'p8',
          text: 'Clickable post',
          author: { displayName: 'Tester' },
        },
      },
    };

    renderWithProviders(<PostReplyPreview replyTo={replyTo} isMe={true} />);

    const card = screen.getByRole('link');
    fireEvent.click(card);

    expect(mockNavigate).toHaveBeenCalledWith('/post/p8', { state: { from: 'chat' } });
  });

  it('calls onJumpToMessage when clicking context label', () => {
    const onJumpToMessage = vi.fn();
    const replyTo = {
      id: 'm9',
      senderName: 'Alex',
      payload: {
        post: {
          id: 'p9',
          text: 'Jump target',
          author: { displayName: 'Alex' },
        },
      },
    };

    renderWithProviders(
      <PostReplyPreview
        replyTo={replyTo}
        isMe={true}
        onJumpToMessage={onJumpToMessage}
      />
    );

    const label = screen.getByRole('button');
    fireEvent.click(label);

    expect(onJumpToMessage).toHaveBeenCalledWith('m9');
  });

  it('renders poll badge on top right and hides poll options when post has both poll and media', () => {
    const replyTo = {
      id: 'm10',
      senderName: 'Sarthak',
      payload: {
        post: {
          id: 'p10',
          text: 'Check this out',
          media: [{ url: 'photos/char.png', aspectRatio: 1.5 }],
          poll: {
            question: 'Best character?',
            options: [
              { id: '1', text: 'Option A', votes: 10 },
              { id: '2', text: 'Option B', votes: 5 },
            ],
          },
          author: { displayName: 'Sarthak', username: 'sarthak' },
        },
      },
    };

    const { container } = renderWithProviders(
      <PostReplyPreview replyTo={replyTo} isMe={false} />
    );

    // Media is rendered with correct aspect ratio
    const img = container.querySelector('img');
    expect(img).toBeDefined();
    const mediaArea = container.querySelector('[class*="mediaArea"]');
    expect(mediaArea.getAttribute('data-aspect-ratio')).toBe('1.5');

    // Poll badge is rendered on top right of author row
    const pollBadgeTop = container.querySelector('[class*="pollBadgeTop"]');
    expect(pollBadgeTop).toBeDefined();

    // Poll preview widget below media is NOT rendered
    const pollWidget = container.querySelector('[class*="pollPreviewWidget"]');
    expect(pollWidget).toBeNull();
    expect(screen.queryByText('Option A')).toBeNull();
  });
});
