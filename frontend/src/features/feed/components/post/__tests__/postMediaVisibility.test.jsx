/**
 * @vitest-environment jsdom
 *
 * Scoped to this file rather than switched on project-wide: the rest of the
 * suite is node-environment and does not need a DOM.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, act, cleanup, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { POST_LIMITS } from '@shared/utils/bodyText';

/**
 * "See more" is a control over the post's TEXT.
 *
 * It used to also collapse the post's attachments: media, link preview and poll
 * all lived in a wrapper whose visibility was driven by whether the body copy
 * had been clipped, so a photo posted with a long caption rendered as a post
 * with no photo until the reader expanded the text. These assert that the two
 * are independent in both directions and at every text length.
 */

// Browser APIs the post subtree touches on mount, which jsdom does not provide.
globalThis.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} takeRecords() { return []; } };
globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
if (!window.matchMedia) {
  window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
}

const CURRENT_USER = { id: 'me', username: 'me', displayName: 'Me' };

vi.mock('@shared/lib/supabase', () => ({
  supabase: { auth: {
    getSession: () => Promise.resolve({ data: { session: null } }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    signOut: () => Promise.resolve({}),
  } },
  isSupabaseConfigured: false,
}));
vi.mock('@shared/api/apiClient', () => ({
  getMediaUrl: (u) => (typeof u === 'string' ? u : ''),
  postsApi: {
    likePost: async () => ({}), unlikePost: async () => ({}),
    bookmarkPost: async () => ({}), unbookmarkPost: async () => ({}),
    deletePost: async () => ({}), votePoll: async () => ({}),
  },
  communitiesApi: { getAll: async () => [], getCampusCommunities: async () => [] },
}));
vi.mock('@shared/context/AuthContext', () => ({
  useAuth: () => ({ currentUser: CURRENT_USER, isLoggedIn: true, loading: false }),
}));
vi.mock('@shared/lib/idb', () => ({ idbGet: async () => null, idbSet: async () => {}, idbDelete: async () => {} }));

const { default: Post } = await import('@features/feed/components/post/Post');
const { MediaViewerProvider } = await import('@shared/context/MediaViewerContext');

/** Comfortably past both the character and the line limit. */
const LONG_TEXT = 'This caption is deliberately long. '.repeat(20);
const SHORT_TEXT = 'A short caption.';

const IMAGE = [{ url: '/api/media/photo-1', type: 'image', width: 1200, height: 800, aspectRatio: 1.5 }];
const VIDEO = [{ url: '/api/media/clip-1', type: 'video', width: 1920, height: 1080, aspectRatio: 16 / 9 }];
const GALLERY = [
  { url: '/api/media/a', type: 'image', width: 800, height: 800, aspectRatio: 1 },
  { url: '/api/media/b', type: 'image', width: 800, height: 800, aspectRatio: 1 },
  { url: '/api/media/c', type: 'video', width: 800, height: 800, aspectRatio: 1 },
];

function makePost(overrides = {}) {
  return {
    id: 'p1',
    authorId: 'u1',
    author: { id: 'u1', displayName: 'Author', username: 'author', avatar: null },
    text: SHORT_TEXT,
    createdAt: new Date().toISOString(),
    media: IMAGE,
    likeCount: 0, commentCount: 0,
    hasLiked: false, hasBookmarked: false,
    ...overrides,
  };
}

/**
 * Returns queries scoped to this render. `screen` searches the whole document,
 * which would find the previous test's post as well.
 */
function renderPost(post, props = {}) {
  const utils = render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <MediaViewerProvider>
          <Post postData={post} {...props} />
        </MediaViewerProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { ...utils, q: within(utils.container) };
}

/**
 * Media is in the tree AND no ancestor is hiding it.
 *
 * The old bug hid the WRAPPER rather than unmounting it, so an existence check
 * alone would have passed against the broken build — hence the walk up the
 * ancestors.
 *
 * The walk deliberately starts at the parent. MediaGrid puts
 * `visibility: hidden` on the media element itself when its source fails to
 * load, and in jsdom every source fails, so including the element would assert
 * on the image loader rather than on the thing under test.
 */
function mediaIsVisible(container) {
  // MediaGrid labels single media "Post content" / "Video thumbnail" and grid
  // items "Media N", so match on the media elements themselves rather than on
  // any one layout's alt text.
  const media = container.querySelectorAll('[class*="singleImage"], [class*="singleVideo"], [class*="gridItem"] img, [class*="gridItem"] video, img[alt^="Media "], img[alt="Post content"], img[alt="Video thumbnail"], video');
  if (media.length === 0) return false;
  for (const el of media) {
    let node = el.parentElement;
    while (node && node !== container) {
      const style = node.getAttribute('style') || '';
      const cls = node.className?.toString?.() || '';
      if (/visibility:\s*hidden|display:\s*none|max-height:\s*0/.test(style)) return false;
      if (/collapsibleMedia/.test(cls) && !/expanded/.test(cls)) return false;
      node = node.parentElement;
    }
  }
  return true;
}

describe('post media is independent of text truncation', () => {
  afterEach(() => cleanup());

  it('the fixture text really does trip truncation', () => {
    expect(LONG_TEXT.length).toBeGreaterThan(POST_LIMITS.maxChars);
  });

  for (const [name, media] of [['image', IMAGE], ['video', VIDEO], ['mixed gallery', GALLERY]]) {
    it(`keeps ${name} visible with a SHORT caption`, () => {
      const { container, q } = renderPost(makePost({ text: SHORT_TEXT, media }));
      expect(q.queryByText('See more')).toBeNull();
      expect(mediaIsVisible(container)).toBe(true);
    });

    it(`keeps ${name} visible with a TRUNCATED caption (collapsed)`, () => {
      const { container, q } = renderPost(makePost({ text: LONG_TEXT, media }));
      // The text really is clipped...
      expect(q.getByText('See more')).toBeTruthy();
      // ...and the media is on screen anyway. This is the regression.
      expect(mediaIsVisible(container)).toBe(true);
    });

    it(`keeps ${name} visible after expanding and collapsing again`, async () => {
      const { container, q } = renderPost(makePost({ text: LONG_TEXT, media }));
      const countBefore = container.querySelectorAll('img, video').length;

      await act(async () => { q.getByText('See more').click(); });
      expect(q.getByText('See less')).toBeTruthy();
      expect(mediaIsVisible(container)).toBe(true);

      await act(async () => { q.getByText('See less').click(); });
      expect(q.getByText('See more')).toBeTruthy();
      expect(mediaIsVisible(container)).toBe(true);

      // Same nodes throughout: expanding must not re-mount the media, which is
      // what would make it flicker or restart a video.
      expect(container.querySelectorAll('img, video').length).toBe(countBefore);
    });

    it(`holds the ${name} layout steady across expand and collapse`, async () => {
      const { container, q } = renderPost(makePost({ text: LONG_TEXT, media }));

      /*
       * A structural fingerprint of the attachment subtree: every element's tag,
       * classes and inline style, in order. Inline style is where MediaGrid puts
       * the `--aspect` values that reserve space for each item, so a change in
       * sizing or in layout variant shows up here.
       *
       * Single media and grids lay out differently — only the single layouts
       * carry `--aspect` — so this compares whatever the chosen layout produced
       * rather than assuming one of them.
       */
      const fingerprint = () => {
        const root = container.querySelector('[class*="postAttachments"]');
        return [...root.querySelectorAll('*')].map(
          (el) => `${el.tagName}|${el.getAttribute('class') || ''}|${el.getAttribute('style') || ''}`,
        );
      };

      const collapsed = fingerprint();
      expect(collapsed.length).toBeGreaterThan(0);

      await act(async () => { q.getByText('See more').click(); });
      expect(fingerprint()).toEqual(collapsed);

      await act(async () => { q.getByText('See less').click(); });
      expect(fingerprint()).toEqual(collapsed);
    });
  }

  it('keeps a poll visible under a truncated caption', () => {
    const { container, q } = renderPost(makePost({
      text: LONG_TEXT,
      media: [],
      poll: { options: [{ id: 'a', text: 'Option A', votes: 1 }, { id: 'b', text: 'Option B', votes: 2 }], totalVotes: 3 },
    }));
    expect(q.getByText('See more')).toBeTruthy();
    expect(q.getByText('Option A')).toBeTruthy();
    expect(q.getByText('Option B')).toBeTruthy();
    expect(container.querySelector('[class*="collapsibleMedia"]')).toBeNull();
  });

  it('keeps a link preview visible under a truncated caption', () => {
    const { q } = renderPost(makePost({
      text: LONG_TEXT,
      media: [],
      linkPreview: { url: 'https://example.com', title: 'Example title', site: 'example.com' },
    }));
    expect(q.getByText('See more')).toBeTruthy();
    expect(q.getByText('Example title')).toBeTruthy();
  });

  it('shows the whole caption and the media on the detail view', () => {
    const { container, q } = renderPost(makePost({ text: LONG_TEXT }), { isDetailed: true });
    // The detail page never clips.
    expect(q.queryByText('See more')).toBeNull();
    expect(mediaIsVisible(container)).toBe(true);
  });
});
