

export function filterActivities(activities, filters = {}) {
  if (!Array.isArray(activities)) return [];
  return activities.filter(a => {
    if (!a || typeof a !== 'object') return false;
    if (filters.category && a.category !== filters.category) return false;
    if (filters.search) {
      const q = filters.search.toLowerCase();
      if (!(a.title || '').toLowerCase().includes(q) &&
          !(a.hostName || '').toLowerCase().includes(q) &&
          !(a.category || '').toLowerCase().includes(q)) return false;
    }
    return true;
  });
}

