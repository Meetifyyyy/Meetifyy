/**
 * Deterministic fallback cover for an activity with no image of its own.
 * Hashed from the id/title so a given activity always shows the same cover
 * rather than flickering between renders.
 * 
 * Powered by self-hosted Cloudflare R2 preset media.
 */
export {
  DEFAULT_ACTIVITY_COVERS,
  getDefaultActivityCover,
} from '../constants/activityCovers';
