/** @vitest-environment jsdom */
import { describe, it, expect, vi } from 'vitest';
import { render, act, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

globalThis.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} takeRecords() { return []; } };
globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
if (!window.matchMedia) window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });

vi.mock('@shared/lib/supabase', () => ({ supabase: { auth: { getSession: () => Promise.resolve({ data: { session: null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }), signOut: () => Promise.resolve({}) } }, isSupabaseConfigured: false }));
vi.mock('@shared/api/apiClient', () => ({ getMediaUrl: (u) => u, postsApi: {}, communitiesApi: { getAll: async () => [], getCampusCommunities: async () => [] } }));
vi.mock('@shared/context/AuthContext', () => ({ useAuth: () => ({ currentUser: { id: 'me' }, isLoggedIn: true, loading: false }) }));
vi.mock('@shared/lib/idb', () => ({ idbGet: async () => null, idbSet: async () => {}, idbDelete: async () => {} }));

const { default: Post } = await import('@features/feed/components/post/Post');
const { MediaViewerProvider } = await import('@shared/context/MediaViewerContext');

/** Only the links inside the post's own body, not the author header links. */
const bodyLinks = (container) => [...container.querySelectorAll('[class*="postBody"] a')];

const renderPost = (text) => {
  const utils = render(
    <QueryClientProvider client={new QueryClient()}><MemoryRouter><MediaViewerProvider>
      <Post postData={{ id: 'p', authorId: 'u', author: { id: 'u', displayName: 'A', username: 'a' }, text, createdAt: new Date().toISOString(), media: [] }} />
    </MediaViewerProvider></MemoryRouter></QueryClientProvider>);
  return { ...utils, q: within(utils.container) };
};

describe('links rendered in a real post', () => {
  it('links every URL in one post, and the second one too', () => {
    const { container } = renderPost('First https://a.example.com/one then https://b.example.com/two and www.c.example.com/three');
    const links = bodyLinks(container);
    expect(links.map(a => a.getAttribute('href'))).toEqual([
      'https://a.example.com/one', 'https://b.example.com/two', 'https://www.c.example.com/three',
    ]);
    for (const a of links) {
      expect(a.getAttribute('target')).toBe('_blank');
      expect(a.getAttribute('rel')).toContain('noopener');
      expect(a.getAttribute('rel')).toContain('noreferrer');
    }
  });

  it('keeps query, fragment and encoding in the href while tidying the label', () => {
    const url = 'https://shop.example.com/p/9?utm_source=news&variant=blue#reviews';
    const { container } = renderPost(`Look ${url}`);
    const a = bodyLinks(container)[0];
    // The destination is byte-for-byte what was typed, tracking parameter and all.
    expect(a.getAttribute('href')).toBe(url);
    // The label drops the campaign tag and keeps the meaningful parts. It is
    // also shortened from the middle at the feed's 35-character limit, so this
    // asserts on the ends and on what must NOT be there rather than on the
    // whole string.
    expect(a.textContent).not.toContain('utm_source');
    expect(a.textContent.startsWith('shop.example.com/p/9?v')).toBe(true);
    expect(a.textContent.endsWith('#reviews')).toBe(true);
    expect(a.title).toBe(url);
  });

  it('never creates an anchor for a hostile scheme', () => {
    const { container } = renderPost('try javascript:alert(1) and data:text/html,<script>alert(1)</script>');
    expect(bodyLinks(container).length).toBe(0);
    // The payload is present as inert text, escaped by React.
    expect(container.textContent).toContain('javascript:alert(1)');
    expect(container.querySelector('script')).toBeNull();
  });

  it('does not execute injected markup', () => {
    const { container } = renderPost('<img src=x onerror=alert(1)> <b>bold?</b>');
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('b')).toBeNull();
    expect(container.textContent).toContain('<img src=x onerror=alert(1)>');
  });

  it('keeps links working inside a truncated post and after expanding', async () => {
    const url = 'https://example.com/article?id=42';
    const { container, q } = renderPost(`${url} ${'padding words here. '.repeat(30)}`);
    // Clipped, and the link is at the start so it survives the clip.
    expect(q.getByText('See more')).toBeTruthy();
    expect(bodyLinks(container)[0].getAttribute('href')).toBe(url);

    await act(async () => { q.getByText('See more').click(); });
    expect(bodyLinks(container)[0].getAttribute('href')).toBe(url);
    await act(async () => { q.getByText('See less').click(); });
    expect(bodyLinks(container)[0].getAttribute('href')).toBe(url);
  });
});

describe('the expand control is inline', () => {
  it('sits as a sibling of the text, not inside a block of its own', () => {
    const { container, q } = renderPost('word '.repeat(120));
    const btn = q.getByText('See more');
    // Its parent must be the post body itself, with the RichText span beside it,
    // rather than a wrapper div that forces its own line.
    const parent = btn.parentElement;
    expect(parent.className).toMatch(/postBody/);
    const richText = parent.querySelector('span[class*="wrapper"]');
    expect(richText).toBeTruthy();
    // A real space between the text and the control.
    expect(parent.textContent).toMatch(/\.\.\.\s+See more$/);
  });

  it('swaps to See less in place when expanded', async () => {
    const { container, q } = renderPost('word '.repeat(120));
    const before = q.getByText('See more').parentElement;
    await act(async () => { q.getByText('See more').click(); });
    const after = q.getByText('See less').parentElement;
    expect(after).toBe(before);
  });
});
