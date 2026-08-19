import { Navigate, useLocation } from 'react-router-dom';

/**
 * Rewrites a legacy path prefix onto the canonical one, preserving the rest of
 * the path, the query string and the hash.
 *
 * Two URLs for one screen means two history identities for one piece of UI —
 * Back can then land on a URL that looks unvisited, and shared links disagree
 * with in-app links. Redirecting with `replace` keeps the legacy entry out of
 * the stack entirely, so Back skips straight past it.
 */
export default function LegacyPathRedirect({ from, to }) {
  const location = useLocation();
  const rest = location.pathname.slice(from.length);
  return <Navigate to={`${to}${rest}${location.search}${location.hash}`} replace state={location.state} />;
}
