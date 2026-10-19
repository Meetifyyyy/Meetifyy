/**
 * The website's resolution of a push `Intent` to a path.
 *
 * The same table as src/mobile/navigation/intentToRoute.js (which the web
 * entry must not import) and the service worker's `pushPath`, for the
 * destinations a push can name. Identifiers are encoded here, so a value
 * containing `/` or `?` cannot reach a different route.
 */
const seg = (value) => encodeURIComponent(value);

export function intentPath(intent) {
  switch (intent?.t) {
    case 'post':
      return `/post/${seg(intent.id)}`;
    case 'profile':
      return `/profile/${seg(intent.username)}`;
    case 'community':
      return `/communities/${seg(intent.id)}`;
    case 'activity':
      return `/crew/${seg(intent.id)}`;
    case 'chat':
      return `/messages/${seg(intent.conversationId)}`;
    case 'notifications':
      return '/notifications';
    default:
      return null;
  }
}
