/** @vitest-environment jsdom */
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import SafeHtml from '../SafeHtml';

const html = (markup) => render(<SafeHtml html={markup} />).container;

describe('SafeHtml keeps legitimate formatting', () => {
  it('renders the tags the backend allows an author to write', () => {
    const c = html('<p>Hello <strong>there</strong> and <em>hi</em></p><ul><li>one</li></ul><h2>Head</h2>');
    expect(c.querySelector('p')).toBeTruthy();
    expect(c.querySelector('strong').textContent).toBe('there');
    expect(c.querySelector('em')).toBeTruthy();
    expect(c.querySelector('ul li').textContent).toBe('one');
    expect(c.querySelector('h2').textContent).toBe('Head');
  });

  it('renders tables, code and rules', () => {
    const c = html('<table><tbody><tr><td>a</td><th>b</th></tr></tbody></table><pre><code>x=1</code></pre><hr>');
    expect(c.querySelector('table td').textContent).toBe('a');
    expect(c.querySelector('table th').textContent).toBe('b');
    expect(c.querySelector('pre code').textContent).toBe('x=1');
    expect(c.querySelector('hr')).toBeTruthy();
  });

  it('keeps links and forces safe link attributes', () => {
    const c = html('<p>See <a href="https://example.com/docs?x=1#top">docs</a></p>');
    const a = c.querySelector('a');
    expect(a.getAttribute('href')).toBe('https://example.com/docs?x=1#top');
    expect(a.getAttribute('target')).toBe('_blank');
    expect(a.getAttribute('rel')).toBe('noopener noreferrer nofollow');
  });

  it('allows mailto, which the backend permits', () => {
    const c = html('<a href="mailto:help@example.com">mail</a>');
    expect(c.querySelector('a').getAttribute('href')).toBe('mailto:help@example.com');
  });

  it('keeps the text inside an unknown tag but drops the tag', () => {
    const c = html('<div><section>kept text</section></div>');
    expect(c.textContent).toContain('kept text');
    expect(c.querySelector('section')).toBeNull();
  });
});

describe('SafeHtml refuses everything executable', () => {
  it('drops a script and its contents', () => {
    const c = html('<p>before</p><script>window.__pwned = 1</script><p>after</p>');
    expect(c.querySelector('script')).toBeNull();
    expect(c.textContent).not.toContain('__pwned');
    expect(c.textContent).toContain('before');
    expect(c.textContent).toContain('after');
    expect(window.__pwned).toBeUndefined();
  });

  it('drops inline event handlers rather than filtering them', () => {
    const c = html('<p onclick="alert(1)" onmouseover="alert(2)">text</p>');
    const p = c.querySelector('p');
    expect(p.getAttribute('onclick')).toBeNull();
    expect(p.getAttribute('onmouseover')).toBeNull();
    expect(p.textContent).toBe('text');
  });

  it('drops an img with an onerror payload entirely', () => {
    const c = html('<img src=x onerror="window.__pwned=1">');
    expect(c.querySelector('img')).toBeNull();
    expect(window.__pwned).toBeUndefined();
  });

  it('drops iframes, objects, embeds, forms and svg', () => {
    const c = html('<iframe src="https://evil.test"></iframe><object data="x"></object><embed src="x"><form><input></form><svg><script>1</script></svg>');
    for (const sel of ['iframe', 'object', 'embed', 'form', 'input', 'svg', 'script']) {
      expect(c.querySelector(sel)).toBeNull();
    }
  });

  it('drops a javascript: href but keeps the link text', () => {
    const c = html('<a href="javascript:alert(1)">click me</a>');
    const a = c.querySelector('a');
    expect(a.getAttribute('href')).toBeNull();
    expect(a.textContent).toBe('click me');
  });

  it('drops data: and vbscript: hrefs', () => {
    for (const bad of ['data:text/html,<script>alert(1)</script>', 'vbscript:msgbox(1)']) {
      const c = html(`<a href="${bad}">x</a>`);
      expect(c.querySelector('a').getAttribute('href')).toBeNull();
    }
  });

  it('does not trust a stored target or rel', () => {
    const c = html('<a href="https://example.com" target="_self" rel="opener">x</a>');
    const a = c.querySelector('a');
    expect(a.getAttribute('target')).toBe('_blank');
    expect(a.getAttribute('rel')).toBe('noopener noreferrer nofollow');
  });

  it('drops style attributes and style elements', () => {
    const c = html('<style>body{display:none}</style><p style="position:fixed;top:0">t</p>');
    expect(c.querySelector('style')).toBeNull();
    expect(c.querySelector('p').getAttribute('style')).toBeNull();
  });

  it('drops class and id, so stored markup cannot borrow app styling', () => {
    const c = html('<p class="im-fab" id="root">t</p>');
    const p = c.querySelector('p');
    expect(p.getAttribute('class')).toBeNull();
    expect(p.getAttribute('id')).toBeNull();
  });

  it('is not fooled by mixed case or whitespace in a scheme', () => {
    for (const bad of ['JaVaScRiPt:alert(1)', ' javascript:alert(1)', 'java\tscript:alert(1)']) {
      const c = html(`<a href="${bad}">x</a>`);
      expect(c.querySelector('a').getAttribute('href')).toBeNull();
    }
  });

  it('handles empty, null and malformed input without throwing', () => {
    expect(() => render(<SafeHtml html="" />)).not.toThrow();
    expect(() => render(<SafeHtml html={null} />)).not.toThrow();
    expect(() => render(<SafeHtml html={'<p>unclosed <strong>bold'} />)).not.toThrow();
    expect(() => render(<SafeHtml html={'<<>><p>x'} />)).not.toThrow();
  });
});

describe('fidelity against the real help content', () => {
  /**
   * A verbatim article body from the seed migration. The point of this test is
   * that hardening the render path must not quietly degrade the help centre:
   * across all 15 seeded articles the markup vocabulary is p / ol / ul / li /
   * strong / em with no attributes at all, every one of which survives.
   */
  const REAL_ARTICLE = `<p>Creating an account takes a couple of minutes:</p>
<ol><li>Open Meetifyy and choose <strong>Sign up</strong>.</li>
<li>Enter your college email address. Meetifyy uses your college domain to place you on the right campus, so use your institutional address rather than a personal one where you have the choice.</li>
<li>We'll email you a 6-digit verification code. Enter it to confirm the address belongs to you.</li>
<li>Pick a username and a display name, then add a photo and your interests so people can find you.</li></ol>
<p>If your college isn't listed when you sign up, it may not be onboarded yet — send us a support request with your college name and we'll look into adding it.</p>`;

  it('renders it with its structure intact', () => {
    const c = html(REAL_ARTICLE);
    expect(c.querySelectorAll('p')).toHaveLength(2);
    expect(c.querySelectorAll('ol')).toHaveLength(1);
    expect(c.querySelectorAll('li')).toHaveLength(4);
    expect(c.querySelector('strong').textContent).toBe('Sign up');
  });

  it('loses none of the prose, including the em dash and apostrophes', () => {
    const c = html(REAL_ARTICLE);
    const text = c.textContent;
    expect(text).toContain('Creating an account takes a couple of minutes:');
    expect(text).toContain("We'll email you a 6-digit verification code.");
    expect(text).toContain('it may not be onboarded yet — send us a support request');
    // Nothing swallowed: the rendered text matches the source with tags removed.
    const expected = REAL_ARTICLE.replace(/<[^>]+>/g, '');
    expect(text.replace(/\s+/g, ' ').trim()).toBe(expected.replace(/\s+/g, ' ').trim());
  });
});
