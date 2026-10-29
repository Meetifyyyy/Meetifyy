/**
 * Intents — "where does this go?", expressed without a router.
 *
 * Three different things need to name a destination: a URL the user opened, a
 * deep link the OS handed us, and a push payload. Today only the first exists
 * and it names a React Router path, so the other two would each invent their
 * own encoding, and all three would have to be rewritten together if the mobile
 * app ever moved to React Navigation.
 *
 * An Intent is the shared, router-independent middle. Producers (URL parser,
 * deep-link handler, push payload) emit one; each client resolves it with its
 * own `intentToRoute`, which is the single file a navigation-library change
 * touches. Nothing here imports a router, a DOM API, or `import.meta.env`.
 *
 * WIRE FORMAT. An Intent travels inside a push `data` payload, so it is
 * deliberately tiny and stringly-typed: `{ t, ...ids }`. `v` is the schema
 * version — an installed native app cannot be force-updated, so a payload
 * produced by a newer server will reach an older client, and that client has to
 * be able to recognise the fact rather than mis-route.
 *
 * SECURITY. A push payload is attacker-influenceable in principle and a deep
 * link certainly is. `parseIntent` validates shape and rejects anything it does
 * not recognise; callers must route only what it returns, never a raw payload.
 * Identifiers are carried as opaque strings and are never interpolated into a
 * path by a producer — resolution is the client's job.
 */

/** Bumped only when an existing intent's shape changes incompatibly. */
export const INTENT_VERSION = '1';

export type Intent =
  | { t: 'feed' }
  | { t: 'notifications' }
  | { t: 'saved' }
  | { t: 'profile'; username: string }
  | { t: 'post'; id: string }
  // `panel: 'requests'` opens the group's Join requests page (an admin's push
  // for a new request). A client older than the field opens the chat.
  | { t: 'chat'; conversationId: string; panel?: 'requests' }
  // An invite link, meetifyy.app/g/<code>.
  | { t: 'groupInvite'; code: string }
  | { t: 'community'; id: string }
  | { t: 'activity'; id: string }
  | { t: 'event'; id: string }
  | { t: 'settings'; panel?: string };

export type IntentType = Intent['t'];

/**
 * Constructors. Producers use these rather than object literals so a renamed
 * field is a type error at every call site instead of a silently missing key.
 */
export const Intents = {
  feed: (): Intent => ({ t: 'feed' }),
  notifications: (): Intent => ({ t: 'notifications' }),
  saved: (): Intent => ({ t: 'saved' }),
  profile: (username: string): Intent => ({ t: 'profile', username }),
  post: (id: string): Intent => ({ t: 'post', id }),
  chat: (conversationId: string, panel?: 'requests'): Intent =>
    panel ? { t: 'chat', conversationId, panel } : { t: 'chat', conversationId },
  groupInvite: (code: string): Intent => ({ t: 'groupInvite', code }),
  community: (id: string): Intent => ({ t: 'community', id }),
  activity: (id: string): Intent => ({ t: 'activity', id }),
  event: (id: string): Intent => ({ t: 'event', id }),
  settings: (panel?: string): Intent =>
    panel ? { t: 'settings', panel } : { t: 'settings' },
} as const;

const isNonEmptyString = (v: unknown): v is string =>
  typeof v === 'string' && v.length > 0 && v.length <= 200;

/** An invite link's code: letters and digits only, never a path. */
const isInviteCode = (v: unknown): v is string =>
  typeof v === 'string' && /^[0-9A-Za-z]{1,16}$/.test(v);

/**
 * Validates an untrusted object into an Intent, or returns null.
 *
 * Length-capped because these arrive from a push payload and a deep link; an
 * unbounded string here becomes an unbounded value interpolated into a route.
 * Unknown `t` returns null rather than throwing: a newer server's intent
 * reaching an older client is an expected condition, not an error, and the
 * client should fall back to opening the app rather than crashing.
 */
export function parseIntent(raw: unknown): Intent | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  switch (o.t) {
    case 'feed':
    case 'notifications':
    case 'saved':
      return { t: o.t } as Intent;
    case 'profile':
      return isNonEmptyString(o.username) ? Intents.profile(o.username) : null;
    case 'post':
      return isNonEmptyString(o.id) ? Intents.post(o.id) : null;
    case 'chat':
      return isNonEmptyString(o.conversationId)
        ? Intents.chat(o.conversationId, o.panel === 'requests' ? 'requests' : undefined)
        : null;
    case 'groupInvite':
      return isInviteCode(o.code) ? Intents.groupInvite(o.code) : null;
    case 'community':
      return isNonEmptyString(o.id) ? Intents.community(o.id) : null;
    case 'activity':
      return isNonEmptyString(o.id) ? Intents.activity(o.id) : null;
    case 'event':
      return isNonEmptyString(o.id) ? Intents.event(o.id) : null;
    case 'settings':
      return isNonEmptyString(o.panel) ? Intents.settings(o.panel) : Intents.settings();
    default:
      return null;
  }
}

