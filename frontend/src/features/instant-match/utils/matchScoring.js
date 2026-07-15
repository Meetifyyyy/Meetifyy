export function haversineDistance(lat1, lon1, lat2, lon2) {
  const R = 6371; // radius of Earth in km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

export function computeScore(userA, userB) {
  let score = 0;

  // Same Campus and Same Activity and Same Time Preference are hard gates (handled in query/filter, not scoring)
  
  // Campus Area Dropdown Match
  if (userA.area && userB.area && userA.area === userB.area) {
    score += 3;
  }

  // Similar Optional Detail Match
  if (
    userA.optionalDetail &&
    userB.optionalDetail &&
    userA.optionalDetail.trim().toLowerCase() === userB.optionalDetail.trim().toLowerCase()
  ) {
    score += 2;
  }

  // GPS Proximity Match
  if (userA.gps && userB.gps) {
    const dist = haversineDistance(
      userA.gps.latitude,
      userA.gps.longitude,
      userB.gps.latitude,
      userB.gps.longitude
    );
    if (dist < 0.1) {
      score += 2; // within 100m
    } else if (dist < 0.3) {
      score += 1; // within 300m
    }
  }

  // Profile-level Interest Match (Phase 1 placeholder/mock)
  if (userA.interests && userB.interests) {
    const shared = userA.interests.filter(i => userB.interests.includes(i));
    if (shared.length > 0) {
      score += 1;
    }
  }

  return score;
}
