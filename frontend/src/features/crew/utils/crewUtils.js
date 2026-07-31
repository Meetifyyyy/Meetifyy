export const ACTIVITY_CATEGORIES = [
  'Sports', 'Learning', 'Professional', 'Travel', 'Creative', 'Social', 'Health & Fitness', 'Technology', 'Coffee', 'Meetup', 'Hackathon', 'Event'
];

export function getRecommendedByContext(currentUser, activities, allUsers) {
  const safeList = (Array.isArray(activities) ? activities : []).filter(a => a && typeof a === 'object');
  const shuffle = (arr) => {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };

  const recommended = shuffle(safeList).slice(0, 4);
  const happeningNearby = shuffle(safeList).filter(a => !a.isOnline).slice(0, 4);
  const startingSoon = safeList.slice(0, 4);
  const recentlyAdded = safeList.slice(0, 4); 
  const popular = [...safeList].sort((a, b) => (b.slotsFilled || 0) - (a.slotsFilled || 0)).slice(0, 4);

  return {
    recommended,
    happeningNearby,
    startingSoon,
    recentlyAdded,
    popular
  };
}

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

export function getUpcomingPlans(currentUser, activities) {
  if (!currentUser || !Array.isArray(activities)) return [];
  return activities.filter(a => a && (a.participants?.includes(currentUser.id) || a.hostId === currentUser.id)).slice(0, 4);
}
