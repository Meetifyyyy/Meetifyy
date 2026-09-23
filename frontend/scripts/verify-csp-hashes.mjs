/**
 * Fails the build when a built page carries an inline script the CSP does not
 * allow.
 *
 * Runs after `prerender-seo.mjs`, against every HTML file the deployment will
 * actually serve — the one place where "what ships" and "what the header
 * allows" can be compared directly. It only reads: vercel.json is committed
 * configuration, and a build that rewrites tracked files is how the previous
 * mechanism managed to fail without anyone noticing.
 *
 * Why fail rather than warn: the policy is report-only today, but the point of
 * it is to become the enforced one, and under enforcement a missing hash is a
 * script that does not run. For the version gate that means a page that never
 * boots. A warning in a build log is how the list drifted in the first place.
 *
 * A hash vercel.json lists but no page uses is NOT an error here. The dev and
 * production builds ship different sets (production strips the dev-host guard),
 * and one header serves both. Exactness against the source is the unit suite's
 * job: src/config/__tests__/cspReportOnly.test.js.
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import {
  SCRIPT_DIRECTIVES,
  directive,
  hashesIn,
  inlineScriptHashes,
  reportOnlyPolicy,
} from './csp-hashes.mjs';

const root = process.cwd();
const distDir = path.join(root, 'dist');
const configs = [path.join(root, 'vercel.json'), path.join(root, '..', 'vercel.json')].filter(
  (p) => fs.existsSync(p),
);

const pages = fs.readdirSync(distDir).filter((f) => f.endsWith('.html'));
const problems = [];

for (const configPath of configs) {
  const policy = reportOnlyPolicy(JSON.parse(fs.readFileSync(configPath, 'utf8')));
  const label = path.relative(path.join(root, '..'), configPath);
  if (!policy) {
    problems.push(`${label}: no Content-Security-Policy-Report-Only header`);
    continue;
  }
  for (const page of pages) {
    const shipped = inlineScriptHashes(fs.readFileSync(path.join(distDir, page), 'utf8'));
    for (const name of SCRIPT_DIRECTIVES) {
      const allowed = new Set(hashesIn(directive(policy, name)));
      for (const hash of shipped) {
        if (!allowed.has(hash)) problems.push(`${label} ${name} is missing ${hash} (used by dist/${page})`);
      }
    }
  }
}

if (problems.length > 0) {
  const unique = [...new Set(problems)];
  console.error(
    `[csp] ${unique.length} inline script hash problem(s):\n` +
      unique.map((p) => `  - ${p}`).join('\n') +
      `\n\nAn inline script in index.html changed. Put its new hash in the ` +
      `report-only script-src and script-src-elem of both vercel.json files ` +
      `(the unit test src/config/__tests__/cspReportOnly.test.js prints the ` +
      `exact list).`,
  );
  process.exit(1);
}

console.log(`[csp] ${pages.length} pages checked: every inline script is hashed in the report-only policy`);
