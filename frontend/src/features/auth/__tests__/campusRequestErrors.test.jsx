/** @vitest-environment jsdom */
/**
 * The campus access request form's failure handling.
 *
 * The form used to call `fetch('/api/auth/check-email')` with a same-origin,
 * relative URL. That resolves in local development only because the Vite dev
 * server proxies `/api` to the backend. The deployed site has no such proxy —
 * `vercel.json` rewrites only `/_api/*`, `/api/media/*` and `/api/share/*`,
 * and the SPA catch-all explicitly excludes `api/` — so the request matched
 * nothing and Vercel answered with its own 404: `text/plain`, body
 * `The page could not be found`. `res.json()` threw
 * `Unexpected token 'T', "The page c"... is not valid JSON`, and the catch
 * block put `err.message` straight on screen.
 *
 * Two rules are pinned here, because both had to hold for that bug to be gone:
 *   1. the request goes through `apiClient`, which resolves the real API
 *      origin in every environment; and
 *   2. whatever comes back, a person never reads a technical string.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';

vi.mock('@shared/api/apiClient', () => ({
  apiClient: { post: vi.fn() },
}));

vi.mock('framer-motion', () => ({
  motion: new Proxy({}, { get: () => ({ children, ...p }) => <div {...p}>{children}</div> }),
  AnimatePresence: ({ children }) => <>{children}</>,
}));

const { apiClient } = await import('@shared/api/apiClient');
const { default: SignupJourneyCTA } = await import(
  '@features/auth/landing/components/SignupJourneyCTA'
);

/** Anything that looks like developer output rather than a sentence for a user. */
const TECHNICAL_MARKERS = [
  /unexpected token/i,
  /is not valid json/i,
  /<!doctype/i,
  /<html/i,
  /^API error\b/i,
  /SyntaxError/i,
  /\bstack\b/i,
  /NOT_FOUND/,
  /The page could not be found/i,
  /VITE_API_URL/i,
  /malformed response/i,
];

/**
 * Drive the real flow: the landing form opens the modal, the modal is filled
 * and submitted. Fields are addressed by the ids the component actually
 * renders (`cta-name`, `cta-college-name`, …) rather than by guessing at
 * labels.
 */
function openFormAndSubmit() {
  const { container } = render(<SignupJourneyCTA />);

  // The landing form's submit opens the modal.
  fireEvent.submit(container.querySelector('form'));

  const set = (id, value) => {
    const el = document.getElementById(id);
    expect(el).toBeTruthy();
    fireEvent.change(el, { target: { value } });
  };
  set('cta-name', 'Test Person');
  set('cta-college-name', 'Test College');
  set('cta-personal-email', 'person@example.com');
  set('cta-college-email', 'person@testcollege.ac.in');

  // The modal's own form is the last one mounted.
  const forms = document.querySelectorAll('form');
  fireEvent.submit(forms[forms.length - 1]);
}

describe('campus access request — error presentation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    // Without this each test's markup stays mounted, so `getElementById` finds
    // the PREVIOUS render's fields and the new form submits empty.
    cleanup();
    vi.restoreAllMocks();
  });

  it('never routes through a bare same-origin /api URL', async () => {
    // The regression itself: a relative fetch works in dev and 404s in prod.
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    apiClient.post.mockResolvedValue({ available: false });

    openFormAndSubmit();

    await waitFor(() => expect(apiClient.post).toHaveBeenCalled());
    expect(fetchSpy).not.toHaveBeenCalled();
    for (const [path] of apiClient.post.mock.calls) {
      expect(path.startsWith('/api/')).toBe(true);
    }
    vi.unstubAllGlobals();
  });

  it.each([
    [
      'a JSON parse failure from a text/plain 404',
      Object.assign(new SyntaxError(
        'Unexpected token \'T\', "The page c"... is not valid JSON',
      ), { status: 404 }),
    ],
    ['a 500 from the API', Object.assign(new Error('API error 500'), { status: 500 })],
    ['a dropped connection', new TypeError('Failed to fetch')],
    [
      'a malformed 200 body',
      Object.assign(new Error('API server returned a malformed response.'), {
        status: 200,
        code: 'invalid_response',
        responseSnippet: 'The page could not be found\n\nNOT_FOUND',
      }),
    ],
    [
      'an HTML body',
      new Error(
        'API server returned HTML instead of JSON. Please check backend connection and VITE_API_URL setting.',
      ),
    ],
  ])('shows neutral copy for %s', async (_label, thrown) => {
    apiClient.post
      .mockResolvedValueOnce({ available: false })
      .mockRejectedValueOnce(thrown);

    openFormAndSubmit();

    const box = await screen.findByText(/something went wrong/i);
    expect(box).toBeTruthy();
    for (const marker of TECHNICAL_MARKERS) {
      expect(box.textContent).not.toMatch(marker);
    }
  });

  it('keeps the server\'s own validation copy on a 400', async () => {
    // The counterpart to the client-side checks: this is written for the
    // person filling the form and must survive.
    apiClient.post
      .mockResolvedValueOnce({ available: false })
      .mockRejectedValueOnce(
        Object.assign(new Error('Please enter a valid full name (2-80 characters).'), {
          status: 400,
        }),
      );

    openFormAndSubmit();

    expect(
      await screen.findByText(/please enter a valid full name/i),
    ).toBeTruthy();
  });

  it('does not leak a bodiless 400 as "API error 400"', async () => {
    apiClient.post
      .mockResolvedValueOnce({ available: false })
      .mockRejectedValueOnce(Object.assign(new Error('API error 400'), { status: 400 }));

    openFormAndSubmit();

    const box = await screen.findByText(/something went wrong/i);
    expect(box.textContent).not.toMatch(/^API error/i);
  });

  it('tells the user how long to wait when rate limited', async () => {
    apiClient.post
      .mockResolvedValueOnce({ available: false })
      .mockRejectedValueOnce(
        Object.assign(new Error('Too Many Requests'), {
          status: 429,
          retryAfterSeconds: 120,
        }),
      );

    openFormAndSubmit();

    expect(await screen.findByText(/try again in 2 minutes/i)).toBeTruthy();
  });

  it('still files the request when the availability check itself fails', async () => {
    // The check is a courtesy. Failing it must not dead-end the submission.
    apiClient.post
      .mockRejectedValueOnce(new Error('check exploded'))
      .mockResolvedValueOnce({ success: true });

    openFormAndSubmit();

    await waitFor(() => expect(apiClient.post).toHaveBeenCalledTimes(2));
    expect(apiClient.post.mock.calls[1][0]).toBe('/api/auth/request-college');
  });

  it('logs the technical detail to the console for developers', async () => {
    const thrown = new SyntaxError('Unexpected token \'T\', "The page c"... is not valid JSON');
    apiClient.post
      .mockResolvedValueOnce({ available: false })
      .mockRejectedValueOnce(thrown);

    openFormAndSubmit();

    await screen.findByText(/something went wrong/i);
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('campus-request'),
      thrown,
    );
  });
});
