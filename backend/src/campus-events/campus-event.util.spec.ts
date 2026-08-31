import { BadRequestException } from '@nestjs/common';

// Mock config.isProduction so we can flip it per test.
jest.mock('../config', () => ({
  config: { isProduction: false },
}));

import {
  sanitizeRegistrationUrl,
  assertCoherentEventTimes,
} from './campus-event.util';
import { config } from '../config';

// ─── sanitizeRegistrationUrl ─────────────────────────────────────────────────

describe('sanitizeRegistrationUrl', () => {
  describe('empty / null input', () => {
    it.each([null, undefined, '', '   '])(
      'returns null for %p',
      (input: any) => {
        expect(sanitizeRegistrationUrl(input)).toBeNull();
      },
    );
  });

  describe('valid https URLs', () => {
    it('accepts a plain https URL and normalizes it', () => {
      const result = sanitizeRegistrationUrl('https://example.com/register');
      expect(result).toBe('https://example.com/register');
    });

    it('trims surrounding whitespace', () => {
      expect(sanitizeRegistrationUrl('  https://example.com  ')).toBe(
        'https://example.com/',
      );
    });

    it('preserves query strings and fragments', () => {
      const url = 'https://forms.example.com/reg?event=123#top';
      expect(sanitizeRegistrationUrl(url)).toBe(url);
    });
  });

  describe('scheme enforcement', () => {
    it('throws for a non-http/https scheme (javascript:)', () => {
      expect(() => sanitizeRegistrationUrl('javascript:alert(1)')).toThrow(
        BadRequestException,
      );
      expect(() => sanitizeRegistrationUrl('javascript:alert(1)')).toThrow(
        'Registration URL must use http or https.',
      );
    });

    it('throws for a data: URI', () => {
      expect(() =>
        sanitizeRegistrationUrl('data:text/html,<h1>hi</h1>'),
      ).toThrow(BadRequestException);
    });

    it('throws for ftp:', () => {
      expect(() => sanitizeRegistrationUrl('ftp://files.example.com')).toThrow(
        BadRequestException,
      );
    });
  });

  describe('http enforcement (non-localhost)', () => {
    it('throws for plain http on a public host in non-prod', () => {
      (config as any).isProduction = false;
      expect(() =>
        sanitizeRegistrationUrl('http://example.com/register'),
      ).toThrow('Registration URL must use https.');
    });

    it('throws for plain http on a public host in prod', () => {
      (config as any).isProduction = true;
      expect(() =>
        sanitizeRegistrationUrl('http://example.com/register'),
      ).toThrow('Registration URL must use https.');
      (config as any).isProduction = false;
    });
  });

  describe('localhost http (non-prod only)', () => {
    it('allows http://localhost in development', () => {
      (config as any).isProduction = false;
      expect(() =>
        sanitizeRegistrationUrl('http://localhost:3000/reg'),
      ).not.toThrow();
    });

    it('allows http://127.0.0.1 in development', () => {
      (config as any).isProduction = false;
      expect(sanitizeRegistrationUrl('http://127.0.0.1:3000/reg')).toBeTruthy();
    });

    it('throws for http://localhost in production', () => {
      (config as any).isProduction = true;
      expect(() =>
        sanitizeRegistrationUrl('http://localhost:3000/reg'),
      ).toThrow('Registration URL must use https.');
      (config as any).isProduction = false;
    });
  });

  describe('length limit', () => {
    it('throws for a URL longer than 2048 characters', () => {
      const long = 'https://example.com/' + 'a'.repeat(2050);
      expect(() => sanitizeRegistrationUrl(long)).toThrow(
        'Registration URL is too long.',
      );
    });

    it('accepts a URL of exactly 2048 characters', () => {
      // Build a valid https URL of exactly 2048 chars.
      const base = 'https://example.com/';
      const path = 'a'.repeat(2048 - base.length);
      expect(() => sanitizeRegistrationUrl(base + path)).not.toThrow();
    });
  });

  describe('invalid URL', () => {
    it('throws for a completely invalid URL string', () => {
      expect(() => sanitizeRegistrationUrl('not a url at all')).toThrow(
        'Registration URL must be a valid absolute URL.',
      );
    });

    it('throws for a relative path', () => {
      expect(() => sanitizeRegistrationUrl('/register')).toThrow(
        BadRequestException,
      );
    });
  });
});

// ─── assertCoherentEventTimes ─────────────────────────────────────────────────

describe('assertCoherentEventTimes', () => {
  /** Returns a Date that is `minutes` minutes from now. */
  function fromNow(minutes: number): Date {
    return new Date(Date.now() + minutes * 60 * 1000);
  }

  describe('valid time ranges', () => {
    it('accepts start 10 min from now and end 2 hours from now', () => {
      expect(() =>
        assertCoherentEventTimes(fromNow(10), fromNow(120)),
      ).not.toThrow();
    });

    it('accepts a 1-hour event starting 30 min from now', () => {
      expect(() =>
        assertCoherentEventTimes(fromNow(30), fromNow(90)),
      ).not.toThrow();
    });

    it('accepts a 30-day event (max duration)', () => {
      const start = fromNow(60);
      const end = new Date(start.getTime() + 30 * 24 * 60 * 60 * 1000 - 1);
      expect(() => assertCoherentEventTimes(start, end)).not.toThrow();
    });
  });

  describe('start time in the past', () => {
    it('throws when startTime is 10 minutes in the past', () => {
      expect(() => assertCoherentEventTimes(fromNow(-10), fromNow(60))).toThrow(
        'Event start date/time cannot be in the past.',
      );
    });

    it('allows startTime within the 5-minute grace period', () => {
      // 3 minutes in the past should be tolerated (clock drift / latency).
      expect(() =>
        assertCoherentEventTimes(fromNow(-3), fromNow(60)),
      ).not.toThrow();
    });
  });

  describe('end before or equal to start', () => {
    it('throws when endTime equals startTime', () => {
      const t = fromNow(30);
      expect(() => assertCoherentEventTimes(t, t)).toThrow(
        'End time must be after start time.',
      );
    });

    it('throws when endTime is before startTime', () => {
      expect(() => assertCoherentEventTimes(fromNow(60), fromNow(30))).toThrow(
        'End time must be after start time.',
      );
    });
  });

  describe('duration exceeds 30 days', () => {
    it('throws when the event would last 30 days + 1 ms', () => {
      const start = fromNow(60);
      const end = new Date(start.getTime() + 30 * 24 * 60 * 60 * 1000 + 1);
      expect(() => assertCoherentEventTimes(start, end)).toThrow(
        'Event duration cannot exceed 30 days.',
      );
    });
  });

  describe('invalid Date objects', () => {
    it('throws for an invalid startTime', () => {
      expect(() =>
        assertCoherentEventTimes(new Date('invalid'), fromNow(60)),
      ).toThrow('Invalid start or end time.');
    });

    it('throws for an invalid endTime', () => {
      expect(() =>
        assertCoherentEventTimes(fromNow(30), new Date('not-a-date')),
      ).toThrow('Invalid start or end time.');
    });
  });
});
