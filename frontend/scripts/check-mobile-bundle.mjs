/**
 * Start-up budget for the app's bundle. Run after `npm run build:mobile`:
 *
 *   node scripts/check-mobile-bundle.mjs
 *
 * Everything the document loads before it can render is compiled on EVERY cold
 * start: the WebView keeps no compiled-code cache for files the app serves
 * itself (see docs/MOBILE_APP.md, "Start-up"). So the size of that set is
 * start-up time, and this fails the build when it grows past the budget or
 * when one of the two structural rules below is broken.
 *
 * The budgets are the sizes measured on 2026-11-11 plus about 5%. Raising one
 * is a decision: measure the launch first (scripts/measure-startup.mjs).
 */
import { readFileSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const dist = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'dist-mobile');
const KB = 1000;
const BUDGET = {
  entryJs: 900 * KB, // the entry chunk alone (847 kB)
  initialJs: 1300 * KB, // entry + the chunks the document preloads (1214 kB)
  initialCss: 420 * KB, // stylesheets linked from the document (399 kB)
};

let html;
try {
  html = readFileSync(resolve(dist, 'index.html'), 'utf8');
} catch {
  console.error('dist-mobile/index.html not found. Run `npm run build:mobile` first.');
  process.exit(1);
}

const attr = (tag, name) => new RegExp(`${name}="([^"]+)"`).exec(tag)?.[1];
const tags = html.match(/<(?:script|link)\b[^>]*>/g) || [];
const entry = tags.filter((t) => t.startsWith('<script') && /type="module"/.test(t)).map((t) => attr(t, 'src'));
const preloaded = tags.filter((t) => /rel="modulepreload"/.test(t)).map((t) => attr(t, 'href'));
const styles = tags.filter((t) => /rel="stylesheet"/.test(t)).map((t) => attr(t, 'href'));

const size = (href) => statSync(resolve(dist, `.${href}`)).size;
const sum = (list) => list.reduce((total, href) => total + size(href), 0);
const read = (href) => readFileSync(resolve(dist, `.${href}`), 'utf8');

const failures = [];
const report = [];
const check = (label, actual, budget) => {
  report.push(`  ${label.padEnd(34)} ${(actual / KB).toFixed(0).padStart(6)} kB   budget ${(budget / KB).toFixed(0)} kB`);
  if (actual > budget) failures.push(`${label} is ${(actual / KB).toFixed(0)} kB, over its ${(budget / KB).toFixed(0)} kB budget`);
};

if (entry.length !== 1) failures.push(`expected one module entry script in index.html, found ${entry.length}`);
check('entry chunk', sum(entry), BUDGET.entryJs);
check('initial JavaScript (entry + preloads)', sum([...entry, ...preloaded]), BUDGET.initialJs);
check('initial CSS', sum(styles), BUDGET.initialCss);

const initialCode = [...entry, ...preloaded].map(read).join('\n');
// Home is the screen a signed-in launch opens on. As a lazy route its first
// render waited on ~50 small files; it must stay in the initial set.
if (!initialCode.includes('data-launch-content')) {
  failures.push('Home (the feed) is not in the initial JavaScript: it has become a lazy route again');
}
// framer-motion is 148 kB and nothing on the first screen uses it.
if (initialCode.includes('data-framer-portal-id')) {
  failures.push('framer-motion is in the initial JavaScript: something on the launch path imports it statically');
}

console.log('Mobile bundle start-up budget');
console.log(report.join('\n'));
if (failures.length) {
  for (const f of failures) console.error(`✗ ${f}`);
  process.exit(1);
}
console.log('✓ within budget');
