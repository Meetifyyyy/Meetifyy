import { describe, it, expect } from 'vitest';
import { emailPlaceholder, primaryDomain } from '../collegeEmail';

describe('emailPlaceholder', () => {
  it("uses the college's first (primary) domain", () => {
    expect(emailPlaceholder({ domains: ['gla.ac.in', 'student.gla.ac.in'] })).toBe('you@gla.ac.in');
  });

  it('tidies a domain written with an @ or capitals', () => {
    expect(emailPlaceholder({ domains: ['@IITD.ac.in'] })).toBe('you@iitd.ac.in');
  });

  it('skips blanks and falls back when a college has no domain on record', () => {
    expect(emailPlaceholder({ domains: ['', '  ', 'dtu.ac.in'] })).toBe('you@dtu.ac.in');
    expect(emailPlaceholder({ domains: [] })).toBe('you@college.edu');
    expect(emailPlaceholder(null)).toBe('you@college.edu');
  });
});

describe('primaryDomain', () => {
  it('is the first usable domain, tidied, or empty when there is none', () => {
    expect(primaryDomain({ domains: ['', '@AMITY.edu', 'x.edu'] })).toBe('amity.edu');
    expect(primaryDomain({ domains: [] })).toBe('');
    expect(primaryDomain(undefined)).toBe('');
  });
});
