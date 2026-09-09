import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * The tightened CSP ships in report-only first.
 *
 * Two directives cannot be enforced from a code review alone. `script-src`
 * without 'unsafe-inline' depends on hashes of the inline scripts as they exist
 * AFTER the build — and one of them is the launch-time version gate, which
 * decides whether the app loads at all, so a hash that has drifted is a blank
 * page for every user. `connect-src` depends on the full set of hosts the app
 * actually contacts at runtime, which no amount of grepping proves.
 *
 * Report-only answers both questions in a browser without being able to break
 * anything: violations appear in the console and at any configured report
 * endpoint, and nothing is blocked. Once a pass over the real app is clean, the
 * report-only value becomes the enforced one.
 *
 * These tests exist so the report-only policy cannot quietly become weaker than
 * the enforced one, which would make the exercise pointless.
 */
const read = (p) => JSON.parse(readFileSync(resolve(process.cwd(), p), 'utf8'));

function policies(config) {
  const out = {};
  for (const entry of config.headers || []) {
    for (const kv of entry.headers || []) {
      if (kv.key === 'Content-Security-Policy') out.enforced = kv.value;
      if (kv.key === 'Content-Security-Policy-Report-Only') out.reportOnly = kv.value;
    }
  }
  return out;
}

const directive = (policy, name) =>
  (policy.split(';').map((d) => d.trim()).find((d) => d.startsWith(`${name} `)) || '');

describe.each([['frontend/vercel.json', 'vercel.json'], ['root vercel.json', '../vercel.json']])(
  '%s CSP',
  (_label, path) => {
    const { enforced, reportOnly } = policies(read(path));

    it('ships both an enforced and a report-only policy', () => {
      expect(enforced).toBeTruthy();
      expect(reportOnly).toBeTruthy();
    });

    it('never enforces unsafe-eval', () => {
      expect(enforced).not.toContain('unsafe-eval');
      expect(reportOnly).not.toContain('unsafe-eval');
    });

    it('drops unsafe-inline for scripts in the candidate policy', () => {
      expect(directive(reportOnly, 'script-src')).not.toContain('unsafe-inline');
      expect(directive(reportOnly, 'script-src-elem')).not.toContain('unsafe-inline');
    });

    it('replaces it with hashes rather than simply removing it', () => {
      expect(directive(reportOnly, 'script-src')).toMatch(/'sha256-[A-Za-z0-9+/=]{44}'/);
    });

    /**
     * The enforced connect-src allows `http:` and `https:` outright, which is
     * what makes CSP unable to constrain exfiltration if an injection ever
     * lands. The candidate names hosts.
     */
    it('narrows connect-src to named hosts in the candidate policy', () => {
      const candidate = directive(reportOnly, 'connect-src');
      expect(candidate).not.toMatch(/\bhttps:(?!\/\/)/);
      expect(candidate).not.toMatch(/\bws:(?!\/\/)/);
      expect(candidate).toContain('https://api.meetifyy.app');
      expect(candidate).toContain('wss://api.meetifyy.app');
      expect(candidate).toContain('https://*.supabase.co');
    });

    it('keeps the protections the enforced policy already has', () => {
      for (const d of ["frame-ancestors 'none'", "base-uri 'self'", "form-action 'self'", "object-src 'none'"]) {
        expect(reportOnly).toContain(d);
      }
    });
  },
);
