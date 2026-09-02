/**
 * Writes `public/sitemap.xml` for a production build, and removes it for every
 * other build.
 *
 * The removal is the half that matters. `public/` is a working directory that
 * survives between builds on a developer machine, so a sitemap generated once
 * during a production build would otherwise still be sitting there during the
 * next development build and would ship to the dev deployment, advertising
 * production URLs from a host that must not be crawled at all.
 *
 * Only routes marked `indexable` in `src/config/seo.js` are listed. A sitemap
 * is a statement that these URLs are canonical and worth crawling; listing a
 * noindex URL contradicts its own robots directive and is reported in Search
 * Console as an error rather than ignored.
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';
import { isProductionAppEnv } from '../src/config/deploymentEnv.js';
import {
  INDEXABLE_ROUTES,
  absoluteUrl,
  isProductionSiteUrl,
  normaliseSiteUrl,
} from '../src/config/seo.js';

const here = dirname(fileURLToPath(import.meta.url));
const outputPath = resolve(here, '..', 'public', 'sitemap.xml');

const siteUrl = normaliseSiteUrl(process.env.VITE_SITE_URL);
const isProduction = isProductionAppEnv(process.env.VITE_APP_ENV);

// The host is checked as well as the flag. A sitemap is an active request to
// index every URL in it, so emitting one for dev.meetifyy.app or an admin host
// would not merely fail to prevent indexing, it would ask for it.
if (!isProduction || !siteUrl || !isProductionSiteUrl(siteUrl)) {
  rmSync(outputPath, { force: true });
  console.log(
    `[sitemap] VITE_APP_ENV="${(process.env.VITE_APP_ENV || 'unset').trim()}" -> no sitemap emitted`,
  );
} else {
  // One date for the whole file, taken from the build. Per-URL dates would be
  // more useful, but only if they were real: these pages are edited in source
  // and have no content timestamp to read, and inventing a fresh lastmod on
  // every deploy trains crawlers to ignore the field.
  const lastmod = new Date().toISOString().slice(0, 10);

  const urls = INDEXABLE_ROUTES.map((route) => {
    const loc = absoluteUrl(siteUrl, route.path);
    return [
      '  <url>',
      `    <loc>${loc}</loc>`,
      `    <lastmod>${lastmod}</lastmod>`,
      `    <changefreq>${route.changefreq}</changefreq>`,
      `    <priority>${route.priority.toFixed(1)}</priority>`,
      '  </url>',
    ].join('\n');
  }).join('\n');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>
`;

  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, xml, 'utf8');
  console.log(`[sitemap] ${INDEXABLE_ROUTES.length} URLs -> ${siteUrl}/sitemap.xml`);
}
