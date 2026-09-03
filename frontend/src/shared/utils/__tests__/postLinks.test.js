import { describe, it, expect } from 'vitest';
import {
  createUrlMatcher,
  formatUrlForDisplay,
  resolveHref,
  splitTrailingPunctuation,
  truncateUrlLabel,
} from '../postLinks';

/** Every URL the matcher finds in a run of text. */
const findAll = (text) => {
  const re = createUrlMatcher();
  const out = [];
  let m;
  while ((m = re.exec(text)) !== null) out.push(m[0]);
  return out;
};

describe('resolveHref — what we are willing to link', () => {
  it('keeps a plain https URL exactly as it goes', () => {
    expect(resolveHref('https://example.com/path')).toBe('https://example.com/path');
  });

  it('keeps query parameters, in order', () => {
    const url = 'https://example.com/watch?v=abc123&t=42s&list=PL9';
    expect(resolveHref(url)).toBe(url);
  });

  it('keeps the fragment', () => {
    expect(resolveHref('https://docs.example.com/guide#installation'))
      .toBe('https://docs.example.com/guide#installation');
  });

  it('keeps tracking parameters in the href, since the destination may read them', () => {
    const url = 'https://shop.example.com/p/9?utm_source=news&gclid=xyz&variant=blue';
    const href = resolveHref(url);
    expect(href).toContain('utm_source=news');
    expect(href).toContain('gclid=xyz');
    expect(href).toContain('variant=blue');
  });

  it('keeps percent-encoded characters intact', () => {
    const url = 'https://example.com/search?q=caf%C3%A9%20latte&tag=a%2Bb';
    expect(resolveHref(url)).toBe(url);
  });

  it('preserves a long path in full', () => {
    const url = `https://example.com/${'segment/'.repeat(40)}end?x=1`;
    expect(resolveHref(url)).toBe(url);
  });

  it('assumes https for a bare www address', () => {
    expect(resolveHref('www.example.com/a')).toBe('https://www.example.com/a');
  });

  it('allows http as well as https', () => {
    expect(resolveHref('http://example.com/')).toBe('http://example.com/');
  });

  for (const hostile of [
    'javascript:alert(1)',
    'JavaScript:alert(1)',
    'java\tscript:alert(1)',
    'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==',
    'vbscript:msgbox(1)',
    'file:///etc/passwd',
    'blob:https://example.com/uuid',
    'about:blank',
  ]) {
    it(`refuses to link ${hostile.slice(0, 28)}`, () => {
      expect(resolveHref(hostile)).toBeNull();
    });
  }

  it('refuses a scheme with no host', () => {
    expect(resolveHref('https://')).toBeNull();
  });

  it('refuses empty and non-string input', () => {
    expect(resolveHref('')).toBeNull();
    expect(resolveHref(null)).toBeNull();
    expect(resolveHref(undefined)).toBeNull();
  });
});

describe('the matcher', () => {
  it('finds every link in a post, not just the first', () => {
    const text = 'See https://a.example.com/1 and https://b.example.com/2 plus www.c.example.com/3';
    expect(findAll(text)).toEqual([
      'https://a.example.com/1',
      'https://b.example.com/2',
      'www.c.example.com/3',
    ]);
  });

  it('does not run past a quote or an angle bracket', () => {
    expect(findAll('a "https://example.com/x" b')).toEqual(['https://example.com/x']);
    expect(findAll('<https://example.com/y>')).toEqual(['https://example.com/y']);
  });

  it('does not treat a bare javascript: payload as a URL to match', () => {
    expect(findAll('javascript:alert(1)')).toEqual([]);
  });
});

describe('splitTrailingPunctuation', () => {
  it('leaves sentence punctuation out of the link', () => {
    expect(splitTrailingPunctuation('https://example.com/a.')).toEqual({ url: 'https://example.com/a', trailing: '.' });
    expect(splitTrailingPunctuation('https://example.com/a!?')).toEqual({ url: 'https://example.com/a', trailing: '!?' });
  });

  it('keeps balanced brackets that belong to the URL', () => {
    const wiki = 'https://en.example.org/wiki/Heat_(film)';
    expect(splitTrailingPunctuation(wiki)).toEqual({ url: wiki, trailing: '' });
  });

  it('drops an unbalanced closing bracket from the URL', () => {
    expect(splitTrailingPunctuation('https://example.com/a)')).toEqual({ url: 'https://example.com/a', trailing: ')' });
  });

  it('keeps a trailing slash, which is part of the path', () => {
    expect(splitTrailingPunctuation('https://example.com/a/')).toEqual({ url: 'https://example.com/a/', trailing: '' });
  });
});

describe('formatUrlForDisplay — cosmetic only', () => {
  it('drops the scheme, www and a bare trailing slash', () => {
    expect(formatUrlForDisplay('https://www.example.com/')).toBe('example.com');
  });

  it('keeps parameters that select the content', () => {
    expect(formatUrlForDisplay('https://youtube.com/watch?v=dQw4w9WgXcQ'))
      .toBe('youtube.com/watch?v=dQw4w9WgXcQ');
  });

  it('two different videos do not render as the same label', () => {
    const a = formatUrlForDisplay('https://youtube.com/watch?v=aaa');
    const b = formatUrlForDisplay('https://youtube.com/watch?v=bbb');
    expect(a).not.toBe(b);
  });

  it('strips campaign parameters only', () => {
    const label = formatUrlForDisplay(
      'https://shop.example.com/p/9?utm_source=news&utm_campaign=spring&fbclid=abc&variant=blue&size=m',
    );
    expect(label).toBe('shop.example.com/p/9?variant=blue&size=m');
  });

  it('keeps the fragment, which often is the destination', () => {
    expect(formatUrlForDisplay('https://docs.example.com/guide#installation'))
      .toBe('docs.example.com/guide#installation');
  });

  it('leaves no dangling "?" when every parameter was tracking', () => {
    expect(formatUrlForDisplay('https://example.com/a?utm_source=x&gclid=y')).toBe('example.com/a');
  });

  it('does not invent structure by decoding an encoded delimiter', () => {
    // %3F is a literal "?" inside a path segment, not the start of a query.
    const label = formatUrlForDisplay('https://example.com/a%3Fb=1');
    expect(label).toContain('%3F');
  });

  it('survives a malformed URL without throwing', () => {
    expect(() => formatUrlForDisplay('https://exa mple.com/%%%')).not.toThrow();
  });
});

describe('truncateUrlLabel', () => {
  it('leaves a short label alone', () => {
    expect(truncateUrlLabel('example.com', 50)).toBe('example.com');
  });

  it('keeps both ends of a long label', () => {
    const long = `example.com/${'a'.repeat(200)}/final-part`;
    const out = truncateUrlLabel(long, 40);
    expect(out.length).toBeLessThanOrEqual(40);
    expect(out.startsWith('example.com/')).toBe(true);
    expect(out.endsWith('final-part')).toBe(true);
    expect(out).toContain('…');
  });

  it('degrades sensibly at a very small limit', () => {
    expect(truncateUrlLabel('example.com/path', 6).length).toBeLessThanOrEqual(6);
  });
});
