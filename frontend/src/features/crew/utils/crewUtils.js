export const ACTIVITY_CATEGORIES = [
  'Sports', 'Learning', 'Professional', 'Travel', 'Creative', 'Social', 'Health & Fitness', 'Technology', 'Coffee', 'Meetup', 'Hackathon', 'Event'
];

export function getRecommendedByContext(currentUser, activities, allUsers) {
  const shuffle = (arr) => {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };

  const recommended = shuffle(activities).slice(0, 4);
  const happeningNearby = shuffle(activities).filter(a => !a.isOnline).slice(0, 4);
  const startingSoon = activities.slice(0, 4);
  const recentlyAdded = activities.slice(0, 4); 
  const popular = [...activities].sort((a, b) => b.slotsFilled - a.slotsFilled).slice(0, 4);

  return {
    recommended,
    happeningNearby,
    startingSoon,
    recentlyAdded,
    popular
  };
}

export function filterActivities(activities, filters) {
  return activities.filter(a => {
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
  if (!currentUser) return [];
  return activities.filter(a => a.participants?.includes(currentUser.id) || a.hostId === currentUser.id).slice(0, 4);
}
