/**
 * Normalizes a raw backend CrewActivity into the shape the UI (CrewCard, detail
 * pages, campus lists) expects: formatted dates, host fields flattened, member
 * arrays split into participants/pending, and slot counts. Pure and idempotent
 * on its own output, so it is safe to memoize per raw list.
 */
export function mapActivity(a) {
  if (!a || typeof a !== 'object') return a;
  const startDate = a.startDate ? new Date(a.startDate) : null;
  const endDate = a.endDate ? new Date(a.endDate) : null;

  const dateFormatted = startDate ? startDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : null;
  const dateLabelFormatted = startDate ? startDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : null;
  const timeFormatted = startDate ? startDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : null;

  const endDateFormatted = endDate ? endDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : null;
  const endTimeFormatted = endDate ? endDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : null;

  const hostId = a.hostId || a.creatorId || a.creator?.id || a.host?.id;

  const memberParticipants = Array.isArray(a.members)
    ? a.members
        .filter(m => m && (!m.status || m.status === 'MEMBER' || m.status === 'ACCEPTED'))
        .map(m => typeof m === 'object' ? (m.userId || m.id || m.user?.id) : m)
        .filter(Boolean)
    : [];

  const existingParticipants = Array.isArray(a.participants)
    ? a.participants.map(p => typeof p === 'object' ? (p.userId || p.id || p.user?.id) : p).filter(Boolean)
    : [];

  // ── Authoritative participant set ─────────────────────────────────────────
  // patchActivity (optimistic updater) maintains `a.participants` as the
  // canonical attendee list, adding/removing the current user in place.
  // We union member IDs into it but NEVER drop IDs that are already there,
  // so an optimistic +1 is never undone by a sparse `members` array (the
  // backend only includes `take:5` members in list-cache responses).
  const allParticipantIds = Array.from(new Set([
    ...(hostId ? [hostId] : []),
    ...existingParticipants,   // already-patched optimistic IDs come first
    ...memberParticipants,     // union any extra server-side members on top
  ]));

  const pendingRequests = Array.isArray(a.members)
    ? a.members.filter(m => m && m.status === 'PENDING').map(m => m.userId || m.id).filter(Boolean)
    : (Array.isArray(a.pendingRequests) ? a.pendingRequests : []);

  const membersData = Array.isArray(a.members)
    ? a.members.map(m => m?.user || (typeof m === 'object' ? m : null)).filter(Boolean)
    : (Array.isArray(a._membersData) ? a._membersData : []);

  const count = Math.max(allParticipantIds.length, 1);

  return {
    ...a,
    date: a.startDate || a.date || null,
    endDate: a.endDate || null,
    dateFormatted: a.dateFormatted || dateFormatted,
    dateLabel: a.dateLabel || dateLabelFormatted,
    time: a.time || timeFormatted,
    endTime: a.endTime || endTimeFormatted,
    endDateFormatted: a.endDateFormatted || endDateFormatted,
    hostId,
    hostName: a.hostName || a.creator?.displayName || a.members?.find(m => (m?.userId || m?.id || m?.user?.id) === hostId)?.user?.displayName || 'Host',
    hostUsername: a.hostUsername || a.creator?.username || a.members?.find(m => (m?.userId || m?.id || m?.user?.id) === hostId)?.user?.username || 'host',
    hostAvatar: a.hostAvatar || a.creator?.avatar || a.members?.find(m => (m?.userId || m?.id || m?.user?.id) === hostId)?.user?.avatar || '',
    participants: allParticipantIds,
    pendingRequests,
    slotsFilled: count,
    slotsNeeded: a.slotsNeeded || a.maxMembers || 999,
    _membersData: membersData,
  };
}


/**
 * The three shapes an activities cache entry can take, handled in one place.
 *
 *   - infinite list:  { pages: [{ activities: [...] }] }  (or a bare array page)
 *   - flat list:      [...]
 *   - discover:       { forYou: { items }, college: { items }, oneOnOne: {...} }
 *
 * Every writer used to know only the first shape, so a freshly created activity
 * landed in the public feed and nowhere else — including the composed payload
 * the Crew page actually renders.
 */
function mapActivityCache(old, mapList) {
  if (!old) return old;

  if (Array.isArray(old?.pages)) {
    return {
      ...old,
      pages: old.pages.map((page, i) => {
        if (Array.isArray(page?.activities)) return { ...page, activities: mapList(page.activities, i) };
        if (Array.isArray(page)) return mapList(page, i);
        return page;
      }),
    };
  }

  if (Array.isArray(old)) return mapList(old, 0);

  if (typeof old === 'object') {
    let touched = false;
    const next = {};
    for (const [key, value] of Object.entries(old)) {
      if (Array.isArray(value?.items)) {
        next[key] = { ...value, items: mapList(value.items, 0) };
        touched = true;
      } else {
        next[key] = value;
      }
    }
    return touched ? next : old;
  }

  return old;
}

/** Prepend an activity to the first page/section of a cache, deduped by id. */
export function insertActivityIntoCache(old, activity) {
  if (!activity?.id) return old;
  return mapActivityCache(old, (list, pageIndex) => {
    const without = list.filter((a) => a?.id !== activity.id);
    return pageIndex === 0 ? [activity, ...without] : without;
  });
}

/** Swap a placeholder activity for the server's version, in place. */
export function replaceActivityInCache(old, tempId, activity) {
  if (!tempId || !activity?.id) return old;
  return mapActivityCache(old, (list) => list.map((a) => (a?.id === tempId ? activity : a)));
}
