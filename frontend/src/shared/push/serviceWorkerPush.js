import { Intents, parseIntent } from '../../core/navigation/intents';

/**
 * The service worker's push handling, kept out of src/sw.js so it can be
 * tested without a worker. See docs/push-notifications.md.
 *
 * The server sends `{ title, body, tag, renotify, data }` where `data` is an
 * Intent in its push wire format (core/navigation/intents.ts
 * `intentToPushData`) — never a URL. A click is resolved through `parseIntent`
 * and the fixed table below, so a payload can only ever open one of the app's
 * own routes on this origin.
 */

/** Bounded, single-line text for the notification UI. */
export const pushText = (value, max) =>
  typeof value === 'string' ? value.replace(/\p{Cc}/gu, ' ').slice(0, max) : '';

/**
 * Intent -> in-app path, for the destinations a push can name. Mirrors
 * src/mobile/navigation/intentToRoute.js and shared/push/intentPath.js;
 * anything else opens the notifications page.
 */
export function pushPath(intent) {
  const seg = (v) => encodeURIComponent(v);
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
      return `/messages/${seg(intent.conversationId)}${intent.panel === 'requests' ? '?panel=requests' : ''}`;
    default:
      return '/notifications';
  }
}

const windowsOf = (clients) => clients.matchAll({ type: 'window', includeUncontrolled: true });

/** `push` event: show it, unless the app is in front of the person already. */
export async function handlePush({ payload, clients, registration }) {
  const intent = parseIntent(payload?.data) || Intents.notifications();
  // The focused, visible page already showed this through its live socket
  // (bell, chat badge). Tell it and stack no OS notification on top. Only
  // then: a push that shows nothing otherwise is penalised (userVisibleOnly).
  const wins = await windowsOf(clients);
  const front = wins.find((w) => w.visibilityState === 'visible' && w.focused);
  if (front) {
    front.postMessage({ type: 'meetifyy:push-foreground', path: pushPath(intent) });
    return null;
  }
  const options = {
    body: pushText(payload?.body, 180),
    icon: '/logo-192.png',
    badge: '/favicon.png',
    tag: pushText(payload?.tag, 64) || undefined,
    renotify: Boolean(payload?.tag && payload?.renotify),
    // The validated intent only; it is validated again on click.
    data: intent,
  };
  await registration.showNotification(pushText(payload?.title, 80) || 'Meetifyy', options);
  return options;
}

/** `notificationclick`: focus this site's window and route in-app, or open one. */
export async function handleNotificationClick({ data, clients, origin }) {
  const intent = parseIntent(data) || Intents.notifications();
  const path = pushPath(intent);
  const wins = await windowsOf(clients);
  const own = wins.find((w) => {
    try {
      return new URL(w.url).origin === origin;
    } catch {
      return false;
    }
  });
  if (own) {
    await own.focus();
    // The page routes it (PushSync), after validating the path again.
    own.postMessage({ type: 'meetifyy:push-open', path });
    return path;
  }
  await clients.openWindow(new URL(path, origin).href);
  return path;
}
