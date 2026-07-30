/**
 * Sorts group or community members by role priority, then by time in group.
 * Priority: Owner (0) > Admin (1) > Moderator (2) > Member (3)
 * Secondary: joinedAt ascending (earliest join time first = longest in group)
 */
export function sortGroupMembers(members, options = {}) {
  if (!Array.isArray(members)) return [];

  const { ownerId, hostId, creatorId, admins = [], users = {} } = options;
  const adminSet = new Set((admins || []).map(String));

  return [...members].sort((a, b) => {
    const getId = (item) => {
      if (typeof item === 'string') return item;
      return item?.userId || item?.id || '';
    };

    const idA = getId(a);
    const idB = getId(b);

    const objA = typeof a === 'object' && a !== null ? a : (users[idA] || Object.values(users).find(u => u?.id === idA) || {});
    const objB = typeof b === 'object' && b !== null ? b : (users[idB] || Object.values(users).find(u => u?.id === idB) || {});

    const getRolePriority = (item, id, obj) => {
      const roleStr = String(item?.role || obj?.role || '').toUpperCase();
      if (
        (ownerId && String(id) === String(ownerId)) ||
        (hostId && String(id) === String(hostId)) ||
        (creatorId && String(id) === String(creatorId)) ||
        roleStr === 'OWNER' ||
        roleStr === 'CREATOR'
      ) {
        return 0;
      }

      if (roleStr === 'MODERATOR' || roleStr === 'ADMIN' || adminSet.has(String(id))) {
        return 1;
      }

      return 2;
    };

    const prioA = getRolePriority(a, idA, objA);
    const prioB = getRolePriority(b, idB, objB);

    if (prioA !== prioB) {
      return prioA - prioB;
    }

    const getTime = (item, obj) => {
      const rawTime = item?.joinedAt || item?.createdAt || obj?.joinedAt || obj?.createdAt;
      if (!rawTime) return Infinity;
      const parsed = new Date(rawTime).getTime();
      return isNaN(parsed) ? Infinity : parsed;
    };

    const timeA = getTime(a, objA);
    const timeB = getTime(b, objB);

    if (timeA !== timeB) {
      return timeA - timeB;
    }

    const nameA = String(objA?.displayName || objA?.name || objA?.username || idA).toLowerCase();
    const nameB = String(objB?.displayName || objB?.name || objB?.username || idB).toLowerCase();
    return nameA.localeCompare(nameB);
  });
}