/**
 * The backend's notification rows already carry `entityType` / `entityId`
 * (`NotificationEntityType` in schema.prisma: POST, COMMENT, COMMUNITY,
 * ACTIVITY, MESSAGE). Deriving the Intent from those rather than inventing a
 * parallel vocabulary is what keeps a notification, its push, and its in-app
 * row agreeing about where they lead.
 *
 * COMMENT maps to its post: there is no comment screen, a comment is read in
 * the post it belongs to. That needs the post id, so a COMMENT notification
 * whose metadata does not carry one yields null rather than a wrong
 * destination.
 */
export function intentFromNotificationEntity(
  entityType: string | null | undefined,
  entityId: string | null | undefined,
  extra?: { postId?: string | null },
): Intent | null {
  if (!isNonEmptyString(entityId) && entityType !== 'COMMENT') return null;
  switch (entityType) {
    case 'POST':
      return Intents.post(entityId as string);
    case 'COMMENT':
      return isNonEmptyString(extra?.postId) ? Intents.post(extra!.postId!) : null;
    case 'COMMUNITY':
      return Intents.community(entityId as string);
    case 'ACTIVITY':
      return Intents.activity(entityId as string);
    case 'MESSAGE':
      return Intents.chat(entityId as string);
    default:
      return null;
  }
}

/**
 * Parses an in-app path into an Intent.
 *
 * Takes a pathname, not a URL or a `Location`: this module must stay free of
 * DOM and of any assumption that a location object exists. Callers pass
 * `window.location.pathname` on web and the path component of a deep link on
 * native.
 *
 * Kept in step with the web route table in `src/App.jsx` by hand, and only for
 * the routes that are legitimate link and push destinations. A path this does
 * not recognise returns null, which callers treat as "just open the app".
 */
export function parseIntentFromPath(pathname: string): Intent | null {
  if (typeof pathname !== 'string' || !pathname.startsWith('/')) return null;
  // Strip query and fragment without indexing: under `noUncheckedIndexedAccess`
  // `split('?')[0]` is `string | undefined`, and chaining off it is exactly the
  // unchecked access that flag exists to catch.
  const path = pathname.split('?', 1).join('').split('#', 1).join('');
  const query = pathname.includes('?')
    ? pathname.slice(pathname.indexOf('?') + 1).split('#', 1).join('')
    : '';
  const seg = path.split('/').filter(Boolean);
  if (seg.length === 0) return null;

  switch (seg[0]) {
    case 'home':
      return Intents.feed();
    case 'notifications':
      return Intents.notifications();
    case 'saved':
      return Intents.saved();
    case 'post':
      return seg[1] ? Intents.post(seg[1]) : null;
    case 'profile':
      return seg[1] ? Intents.profile(seg[1]) : null;
    case 'communities':
      return seg[1] ? Intents.community(seg[1]) : null;
    case 'crew':
      // `/crew/create` is an action, not a destination worth linking into.
      return seg[1] && seg[1] !== 'create' ? Intents.activity(seg[1]) : null;
    case 'campus':
      return seg[1] === 'events' && seg[2] ? Intents.event(seg[2]) : null;
    // A conversation link is `/messages/<slug>/<id>` (what the app and the
    // invite button generate), `/messages/<id>`, or the older
    // `/messages/<id>/<slug>`; `/inbox/...` is the previous prefix and still
    // what group invite links carry. The id used to be read from the first
    // segment, which for the canonical form is the slug — so a shared invite
    // opened "a chat" named after the group, which does not exist.
    case 'messages':
    case 'inbox': {
      const id = conversationIdFromSegments(seg[1], seg[2]);
      const requests = /(?:^|&)panel=requests(?:&|$)/.test(query);
      return id ? Intents.chat(id, requests ? 'requests' : undefined) : null;
    }
    case 'g':
      return isInviteCode(seg[1]) ? Intents.groupInvite(seg[1]) : null;
    case 'settings':
      return Intents.settings(seg[1]);
    default:
      return null;
  }
}

/**
 * The conversation id in `/messages/<a>/<b>`. Mirrors parseConversationRoute
 * (shared/utils/conversationUrl.js), which this module may not import: a
 * single segment is the id; of two, the first is the id only when it looks
 * like one (a UUID or a legacy `c_` id), otherwise it is the slug.
 */
function conversationIdFromSegments(
  first: string | undefined,
  second: string | undefined,
): string | null {
  if (!first) return null;
  if (!second) return first;
  const looksLikeId =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(first) ||
    first.startsWith('c_');
  return looksLikeId ? first : second;
}

/**
 * The `data` block for a push payload.
 *
 * Flat and all-strings because FCM and APNs only carry string values. Nothing
 * from the notification's CONTENT goes in here.
 */
export function intentToPushData(intent: Intent): Record<string, string> {
  const data: Record<string, string> = { v: INTENT_VERSION, t: intent.t };
  switch (intent.t) {
    case 'profile':
      data.username = intent.username;
      break;
    case 'post':
    case 'community':
    case 'activity':
    case 'event':
      data.id = intent.id;
      break;
    case 'chat':
      data.conversationId = intent.conversationId;
      if (intent.panel) data.panel = intent.panel;
      break;
    case 'groupInvite':
      data.code = intent.code;
      break;
    case 'settings':
      if (intent.panel) data.panel = intent.panel;
      break;
    default:
      break;
  }
  return data;
}
