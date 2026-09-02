/**
 * The canonical blue default avatar, as inline SVG markup.
 *
 * This is the *same* artwork as `frontend/public/default_avatar.svg` and as the
 * inline fallback drawn by the front-end `Avatar` component. It exists here as
 * well because `GET /api/media/*` has to answer an `<img>` that asked for an
 * avatar it could not resolve, and that response must look identical to the
 * fallback the client would have drawn itself — otherwise the same absent
 * avatar renders as two different pictures depending on which layer noticed.
 *
 * That is not hypothetical: this endpoint used to answer with a grey silhouette
 * (`#e2e8f0` disc, `#94a3b8` figure) while every client-side path drew the blue
 * one, so accounts with no picture appeared grey in production and blue in every
 * component test. Recolouring one copy at a time is what made the bug survive
 * two separate fixes, so if this artwork changes it must change in all four
 * places at once: here, `frontend/public/default_avatar.svg`,
 * `frontend/public/default_avatar.webp`, and `backend/assets/defaults/`.
 */
export const DEFAULT_AVATAR_SVG = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none">
  <circle cx="12" cy="12" r="12" fill="#1d68f7"/>
  <circle cx="12" cy="8.5" r="2.5" fill="#ffffff"/>
  <path fill="#ffffff" d="M7 16.3c0-2.5 2.2-4.5 5-4.5s5 2 5 4.5c0 1.2-2.2 1.8-5 1.8s-5-0.6-5-1.8z"/>
</svg>
`.trim();
