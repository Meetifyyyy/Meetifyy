/**
 * The mobile client's resolution of an `Intent` (core/navigation/intents.ts)
 * to a React Router path. The single file a navigation-library change
 * touches, as the Intent module intends.
 *
 * Identifiers are encoded here, not by the producer: an Intent carries opaque
 * strings, and a value containing `/` or `?` must not be able to reach a
 * different route than the one its type names.
 */
const seg = (value) => encodeURIComponent(value);

export function intentToRoute(intent) {
  switch (intent?.t) {
    case 'feed':
      return '/home';
    case 'notifications':
      return '/notifications';
    case 'saved':
      return '/saved';
    case 'post':
      return `/post/${seg(intent.id)}`;
    case 'profile':
      return `/profile/${seg(intent.username)}`;
    case 'community':
      return `/communities/${seg(intent.id)}`;
    case 'activity':
      return `/crew/${seg(intent.id)}`;
    case 'event':
      return `/campus/events/${seg(intent.id)}`;
    case 'chat':
      return `/messages/${seg(intent.conversationId)}`;
    case 'settings':
      return intent.panel ? `/settings/${seg(intent.panel)}` : '/settings';
    default:
      return null;
  }
}
