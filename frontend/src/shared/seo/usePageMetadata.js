/**
 * Keeps the document head correct across client-side navigation.
 *
 * The prerendered HTML files (scripts/prerender-seo.mjs) are what non-JavaScript
 * crawlers and link unfurlers read, and they are already correct on first load.
 * This hook exists for the two cases those files cannot cover:
 *
 *   1. In-app navigation. A SPA route change never fetches a new document, so
 *      without this the tab title and the robots directive stay on whatever
 *      page the session happened to start on. Someone who lands on /about and
 *      then signs in would carry "About Meetifyy" into every screen.
 *   2. Googlebot, which does execute JavaScript. It re-reads the head after
 *      render, so an authenticated route reached from a public one must be
 *      seen to say noindex rather than inheriting an indexable head.
 *
 * Deliberately not react-helmet or react-head. Twelve lines of DOM writes do
 * the whole job, and a head manager would add a dependency, a provider and a
 * render pass to a problem that is already solved statically for every consumer
 * that matters.
 */
import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { config } from '@config';
import { buildPageSeo, findRouteSeo, normalisePathname } from '@config/seo';

/**
 * The path this document was actually requested at, read once before React can
 * navigate anywhere.
 *
 * This closes a real hole. Signing-out visitors who hit an unknown URL are
 * redirected to '/' by ProtectedRoute, and that redirect rewrites the address
 * bar. Googlebot renders JavaScript, so for a URL like /old-campaign-link it
 * would fetch a document correctly marked noindex, watch the app redirect, and
 * then read a head that this hook had updated to the homepage's: indexable,
 * with a canonical. The URL Google is indexing would be claiming to be a
 * first-class public page.
 *
 * A document whose entry path is not a public route stays non-indexable for its
 * whole life, whatever the router does afterwards. A crawler only ever sees one
 * URL per document, so this is exact for the case it protects, and a person
 * never sees a robots meta tag, so it costs them nothing.
 */
const ENTRY_PATH =
  typeof window === 'undefined' ? '/' : normalisePathname(window.location.pathname);
const ENTRY_IS_PUBLIC = findRouteSeo(ENTRY_PATH) !== null;

/** Marks the tags this module owns, so it can replace them and nothing else. */
const OWNED = 'data-seo-managed';

function setMeta({ name, property, content }) {
  const selector = name
    ? `meta[name="${name}"]`
    : `meta[property="${property}"]`;
  let el = document.head.querySelector(selector);

  if (!content) {
    // Only remove a tag this module put there. The prerendered document may
    // carry tags that are correct and static, and clearing those on the first
    // client render would hand Googlebot a head that is worse than the one it
    // was served.
    if (el?.hasAttribute(OWNED)) el.remove();
    return;
  }

  if (!el) {
    el = document.createElement('meta');
    if (name) el.setAttribute('name', name);
    else el.setAttribute('property', property);
    el.setAttribute(OWNED, '');
    document.head.appendChild(el);
  }
  el.setAttribute('content', content);
}

function setCanonical(href) {
  let el = document.head.querySelector('link[rel="canonical"]');
  if (!href) {
    if (el?.hasAttribute(OWNED)) el.remove();
    return;
  }
  if (!el) {
    el = document.createElement('link');
    el.setAttribute('rel', 'canonical');
    el.setAttribute(OWNED, '');
    document.head.appendChild(el);
  }
  el.setAttribute('href', href);
}

/**
 * Applies the metadata for the current route on every navigation.
 *
 * Mounted once, near the router root. `location.pathname` is the only
 * dependency: query strings are normalised away by `buildPageSeo`, because no
 * public route here has a parameter that changes what the page says, and
 * reacting to them would rewrite the canonical on every filter change.
 */
export default function usePageMetadata() {
  const { pathname } = useLocation();

  useEffect(() => {
    const seo = buildPageSeo({
      pathname,
      siteUrl: config.app.siteUrl,
      isProduction: config.isProduction,
    });

    // See ENTRY_PATH above. The title still tracks the route the user is on,
    // because that is what the browser tab should say; only the indexing
    // signals are pinned to the truth about this document's URL.
    if (!ENTRY_IS_PUBLIC) {
      seo.robots = 'noindex, follow';
      seo.canonical = null;
      seo.openGraph = null;
      seo.twitter = null;
    }

    document.title = seo.title;
    setMeta({ name: 'description', content: seo.description });
    setMeta({ name: 'robots', content: seo.robots });
    setCanonical(seo.canonical);

    const og = seo.openGraph;
    setMeta({ property: 'og:type', content: og?.type });
    setMeta({ property: 'og:site_name', content: og?.siteName });
    setMeta({ property: 'og:title', content: og?.title });
    setMeta({ property: 'og:description', content: og?.description });
    setMeta({ property: 'og:url', content: og?.url });
    setMeta({ property: 'og:image', content: og?.image });
    setMeta({ property: 'og:image:alt', content: og?.imageAlt });
    setMeta({ property: 'og:locale', content: og?.locale });

    const tw = seo.twitter;
    setMeta({ name: 'twitter:card', content: tw?.card });
    setMeta({ name: 'twitter:title', content: tw?.title });
    setMeta({ name: 'twitter:description', content: tw?.description });
    setMeta({ name: 'twitter:image', content: tw?.image });
    setMeta({ name: 'twitter:image:alt', content: tw?.imageAlt });
  }, [pathname]);
}
