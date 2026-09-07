import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isKnownAppRoute, normalisePathname } from '../seo';

/**
 * The two gates a shared post link has to pass on the client, both of which
 * failed silently the first time and produced the same symptom: a perfectly
 * valid link rendering "post not found", indistinguishable from a genuinely
 * private post.
 *
 * Asserted against the source text rather than by rendering the app, because
 * what is being protected is the presence of two entries in two allow-lists.
 * Mounting the router to prove that would need a router, an auth provider, a
 * query client and a fetch mock, and would still be testing the same two lines.
 */
const frontendRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const read = (path) => readFileSync(resolve(frontendRoot, path), 'utf8');

describe('a signed-out visitor can reach a shared post', () => {
  const POST_PATH = '/post/11111111-2222-4333-8444-555555555555';

  it('treats the post URL as a real route, not a dead link', () => {
    // If this were false, ProtectedRoute would render PublicNotFound and the
    // public view would never be considered at all.
    expect(isKnownAppRoute(POST_PATH)).toBe(true);
    expect(normalisePathname(POST_PATH)).toBe(POST_PATH);
  });

  it('routes the signed-out visitor to the public view instead of the landing page', () => {
    const app = read('src/App.jsx');
    expect(app).toContain('PUBLIC_VIEW_ROUTES');
    expect(app).toContain('PublicPostPage');

    // The pattern the gate uses, applied here exactly as App.jsx applies it.
    const pattern = /^\/post\/([^/]+)$/;
    expect(pattern.exec(POST_PATH)?.[1]).toBe('11111111-2222-4333-8444-555555555555');
    expect(pattern.test('/post/abc/extra')).toBe(false);
    expect(pattern.test('/posts/abc')).toBe(false);
  });

  it('passes the post id down as a prop rather than reading useParams', () => {
    // The gate short-circuits the layout route, so the child route carrying
    // `:id` never matches and `useParams()` inside the public page returns {}.
    // The page then asked for a post with no id and rendered "not found" for
    // every link — with no error, no failed request, and nothing in the console.
    // Comments are stripped first: the file explains this decision in prose,
    // and the assertion is about the code, not about the explanation.
    const page = read('src/features/feed/pages/PublicPostPage.jsx')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');

    expect(page).toContain('postId: id');
    expect(page).not.toContain('useParams');
  });

  it('lets the API client call the share endpoint without a session', () => {
    // `request` refuses to send at all when there is no access token unless the
    // path is on this list — so a visitor arriving from WhatsApp, who by
    // definition has no session, got "Unauthorized: Missing access token"
    // before a single byte reached the network.
    const apiClient = read('src/shared/api/apiClient.js');
    const publicPaths = apiClient.slice(
      apiClient.indexOf('const PUBLIC_PATHS = ['),
      apiClient.indexOf('function isPublicPath'),
    );
    expect(publicPaths).toContain("'/api/share'");
  });
});
