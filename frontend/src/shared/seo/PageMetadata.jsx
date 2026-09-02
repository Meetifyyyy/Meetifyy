/**
 * Renders nothing; runs `usePageMetadata` for the route tree it sits in.
 *
 * A component rather than a hook call inside App so it can live beside
 * `ScrollRestoration` and `SmartBackTracker` in the root layout element, which
 * is already the place where router-wide side effects are mounted. Keeping it
 * there means it is inside the router context (so `useLocation` works) without
 * App itself having to re-render on navigation.
 */
import usePageMetadata from './usePageMetadata';

export default function PageMetadata() {
  usePageMetadata();
  return null;
}
