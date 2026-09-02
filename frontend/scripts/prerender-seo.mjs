/**
 * Bakes real per-route metadata into real HTML files, after `vite build`.
 *
 * WHY THIS EXISTS AT ALL
 * This app is a client-rendered SPA: one `index.html` is served for every URL
 * and React fills it in. That is fine for Googlebot, which renders JavaScript,
 * and useless for everything else. Twitterbot, facebookexternalhit, Slackbot,
 * LinkedInBot, Discord and WhatsApp all fetch the document and read the `<head>`
 * without executing a single line of script. A `<meta property="og:title">`
 * added by React is invisible to all of them, which is why a shared Meetifyy
 * link previews as a bare URL today.
 *
 * Emitting one physical HTML file per public route is the smallest change that
 * fixes that. It needs no SSR runtime, no serverless function, no framework
 * migration and no new dependency, and it costs nothing at request time because
 * the files are static. The public surface here is seven pages, so the whole
 * output is a few hundred kilobytes.
 *
 * THE FALLBACK DOCUMENT IS SEPARATE, AND THAT IS THE POINT
 * Unmatched URLs are rewritten to `app.html` rather than to `index.html`. If
 * they fell back to `index.html`, every URL on the domain would answer 200 with
 * the homepage's own title and a canonical pointing at `/`, so the whole
 * authenticated app and every typo'd URL would look to a crawler like infinite
 * duplicates of the homepage. `app.html` is byte-identical except that it
 * carries `noindex` and no canonical, which makes "not indexable" the default
 * for every route nobody deliberately published.
 */
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';
import { isProductionAppEnv } from '../src/config/deploymentEnv.js';
import {
  PRODUCTION_HOSTS,
  PUBLIC_ROUTES,
  ROBOTS,
  buildPageSeo,
  isProductionSiteUrl,
  normaliseSiteUrl,
} from '../src/config/seo.js';

const here = dirname(fileURLToPath(import.meta.url));
const distDir = resolve(here, '..', 'dist');

/**
 * The region of `index.html` this script owns.
 *
 * Markers rather than a regex over `<title>`: the head also contains inline
 * scripts and a CSP meta, and a pattern loose enough to find the tags reliably
 * is also loose enough to corrupt them. Everything between the markers is
 * replaced wholesale, everything outside is passed through untouched, so the
 * version-gate script and the splash shell are never at risk.
 */
const START = '<!-- SEO:START -->';
const END = '<!-- SEO:END -->';

const siteUrl = normaliseSiteUrl(process.env.VITE_SITE_URL);
const isProduction = isProductionAppEnv(process.env.VITE_APP_ENV);

