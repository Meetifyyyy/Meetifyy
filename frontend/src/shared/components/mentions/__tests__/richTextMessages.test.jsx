/** @vitest-environment jsdom */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/react';

const navigate = vi.fn();
vi.mock('react-router-dom', () => ({ useNavigate: () => navigate }));
// A user cache that knows "bob": in a message that must not be enough.
vi.mock('@shared/hooks/useUsersMap', () => ({ useUsersMap: () => ({ bob: { username: 'bob' } }) }));
vi.mock('@config', () => ({ config: { app: { siteUrl: 'https://dev.meetifyy.app' } } }));

const { default: RichText } = await import('../RichText');
const { inAppPathFor } = await import('@shared/utils/inAppLink');

afterEach(() => {
  cleanup();
  navigate.mockReset();
});

const renderMsg = (content, mentions = []) =>
  render(
    <RichText
      content={content}
      mentions={mentions}
      verifiedMentionsOnly
      linkClassName="L"
      mentionClassName="M"
    />,
  );

describe('RichText in a message', () => {
  it('styles the mentions the server verified, and nothing that only looks like one', () => {
    const { container } = renderMsg('hi @ana and @bob and @nobody', [
      { userId: 'u1', username: 'ana', start: 3, end: 7 },
    ]);
    const marked = [...container.querySelectorAll('.M')].map((el) => el.textContent);
    expect(marked).toEqual(['@ana']);
  });

  it('finds a verified mention even when the stored offsets no longer line up', () => {
    // The bubble trims and normalises text before display.
    const { container } = renderMsg('@ana.', [{ userId: 'u1', username: 'ana', start: 9, end: 13 }]);
    expect(container.querySelector('.M').textContent).toBe('@ana');
    expect(container.textContent).toBe('@ana.');
  });

  it('marks a web link and keeps its full address', () => {
    const url = 'https://example.com/a?b=1#c';
    const { container } = renderMsg(`see ${url}`);
    const a = container.querySelector('a.L');
    expect(a.getAttribute('href')).toBe(url);
    expect(a.getAttribute('rel')).toMatch(/noopener/);
    expect(a.getAttribute('rel')).toMatch(/noreferrer/);
  });

  it.each(['javascript:alert(1)', 'data:text/html,<b>x</b>', 'file:///etc/passwd'])(
    'never makes %s a link',
    (bad) => {
      const { container } = renderMsg(`x ${bad} y`);
      expect(container.querySelector('a')).toBeNull();
    },
  );

  it('opens a link to this site inside the app, and an outside link as a link', () => {
    const { container } = renderMsg('join https://dev.meetifyy.app/inbox/crew/Xk29 or https://example.com');
    const [own, outside] = container.querySelectorAll('a');
    const ownClick = new MouseEvent('click', { bubbles: true, cancelable: true });
    own.dispatchEvent(ownClick);
    expect(navigate).toHaveBeenCalledWith('/inbox/crew/Xk29');
    expect(ownClick.defaultPrevented).toBe(true);
    const outClick = new MouseEvent('click', { bubbles: true, cancelable: true });
    outside.dispatchEvent(outClick);
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(outClick.defaultPrevented).toBe(false);
  });

  it('leaves a modified click (new tab) to the browser', () => {
    const { container } = renderMsg('https://dev.meetifyy.app/post/p1');
    fireEvent.click(container.querySelector('a'), { ctrlKey: true });
    expect(navigate).not.toHaveBeenCalled();
  });
});

describe('inAppPathFor', () => {
  const opts = { siteUrl: 'https://meetifyy.app', pageOrigin: 'https://localhost' };
  it.each([
    ['https://meetifyy.app/inbox/crew/Xk29', '/inbox/crew/Xk29'],
    ['https://meetifyy.app/post/p1?ref=share', '/post/p1?ref=share'],
    ['https://evil.example/inbox/crew/Xk29', null],
    ['https://meetifyy.app.evil.example/post/p1', null],
    ['http://meetifyy.app/post/p1', null],
    ['https://meetifyy.app/some/unknown/page', null],
  ])('%s', (href, expected) => {
    expect(inAppPathFor(href, opts)).toBe(expected);
  });
});

describe('RichText: links before mentions', () => {
  it('keeps a link with an "@" in it whole, and does not style part of it as a mention', () => {
    const { container } = renderMsg('read https://medium.com/@ana/post-1 later', [
      { userId: 'u1', username: 'ana', start: 0, end: 0 },
    ]);
    const links = container.querySelectorAll('a');
    expect(links).toHaveLength(1);
    expect(links[0].getAttribute('href')).toBe('https://medium.com/@ana/post-1');
    expect(container.querySelector('.M')).toBeNull();
  });

  it('does not read an email address as a mention', () => {
    const { container } = renderMsg('mail bob@ana.dev or ping @ana', [
      { userId: 'u1', username: 'ana', start: 0, end: 0 },
    ]);
    expect([...container.querySelectorAll('.M')].map((el) => el.textContent)).toEqual(['@ana']);
    expect(container.textContent).toBe('mail bob@ana.dev or ping @ana');
  });
});
