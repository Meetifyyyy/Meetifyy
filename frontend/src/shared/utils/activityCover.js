/**
 * Deterministic fallback cover for an activity with no image of its own.
 *
 * Hashed from the id/title so a given activity always shows the same cover
 * rather than flickering between renders.
 *
 * Lives here because three call sites needed it and one of them instead pointed
 * at `/default_activity.webp`, a file that does not exist in `public/` — so its
 * fallback 404'd, including the onError handler meant to catch the first
 * failure.
 */
export const DEFAULT_ACTIVITY_COVERS = [
  'https://images.unsplash.com/photo-1540575467063-178a50c2df87?q=80&w=800&auto=format&fit=crop',
  'https://images.unsplash.com/photo-1492684223066-81342ee5ff30?q=80&w=800&auto=format&fit=crop',
  'https://images.unsplash.com/photo-1511556532299-8f662fc26c06?q=80&w=800&auto=format&fit=crop',
  'https://images.unsplash.com/photo-1505373877841-8d25f7d46678?q=80&w=800&auto=format&fit=crop',
  'https://images.unsplash.com/photo-1528605248644-14dd04022da1?q=80&w=800&auto=format&fit=crop',
  'https://images.unsplash.com/photo-1551818255-e6e10975bc17?q=80&w=800&auto=format&fit=crop',
];

export function getDefaultActivityCover(idOrTitle = '') {
  const seed = String(idOrTitle || '');
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash << 5) - hash + seed.charCodeAt(i);
    hash |= 0;
  }
  return DEFAULT_ACTIVITY_COVERS[Math.abs(hash) % DEFAULT_ACTIVITY_COVERS.length];
}
