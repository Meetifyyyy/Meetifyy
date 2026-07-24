/**
 * Server-side scoring mirror of the frontend matchScoring.js.
 * Keeps matching logic authoritative on the backend.
 */

export interface QueueEntryContext {
  area?: string | null;
  optionalDetail?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  interests?: string[];
}

function haversineDistanceKm(
  lat1: number, lon1: number,
  lat2: number, lon2: number,
): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function computeMatchScore(
  a: QueueEntryContext,
  b: QueueEntryContext,
): number {
  let score = 0;

  // Same campus area
  if (a.area && b.area && a.area === b.area) {
    score += 3;
  }

  // Similar optional detail (e.g. same subject)
  if (
    a.optionalDetail &&
    b.optionalDetail &&
    a.optionalDetail.trim().toLowerCase() === b.optionalDetail.trim().toLowerCase()
  ) {
    score += 2;
  }

  // GPS proximity
  if (a.latitude != null && a.longitude != null && b.latitude != null && b.longitude != null) {
    const dist = haversineDistanceKm(a.latitude, a.longitude, b.latitude, b.longitude);
    if (dist < 0.1) {
      score += 2; // within 100 m
    } else if (dist < 0.3) {
      score += 1; // within 300 m
    }
  }

  // Shared interests
  if (a.interests?.length && b.interests?.length) {
    const shared = a.interests.filter(i => b.interests!.includes(i));
    if (shared.length > 0) score += 1;
  }

  return score;
}
