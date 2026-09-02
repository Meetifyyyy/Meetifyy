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
 * request that well-behaved crawlers honour and nothing more: it stops the dev
 * site being indexed, it does not stop anyone reading it. Actual protection for
 * the development deployment is Vercel Deployment Protection (see
 * docs/ENVIRONMENT_ISOLATION.md section 2).
 *
 * Note also that Disallow and noindex do NOT stack. A URL that is disallowed
 * here can never be fetched, so a crawler never sees the noindex on it, and a
 * page linked from elsewhere can still be listed URL-only. The private paths
 * below are therefore also served with a noindex robots meta tag (via
 * `app.html`, see scripts/prerender-seo.mjs) and are protected for real by
 * authentication. Three independent layers, none of them load-bearing alone.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isProductionAppEnv } from '../src/config/deploymentEnv.js';
import { isProductionSiteUrl } from '../src/config/seo.js';

const here = dirname(fileURLToPath(import.meta.url));
const outputPath = resolve(here, '..', 'public', 'robots.txt');

const appEnv = (process.env.VITE_APP_ENV || '').trim().toLowerCase();
const siteUrl = (process.env.VITE_SITE_URL || '').trim().replace(/\/+$/, '');
// Both the flag and the host must agree. A production flag on a development or
// admin host is the misconfiguration this whole file exists to survive.
const isProductionBuild =
  isProductionAppEnv(process.env.VITE_APP_ENV) && isProductionSiteUrl(siteUrl);

// Routes that must never be indexed even on the public production site: they
// are either private surfaces or authenticated-only, and a crawler following
// them only produces soft-404s and leaked profile URLs in search results.
const PRIVATE_PATHS = [
  // Administrative and internal.
  '/admin',
  '/dev',
  // Authentication flows. `/reset-password` and `/verify-email` arrive with a
  // token in the URL, so they must never be fetched by a crawler at all.
  '/auth',
  '/login',
  '/signup',
  '/forgot-password',
  '/reset-password',
  '/verify-email',
  '/onboarding',
  // Authenticated application surfaces. Every one of these 401s without a
  // session, so a crawler that follows a link to one only produces a soft 404.
  '/home',
  '/settings',
  '/inbox',
  '/messages',
  '/notifications',
  '/saved',
  '/search',
  '/profile',
  '/post',
  '/communities',
  '/campus',
  '/crew',
];

function productionRobots() {
  const lines = ['# Meetifyy production. Public pages are crawlable.', 'User-agent: *'];
  // Allow first. Order is not significant to the spec (longest match wins), but
  // a leading Allow makes the intent readable to a human auditing the file.
  lines.push('Allow: /');
  for (const path of PRIVATE_PATHS) lines.push(`Disallow: ${path}`);

  // Query strings never change what a public page says here, and every one of
  // them is an extra URL that resolves to identical content. Blocking the
  // tracking parameters that get appended to shared links stops that becoming a
  // duplicate-content problem; the canonical tag covers any that slip through.
  lines.push('');
  lines.push('# Tracking parameters produce duplicates of pages already listed.');
  for (const param of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'ref', 'fbclid', 'gclid', '_v']) {
    lines.push(`Disallow: /*?*${param}=`);
  }

  if (siteUrl) {
    lines.push('', `Sitemap: ${siteUrl}/sitemap.xml`);
  }
  return lines.join('\n') + '\n';
}

function nonProductionRobots() {
  return [
    `# APP_ENV="${appEnv || 'unset'}", site "${siteUrl || 'unset'}".`,
    '# This deployment must never appear in a search index.',
    '#',
    '# Crawling is deliberately NOT disallowed, and that is not an oversight.',
    '#',
    '# Every response from this deployment carries',
    '#   X-Robots-Tag: noindex, nofollow, noarchive, nosnippet, noimageindex',
    '# and every document repeats it as a meta tag. A crawler has to be able to',
    '# FETCH a page to read that directive. "Disallow: /" prevents the fetch, so',
    '# the noindex is never seen, and Google stays free to list the bare URL of',
    '# anything it learned about from somewhere else. It then reports the result',
    '# as "Indexed, though blocked by robots.txt", which is the exact outcome',
    '# this file was meant to prevent.',
    '#',
    '# That is not a hypothetical here. Every TLS certificate is published to',
    '# Certificate Transparency logs, so this hostname is public knowledge the',
    '# moment it is issued (see docs/operations.md, "Security posture"). The URL',
    '# is discoverable whatever this file says; what this file controls is',
    '# whether a crawler can read the directive that gets it removed.',
    '#',
    '# So: allow the fetch, and let the noindex do the work it can only do once',
    '# the page is reachable.',
    '#',
    '# This is a discoverability control either way, never an access control.',
    '# Real protection is Cloudflare Access / Vercel Deployment Protection in',
    '# front of this deployment, plus the auth guards behind it.',
    'User-agent: *',
    'Allow: /',
    '',
    '# No Sitemap line: nothing on this host may ever be submitted for indexing.',
    '',
  ].join('\n');
}

const body = isProductionBuild ? productionRobots() : nonProductionRobots();

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, body, 'utf8');

console.log(
  `[robots] VITE_APP_ENV="${appEnv || 'unset'}" site="${siteUrl || 'unset'}" -> ${
    isProductionBuild
      ? 'indexable (production)'
      : 'crawlable but noindex (non-production)'
  }`,
);
