import { IS_MOBILE_BUILD } from '@config';
import CapacitorPullToRefresh from '@platform/capacitor/pull-to-refresh/PullToRefresh';
import WebPullToRefresh from '@platform/web/pullToRefresh';

/**
 * Pull-to-refresh, if this client is one that should have it.
 *
 * The one import a screen needs. Both implementations are named here and the
 * choice is made from `IS_MOBILE_BUILD`, which Vite replaces with a literal —
 * so the branch a given build does not take is tree-shaken and the website
 * ships none of the gesture code. This is the same shape `apiClient` uses to
 * pick its API origin and session source; see the note at the top of that file.
 *
 * On the web the export is a passthrough that renders `children` and nothing
 * else — no wrapper, no listeners — so a shared screen can wrap its scroll
 * container unconditionally without changing the site.
 *
 * HOW TO USE IT
 * Wrap a screen's PRIMARY scroll container and pass that screen's existing
 * reload function:
 *
 *   <PullToRefresh onRefresh={refetch}>…</PullToRefresh>
 *
 * Exactly one per screen. A carousel inside a feed, a list inside a modal or a
 * chat pane keeps its own gesture — the hook walks up from the touch target so
 * it never steals one, and anything it cannot infer can opt out with
 * `data-no-pull-refresh`.
 *
 * @param {object} props
 * @param {() => Promise<unknown>|unknown} props.onRefresh the screen's reload
 * @param {boolean} [props.disabled]
 * @param {() => number} [props.getScrollTop] for a screen that scrolls inside
 *   its own element rather than the window
 */
const PullToRefresh = IS_MOBILE_BUILD ? CapacitorPullToRefresh : WebPullToRefresh;

export default PullToRefresh;
