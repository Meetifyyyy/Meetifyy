/**
 * The website's pull-to-refresh: there isn't one.
 *
 * A passthrough, so shared screens can wrap their scroll container
 * unconditionally and let the build decide whether the gesture exists. The
 * counterpart is `@platform/capacitor/pull-to-refresh/PullToRefresh`, and
 * `@shared/components/PullToRefresh` chooses between them with the same
 * `IS_MOBILE_BUILD` literal the API origin and session source are chosen with.
 *
 * Pull-to-refresh belongs to an app. In a browser the platform already has a
 * reload, the gesture collides with the native overscroll on both Android and
 * iOS, and on a desktop there is no gesture to make. Returning `children`
 * untouched means the web tree is exactly what it was before this existed —
 * no wrapper element, no listeners, no CSS.
 */
export default function PullToRefresh({ children }) {
  return children;
}
