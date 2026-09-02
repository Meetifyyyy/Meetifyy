/**
 * Deterministic fallback covers for an activity with no image of its own.
 *
 * Split out of `presetMedia.js`, which also holds the full 36-image and GIF
 * picker catalogues — about 47 kB of metadata. `SocketManager` is mounted for
 * the whole session and needs only `getDefaultActivityCover`, so importing it
 * from the same module dragged that entire catalogue into the entry chunk, on
 * every page load, to pick one of six URLs. The catalogue now loads only with
 * the picker that displays it.
 */
export const DEFAULT_ACTIVITY_COVERS = [
  "https://pub-8cd64731b2bc47deb8a54acbbbfa9c4b.r2.dev/presets/images/preset-image-party-img-party-1.webp",
  "https://pub-8cd64731b2bc47deb8a54acbbbfa9c4b.r2.dev/presets/images/preset-image-party-img-party-2.webp",
  "https://pub-8cd64731b2bc47deb8a54acbbbfa9c4b.r2.dev/presets/images/preset-image-party-img-party-3.webp",
  "https://pub-8cd64731b2bc47deb8a54acbbbfa9c4b.r2.dev/presets/images/preset-image-party-img-party-4.webp",
  "https://pub-8cd64731b2bc47deb8a54acbbbfa9c4b.r2.dev/presets/images/preset-image-party-img-party-5.webp",
  "https://pub-8cd64731b2bc47deb8a54acbbbfa9c4b.r2.dev/presets/images/preset-image-party-img-party-6.webp"
];

/**
 * Helper to get a deterministic cover from an activity ID or title.
 */
export function getDefaultActivityCover(idOrTitle = '') {
  const seed = String(idOrTitle || '');
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash << 5) - hash + seed.charCodeAt(i);
    hash |= 0;
  }
  return DEFAULT_ACTIVITY_COVERS[Math.abs(hash) % DEFAULT_ACTIVITY_COVERS.length];
}
