/**
 * Generates `public/robots.txt` for the environment currently being built.
 *
 * The four Vercel projects (dev site, dev admin, prod site, prod admin) all
 * build from this one repository, so a committed static robots.txt would
 * necessarily be wrong for three of them. Vercel's `headers` in vercel.json are
 * static for the same reason. Generating the file at build time from
 * VITE_APP_ENV is what lets one repo produce a crawlable production site and a
 * fully disallowed development site.
 *
 * Indexing is OPT-IN: anything that is not an explicit production build is
 * disallowed. A missing or misspelled VITE_APP_ENV therefore fails closed, to
 * the non-indexable side.
 *
 * This is a discoverability control, NOT an access control. robots.txt is a
 * request that well-behaved crawlers honour and nothing more — it stops the dev
 * site being indexed, it does not stop anyone reading it. Actual protection for
 * the development deployment is Vercel Deployment Protection (see
 * docs/ENVIRONMENT_ISOLATION.md §2).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const outputPath = resolve(here, '..', 'public', 'robots.txt');

const appEnv = (process.env.VITE_APP_ENV || '').trim().toLowerCase();
const siteUrl = (process.env.VITE_SITE_URL || '').trim().replace(/\/+$/, '');
const isProductionBuild = appEnv === 'production';

// Routes that must never be indexed even on the public production site: they
// are either private surfaces or authenticated-only, and a crawler following
// them only produces soft-404s and leaked profile URLs in search results.
const PRIVATE_PATHS = [
  '/admin',
  '/auth',
  '/settings',
  '/inbox',
  '/messages',
  '/notifications',
  '/verify-email',
  '/reset-password',
];

function productionRobots() {
  const lines = ['# Production — public and indexable.', 'User-agent: *'];
  for (const path of PRIVATE_PATHS) lines.push(`Disallow: ${path}`);
  lines.push('Allow: /');
  if (siteUrl) {
    lines.push('', `Sitemap: ${siteUrl}/sitemap.xml`);
  }
  return lines.join('\n') + '\n';
}

function nonProductionRobots() {
  return [
    `# APP_ENV="${appEnv || 'unset'}" — not a production build.`,
    '# This deployment must never appear in a search index.',
    'User-agent: *',
    'Disallow: /',
    '',
  ].join('\n');
}

const body = isProductionBuild ? productionRobots() : nonProductionRobots();

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, body, 'utf8');

console.log(
  `[robots] VITE_APP_ENV="${appEnv || 'unset'}" → ${
    isProductionBuild ? 'indexable (production)' : 'Disallow: / (non-production)'
  }`,
);