/** Escapes a value for an HTML attribute. */
function attr(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Escapes text content for an element body. */
function text(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Serialises JSON-LD safely.
 *
 * `</script>` anywhere inside the payload would close the tag early and turn
 * the remainder into markup. None of the current values can contain one, but
 * the escape is the difference between "cannot happen today" and "cannot
 * happen".
 */
function jsonLdScript(blocks) {
  if (!blocks.length) return '';
  return blocks
    .map(
      (block) =>
        `  <script type="application/ld+json">${JSON.stringify(block).replace(
          /</g,
          '\\u003c',
        )}</script>`,
    )
    .join('\n');
}

/** Renders the full head block for one route. */
function renderHead(seo) {
  const lines = [];
  lines.push(`  <title>${text(seo.title)}</title>`);
  if (seo.description) {
    lines.push(`  <meta name="description" content="${attr(seo.description)}" />`);
  }
  lines.push(`  <meta name="robots" content="${attr(seo.robots)}" />`);

  if (seo.canonical) {
    lines.push(`  <link rel="canonical" href="${attr(seo.canonical)}" />`);
  }

  const og = seo.openGraph;
  if (og) {
    lines.push(`  <meta property="og:type" content="${attr(og.type)}" />`);
    lines.push(`  <meta property="og:site_name" content="${attr(og.siteName)}" />`);
    lines.push(`  <meta property="og:title" content="${attr(og.title)}" />`);
    lines.push(`  <meta property="og:description" content="${attr(og.description)}" />`);
    lines.push(`  <meta property="og:url" content="${attr(og.url)}" />`);
    lines.push(`  <meta property="og:image" content="${attr(og.image)}" />`);
    lines.push(`  <meta property="og:image:width" content="${attr(og.imageWidth)}" />`);
    lines.push(`  <meta property="og:image:height" content="${attr(og.imageHeight)}" />`);
    lines.push(`  <meta property="og:image:alt" content="${attr(og.imageAlt)}" />`);
    lines.push(`  <meta property="og:locale" content="${attr(og.locale)}" />`);
  }

  const tw = seo.twitter;
  if (tw) {
    lines.push(`  <meta name="twitter:card" content="${attr(tw.card)}" />`);
    lines.push(`  <meta name="twitter:title" content="${attr(tw.title)}" />`);
    lines.push(`  <meta name="twitter:description" content="${attr(tw.description)}" />`);
    lines.push(`  <meta name="twitter:image" content="${attr(tw.image)}" />`);
    lines.push(`  <meta name="twitter:image:alt" content="${attr(tw.imageAlt)}" />`);
  }

  const jsonLd = jsonLdScript(seo.jsonLd);
  if (jsonLd) lines.push(jsonLd);

  return lines.join('\n');
}

/** Swaps the marked region of the shell for this route's head. */
function withHead(shell, headHtml) {
  const start = shell.indexOf(START);
  const end = shell.indexOf(END);
  if (start === -1 || end === -1) {
    throw new Error(
      `index.html is missing the ${START} / ${END} markers that prerender-seo.mjs replaces.`,
    );
  }
  return shell.slice(0, start + START.length) + '\n' + headHtml + '\n' + shell.slice(end);
}

/**
 * `/` writes dist/index.html; `/about` writes dist/about.html.
 *
 * Flat files rather than `about/index.html` directories, because the two are
 * not equally deterministic on Vercel. A directory containing an index invites
 * the platform's own directory-index and trailing-slash resolution, which can
 * answer `/about` with a 308 to `/about/` depending on the `trailingSlash`
 * setting. That would put a redirect in front of a URL this build declares
 * canonical, which is exactly the kind of self-contradiction that stalls
 * indexing. A flat file paired with an explicit rewrite in vercel.json has one
 * possible outcome.
 *
 * `/about.html` is then reachable directly as well. Nothing links to it, so it
 * will not be discovered, and the canonical tag inside it names `/about` if it
 * ever is.
 */
function outputPathFor(routePath) {
  if (routePath === '/') return resolve(distDir, 'index.html');
  return resolve(distDir, `${routePath.replace(/^\//, '')}.html`);
}

/**
 * Hostnames that must never appear in a document the production site serves.
 *
 * Checked against the finished HTML rather than trusted to be absent, because
 * every previous leak of one got in through something nobody was looking at:
 * an inline script, a hardcoded fallback, a copied comment. `api` and `cdn` are
 * absent from this list on purpose; they are legitimate production hosts.
 */
const FORBIDDEN_HOST_PATTERN = /\b(?:dev|dev-admin|admin|staging|preview|test)\.meetifyy\.app\b/g;

/**
 * Refuses to finish a production build whose output names a private host.
 *
 * The requirement is that only meetifyy.app is ever visible to a search engine.
 * Metadata is the obvious way to break that and this file already controls it;
 * this catches the unobvious ways, anywhere in the document.
 */
function assertNoPrivateHosts(html, label) {
  const found = [...new Set(html.match(FORBIDDEN_HOST_PATTERN) || [])];
  if (found.length) {
    throw new Error(
      `${label} names non-production host(s): ${found.join(', ')}.\n` +
        'No document served by the production site may reference the ' +
        'development, admin or staging hostnames. Remove the reference, or ' +
        'strip it from production builds the way vite.config.js does for the ' +
        'dev-host bootstrap.',
    );
  }
}

function main() {
  const shellPath = resolve(distDir, 'index.html');
  const shell = readFileSync(shellPath, 'utf8');

  // A production build with no VITE_SITE_URL would emit canonicals and og:url
  // pointing at "/about" with no origin, which unfurlers reject and Search
  // Console reports as an invalid canonical. Better to fail the build.
  if (isProduction && !siteUrl) {
    throw new Error(
      'VITE_APP_ENV=production requires VITE_SITE_URL: canonical and og:url must be absolute.',
    );
  }

  // The guard that makes it impossible to publish an indexable development or
  // admin deployment. See PRODUCTION_HOSTS in src/config/seo.js: the failure
  // this prevents is VITE_APP_ENV=production being set on the dev project,
  // which every other check in the pipeline would faithfully obey.
  if (isProduction && !isProductionSiteUrl(siteUrl)) {
    throw new Error(
      `Refusing to emit indexable HTML for "${siteUrl}".\n` +
        `VITE_APP_ENV=production is only valid on: ${PRODUCTION_HOSTS.join(', ')}.\n` +
        'This is almost certainly a production environment variable set on a ' +
        'development, admin or preview deployment. Fix the deployment\'s ' +
        'VITE_APP_ENV rather than this check.',
    );
  }

  let written = 0;
  for (const route of PUBLIC_ROUTES) {
    const seo = buildPageSeo({ pathname: route.path, siteUrl, isProduction });
    const html = withHead(shell, renderHead(seo));
    const outPath = outputPathFor(route.path);
    if (isProduction) assertNoPrivateHosts(html, `${route.path} (${outPath})`);
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, html, 'utf8');
    written += 1;
  }

  // The SPA fallback. `buildPageSeo` returns PRIVATE for any path not in the
  // table, so this is generated by exactly the same rule as everything else
  // rather than by a hand-written special case.
  const fallbackSeo = buildPageSeo({
    pathname: '/__spa_fallback__',
    siteUrl,
    isProduction,
  });
  fallbackSeo.robots = isProduction ? ROBOTS.PRIVATE : ROBOTS.HIDDEN;
  const fallbackHtml = withHead(shell, renderHead(fallbackSeo));
  if (isProduction) assertNoPrivateHosts(fallbackHtml, 'app.html');
  writeFileSync(resolve(distDir, 'app.html'), fallbackHtml, 'utf8');

  // Vercel serves `404.html` for a path that matches no file and no rewrite.
  // The catch-all rewrite means that should never happen, but if a future edit
  // to vercel.json narrows it, the page that appears must still be noindex
  // rather than the default Vercel error page.
  copyFileSync(resolve(distDir, 'app.html'), resolve(distDir, '404.html'));

  console.log(
    `[seo] prerendered ${written} routes + app.html + 404.html  ` +
      `(${isProduction ? `production, ${siteUrl}` : 'non-production, noindex'})`,
  );
}

main();
