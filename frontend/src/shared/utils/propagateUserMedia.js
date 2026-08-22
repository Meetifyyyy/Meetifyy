import { idbGet, idbSet } from '@shared/lib/idb';

/**
 * Pushes a user's changed avatar, cover or display name into every cached React
 * Query payload that embeds it, so the change is visible everywhere on the next
 * paint.
 *
 * Why this exists: a user's identity fields are denormalised across most responses —
 * `post.author.avatar`, `comment.user.avatar`, `conversation.participants[].avatar`,
 * search hits, directory cards, activity members. Invalidating one profile query
 * fixes the profile page and nothing else, and invalidating everything means the
 * UI shows the old image until each refetch lands. Patching the cache in place
 * updates all of them synchronously, with no network round-trip.
 *
 * Invalidation should still follow for eventual consistency; this only removes
 * the visible lag.
 *
 * Note on image caching: upload keys are random per upload (`randomBytes(16)`),
 * so a new avatar always has a new URL. There is deliberately no cache-busting
 * query parameter here — the old URL is simply never referenced again, and
 * appending one would defeat the long-lived caching of genuinely immutable
 * media.
 */

/**
 * Mirrors the patch into the IndexedDB `profiles` store.
 *
 * useProfile() writes every fetched profile there and re-seeds the query from it
 * on a later mount. Patching only the in-memory query cache therefore fixed the
 * current view but not the next one: navigating away and back re-hydrated the
 * OLD avatar from disk and it reappeared. Fire-and-forget — a failure here costs
 * a stale seed that the network response then corrects, never a broken render.
 *
 * @param {string|undefined} username
 * @param {Record<string, unknown>} patch
 */
function patchStoredProfile(username, patch) {
  if (!username) return;
  const key = String(username).toLowerCase();
  idbGet('profiles', key)
    .then((cached) => {
      if (!cached?.value || typeof cached.value !== 'object') return;
      idbSet('profiles', key, { ...cached.value, ...patch });
    })
    .catch(() => {});
}

/**
 * @param {import('@tanstack/react-query').QueryClient} queryClient
 * @param {{ userId: string, username?: string, avatar?: string|null, cover?: string|null, displayName?: string }} change
 * @returns {number} how many embedded copies were patched (useful for debugging)
 */
export function propagateUserMedia(queryClient, { userId, username, avatar, cover, displayName } = {}) {
  if (!queryClient || !userId) return 0;

  const setsAvatar = avatar !== undefined;
  const setsCover = cover !== undefined;
  // `displayName` rides along for the same reason the images do: it is inlined
  // into post authors, comment authors, chat participants and member lists, so
  // renaming yourself otherwise left the old name on every one of them until
  // each query happened to refetch.
  const setsDisplayName = displayName !== undefined;
  if (!setsAvatar && !setsCover && !setsDisplayName) return 0;

  let patchedCount = 0;

  // Memo keyed by the ORIGINAL node: shared references inside one payload must
  // resolve to the same patched object, and it doubles as a cycle guard.
  const memo = new Map();

  const walk = (node) => {
    if (node === null || typeof node !== 'object') return node;
    if (memo.has(node)) return memo.get(node);
    // Seed with the original so a cycle resolves instead of recursing forever.
    memo.set(node, node);

    if (Array.isArray(node)) {
      let changed = false;
      const next = node.map((item) => {
        const walked = walk(item);
        if (walked !== item) changed = true;
        return walked;
      });
      const result = changed ? next : node;
      memo.set(node, result);
      return result;
    }

    // Leave non-plain objects (Date, Map, File, class instances) alone — they are
    // never user payloads and copying them would corrupt them.
    const proto = Object.getPrototypeOf(node);
    if (proto !== Object.prototype && proto !== null) {
      memo.set(node, node);
      return node;
    }

    let result = node;
    let changed = false;

    // A user-shaped node for this user, and it actually carries an image field.
    // The field check prevents rewriting unrelated objects that merely happen to
    // share the id (a post id equal to a user id, say).
    //
    // `userId` counts as well as `id`. Several payloads identify a person by
    // `userId` and inline their avatar beside it rather than nesting a `user`
    // object — a group's `memberDetails: [{ userId, role, displayName, avatar }]`
    // is the one that showed: those entries kept the old picture in Group
    // Details and in the invite picker built from them.
    const identifiesUser = node.id === userId || node.userId === userId;
    const isThisUser =
      identifiesUser &&
      ('avatar' in node || 'avatarUrl' in node || 'cover' in node || 'displayName' in node);

    if (isThisUser) {
      const merged = { ...node };
      if (setsAvatar) {
        if ('avatar' in node) merged.avatar = avatar;
        // Several components read `avatarUrl`; keep both spellings in step.
        if ('avatarUrl' in node) merged.avatarUrl = avatar;
      }
      if (setsCover && 'cover' in node) merged.cover = cover;
      if (setsDisplayName && 'displayName' in node) merged.displayName = displayName;
      result = merged;
      changed = true;
      patchedCount += 1;
    }

    for (const key of Object.keys(result)) {
      const value = result[key];
      const walked = walk(value);
      if (walked !== value) {
        if (!changed) {
          result = { ...result };
          changed = true;
        }
        result[key] = walked;
      }
    }

    const final = changed ? result : node;
    memo.set(node, final);
    return final;
  };

  // Empty filters = every cached query. This is a rare, user-initiated action,
  // so a full pass is acceptable; it is far cheaper than refetching everything.
  queryClient.setQueriesData({}, (data) => (data === undefined ? data : walk(data)));

  // The query cache is memory-only; without this the next mount re-seeds the old
  // image straight back from IndexedDB.
  patchStoredProfile(username, {
    ...(setsAvatar ? { avatar } : {}),
    ...(setsCover ? { cover } : {}),
    ...(setsDisplayName ? { displayName } : {}),
  });

  return patchedCount;
}
