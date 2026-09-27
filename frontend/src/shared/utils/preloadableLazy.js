import { lazy } from 'react';

/**
 * `React.lazy` that can be loaded ahead of time, and renders WITHOUT
 * suspending once it has been.
 *
 * Plain `lazy` suspends on first render even when the chunk is already in
 * memory: `import()` always hands back a fresh promise, and React has to wait
 * a tick for it. A route mounting new Suspense boundaries then commits their
 * fallback for that tick — a blank frame between two screens. Here, once the
 * module has loaded, the factory returns a thenable that calls back
 * synchronously, which React's lazy initialiser reads as already resolved.
 */
export function preloadableLazy(loader) {
  let loaded = null;
  let pending = null;

  const preload = () => {
    if (!pending) {
      pending = loader().then(
        (mod) => {
          loaded = mod;
          return mod;
        },
        (err) => {
          pending = null; // allow a retry after a failed load
          throw err;
        },
      );
    }
    return pending;
  };

  const Component = lazy(() => (loaded ? { then: (resolve) => resolve(loaded) } : preload()));
  Component.preload = preload;
  return Component;
}
