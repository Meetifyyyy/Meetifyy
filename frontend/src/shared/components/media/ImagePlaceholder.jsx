import { useEffect, useState } from 'react';
import { safePlaceholder } from '@shared/utils/imagePlaceholder';
import styles from './ImagePlaceholder.module.css';

/**
 * When the blur is removed: the image's own fade-in (0.3s) plus the blur's
 * fade-out, which waits for it (see the CSS), with a little margin.
 */
const FADE_MS = 600;

/**
 * A blurred stand-in for an image that has not loaded yet.
 *
 * Fills its (positioned) parent, so it takes the box the parent already
 * reserved from the real width and height: it cannot move the layout. Like the
 * skeleton it replaces it is drawn above the image; once `done` it holds while
 * the image fades in underneath, then fades out over an opaque image (never
 * both half-transparent at once, which showed the empty tile), and unmounts so
 * a finished feed carries no blurred layers.
 *
 * An image that was already cached (`instant`) takes the layer away at once,
 * and the layer itself stays invisible for the first moment (see the CSS), so a
 * cached picture never shows the blur at all.
 *
 * Renders nothing for a missing or malformed value, which is what lets a caller
 * fall back to its existing skeleton: `<ImagePlaceholder>` returning null IS
 * the "no placeholder" case.
 */
export default function ImagePlaceholder({ src, done = false, instant = false, className = '' }) {
  const safe = safePlaceholder(src);
  // A tile remounted for an image that already loaded (a virtualised feed
  // scrolling back) never needs the layer at all.
  const [gone, setGone] = useState(done);

  useEffect(() => {
    if (!done) { setGone(false); return undefined; }
    const timer = setTimeout(() => setGone(true), FADE_MS);
    return () => clearTimeout(timer);
  }, [done]);

  // `instant`: the image came out of the cache, so there is nothing to bridge —
  // a blur that faded out over it would be the flicker this layer exists to hide.
  if (!safe || gone || (done && instant)) return null;
  return (
    <div
      className={`${styles.placeholder} ${done ? styles.done : ''} ${className}`}
      style={{ backgroundImage: `url("${safe}")` }}
      data-testid="image-placeholder"
      aria-hidden="true"
    />
  );
}

/** Whether `src` would render a placeholder (so a caller can drop its skeleton). */
export const hasPlaceholder = (src) => safePlaceholder(src) !== null;
