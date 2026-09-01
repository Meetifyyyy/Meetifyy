import { lazy, Suspense } from 'react';
// Resolved by the bundler to the emitted asset's hashed URL — a short string in
// the bundle, with the 424KB of JSON kept out of the JS graph entirely.
import emojiDataUrl from '@emoji-mart/data/sets/15/native.json?url';

/**
 * The picker's code and its emoji database are ~510KB raw (~110KB gzipped),
 * split into their own chunk so they never load with the app. The cost of that
 * split lands entirely on the first click: the chunk is fetched, parsed and
 * rendered while the user waits behind a "Loading emojis…" box.
 *
 * `loadEmojiPicker` is that work, held as a single promise so it can be started
 * *before* the click — on hover or focus of the emoji button — and awaited
 * again by the lazy component without fetching twice. Hover is usually a few
 * hundred milliseconds of warning, which is enough to cover the fetch on a
 * normal connection, so the picker opens instantly and the fallback is never
 * seen. On touch, where there is no hover, focus and the first tap still share
 * the same promise, so nothing is loaded twice.
 */
let emojiModules = null;

/**
 * The emoji database is fetched as a JSON *asset*, not imported as a module.
 *
 * `import('@emoji-mart/data')` looks equivalent and is much heavier on the
 * device: the bundler inlines all 424KB of it into a JavaScript chunk, so the
 * browser parses and evaluates it as source. Requested as a URL instead, Vite
 * emits it as a plain hashed .json file, and the browser reads it with its
 * native JSON parser — dramatically cheaper than JS parse for the same bytes,
 * and on a slow phone that difference is felt rather than measured.
 *
 * It also stops the data being welded to the picker's code chunk. They are now
 * two cacheable files that can be revalidated, evicted and re-fetched
 * independently, and a picker code change no longer invalidates 424KB of emoji
 * the device already had.
 *
 * `?url` gives the emitted asset's hashed path, so the file is content-hashed
 * and immutably cacheable like every other asset.
 */
export function loadEmojiPicker() {
  if (!emojiModules) {
    emojiModules = Promise.all([
      fetch(emojiDataUrl).then((res) => {
        if (!res.ok) throw new Error(`emoji data ${res.status}`);
        return res.json();
      }),
      import('@emoji-mart/react'),
    ]).catch((err) => {
      // A failed preload must not poison the real open: clear the cache so the
      // click retries rather than replaying a rejected promise forever.
      emojiModules = null;
      throw err;
    });
  }
  return emojiModules;
}

/** Start the download without rendering anything. Safe to call repeatedly. */
export function preloadEmojiPicker() {
  loadEmojiPicker().catch(() => {});
}

const EmojiMartPicker = lazy(async () => {
  const [data, pickerModule] = await loadEmojiPicker();
  const Picker = pickerModule.default;

  return {
    default: (props) => <Picker data={data} {...props} />
  };
});

export default function LazyEmojiPicker(props) {
  const isDark =
    typeof document !== 'undefined' &&
    document.documentElement.getAttribute('data-theme') === 'dark';

  const mergedProps = {
    theme: props.theme || (isDark ? 'dark' : 'light'),
    previewPosition: 'none',
    skinTonePosition: 'search',
    navPosition: 'top',
    perLine: 9,
    maxFrequentRows: 2,
    ...props,
  };

  return (
    <Suspense
      fallback={
        /* Sized to the picker it replaces (see the `em-emoji-picker` rule in
           global.css), so the panel does not resize under the cursor when the
           real thing arrives. */
        <div
          style={{
            width: 'min(352px, calc(100vw - 24px))',
            height: 'min(420px, 65vh)',
            display: 'grid',
            placeItems: 'center',
            fontSize: '0.85rem',
            color: 'var(--color-text-muted)',
            background: 'var(--color-bg-white)',
            borderRadius: 'var(--radius-lg, 14px)',
            border: '1px solid var(--color-border)',
          }}
          role="status"
        >
          Loading emojis...
        </div>
      }
    >
      <EmojiMartPicker {...mergedProps} />
    </Suspense>
  );
}
