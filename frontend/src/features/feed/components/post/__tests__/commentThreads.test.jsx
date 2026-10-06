/** @vitest-environment jsdom */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, cleanup, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

afterEach(cleanup);

vi.mock('@shared/components/avatar/Avatar', () => ({ default: () => <span />, getProcessedAvatarUrl: (u) => u }));
vi.mock('@shared/components/badges/CollegeRepresentativeBadge', () => ({ CollegeRepresentativeBadge: () => null }));
vi.mock('@shared/components/mentions/RichText', () => ({ default: ({ content }) => <span>{content}</span> }));
vi.mock('@shared/context/AuthContext', () => ({ useAuth: () => ({ currentUser: { id: 'me' } }) }));
vi.mock('@shared/hooks/useCommunities', () => ({ useCommunities: () => ({ communitiesById: {} }) }));
vi.mock('../../../hooks/useDeleteComment', () => ({ useDeleteComment: () => ({ mutate: vi.fn() }) }));
vi.mock('../../../hooks/useLikeComment', async (importOriginal) => ({
  ...(await importOriginal()),
  useLikeComment: () => ({ toggle: vi.fn() }),
}));

const { CommentTreeRoot } = await import('../CommentNode');

let clock = Date.parse('2026-10-01T10:00:00Z');
const c = (id, user, replies = []) => ({
  id,
  text: `text ${id}`,
  authorId: user,
  author: { id: user, username: user, displayName: user.toUpperCase() },
  createdAt: new Date((clock += 60_000)).toISOString(),
  likeCount: 0,
  replies,
});

// root ← a ← b ← c (a chain), plus root ← d. Created in order root, a, b, c, d.
function thread() {
  clock = Date.parse('2026-10-01T10:00:00Z');
  const root = c('root', 'ana');
  const a = c('a', 'ben');
  const b = c('b', 'cat');
  const cc = c('c', 'dev');
  const d = c('d', 'eli');
  b.replies = [cc];
  a.replies = [b];
  root.replies = [a, d];
  return root;
}

const renderTree = (comments, props = {}) => render(
  <MemoryRouter>
    <CommentTreeRoot postId="p" comments={comments} {...props} />
  </MemoryRouter>,
);

const rows = () => [...document.querySelectorAll('[data-comment-card]')].map((el) => el.id.replace('comment-', ''));

describe('Instagram-style comment threads', () => {
  it('starts folded behind "View N replies", counting every descendant', () => {
    renderTree([thread()]);
    expect(rows()).toEqual(['root']);
    expect(screen.getByRole('button', { name: /View 4 replies/ })).toBeTruthy();
  });

  it('opens into ONE flat column, oldest first, naming who each reply answers', () => {
    renderTree([thread()]);
    fireEvent.click(screen.getByRole('button', { name: /View 4 replies/ }));
    expect(rows()).toEqual(['root', 'a', 'b', 'c', 'd']);
    const text = (id) => document.getElementById(`comment-${id}`).textContent;
    expect(text('a')).not.toContain('@'); // answers the top comment
    expect(text('b')).toContain('@ben');   // answers a reply
    expect(text('c')).toContain('@cat');
    expect(text('d')).not.toContain('@');
  });

  it('does not repeat a mention the writer already typed', () => {
    const root = thread();
    root.replies[0].replies[0].text = '@ben agreed';
    renderTree([root]);
    fireEvent.click(screen.getByRole('button', { name: /View 4 replies/ }));
    expect(document.getElementById('comment-b').textContent.match(/@ben/g)).toHaveLength(1);
  });

  it('pages long threads and folds them again', () => {
    clock = 0;
    const root = c('root', 'ana', Array.from({ length: 7 }, (_, i) => c(`r${i}`, `u${i}`)));
    renderTree([root]);
    fireEvent.click(screen.getByRole('button', { name: /View 7 replies/ }));
    expect(rows()).toHaveLength(1 + 5);
    fireEvent.click(screen.getByRole('button', { name: /View 2 more replies/ }));
    expect(rows()).toHaveLength(1 + 7);
    fireEvent.click(screen.getByRole('button', { name: /Hide replies/ }));
    expect(rows()).toEqual(['root']);
  });

  it('Reply on any comment targets THAT comment and opens its whole thread', () => {
    const onReplyRequest = vi.fn();
    renderTree([thread()], { onReplyRequest });
    fireEvent.click(screen.getByRole('button', { name: /View 4 replies/ }));
    const replyOn = (id) => document.getElementById(`comment-${id}`).querySelector('[aria-pressed]:not([aria-label])');
    fireEvent.click(replyOn('b'));
    expect(onReplyRequest).toHaveBeenLastCalledWith({ id: 'b', username: 'cat' });
  });

  it('opens a folded thread when its top comment is replied to', () => {
    renderTree([thread()], { onReplyRequest: () => {} });
    const reply = document.getElementById('comment-root').querySelector('[aria-pressed]:not([aria-label])');
    fireEvent.click(reply);
    expect(rows()).toEqual(['root', 'a', 'b', 'c', 'd']);
  });
});
