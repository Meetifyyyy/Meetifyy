/**
 * Emits `/.well-known/assetlinks.json` for the site this build deploys to.
 *
 * Android verifies an App Link by fetching that file from the link's host and
 * checking it names the installed app's signing certificate. The development
 * and production sites are signed for by different builds (debug and release
 * keys), so one static file in `public/` would have to list both on both —
 * letting a development build claim production links. Instead the list lives
 * in `app-links.json`, keyed by host, and this plugin emits only the entry
 * for `VITE_SITE_URL`'s host. A host with no fingerprints gets no file, which
 * leaves its links opening in the browser.
 *
 * Emitted into the build output only; no tracked file is rewritten.
 */
import fs from 'fs';
import path from 'path';

export function assetLinksFor(config, siteUrl) {
  let host = '';
  try {
    host = new URL(siteUrl).hostname;
  } catch {
    return null;
  }
  const fingerprints = config?.hosts?.[host];
  if (!Array.isArray(fingerprints) || fingerprints.length === 0) return null;
  return [
    {
      relation: ['delegate_permission/common.handle_all_urls'],
      target: {
        namespace: 'android_app',
        package_name: config.packageName,
        sha256_cert_fingerprints: fingerprints,
      },
    },
  ];
}

export function appLinksPlugin({ root, siteUrl }) {
  return {
    name: 'meetifyy-app-links',
    apply: 'build',
    generateBundle() {
      const config = JSON.parse(fs.readFileSync(path.join(root, 'app-links.json'), 'utf8'));
      const links = assetLinksFor(config, siteUrl);
      if (!links) return;
      this.emitFile({
        type: 'asset',
        fileName: '.well-known/assetlinks.json',
        source: `${JSON.stringify(links, null, 2)}\n`,
      });
    },
  };
}
