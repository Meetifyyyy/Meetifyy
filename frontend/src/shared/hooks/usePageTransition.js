import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { hasPageTransitionDriver, openPage, withPageTransition } from '@shared/lib/navigation/pageTransition';

/**
 * Opens a page with the shared open/close motion (see
 * `shared/lib/navigation/pageTransition.js`).
 *
 *   const { open } = usePageTransition();
 *   open(`/post/${id}`, { state: { post } }, { effect: 'centre' });
 *
 *   // or, for a component that opens everything the same way:
 *   const { open } = usePageTransition({ effect: CENTRE_EFFECT });
 *   open(`/post/${id}`, { state: { post } });
 *
 * `open` takes exactly what `navigate` does, plus an optional third argument.
 * `effect` picks the motion ('slide', the default, or 'centre'), per call or as
 * the hook's default; the page then closes with that same effect from its own
 * back button or Android's back, with nothing else to wire. On the website it
 * is a plain `navigate`.
 */
export function usePageTransition({ effect: defaultEffect } = {}) {
  const navigate = useNavigate();

  /**
   * `onNavigate` runs together with the navigation, after the screen has been
   * pictured: what closes the surface the page was opened from (a drawer, a
   * menu) belongs there, so it closes out of sight under the new page.
   */
  const open = useCallback(
    (to, options = {}, { onNavigate, effect = defaultEffect } = {}) => {
      openPage(() => {
        navigate(to, { ...options, state: withPageTransition(options.state, effect) });
        onNavigate?.();
      }, effect);
    },
    [navigate, defaultEffect]
  );

  /**
   * For a `<Link>`'s onClick: in the app, opens with the motion instead of the
   * link's own navigation. On the website it does nothing and the link behaves
   * exactly as before (new-tab clicks included).
   */
  const openFromLink = useCallback(
    (event, to, options, extra) => {
      if (!hasPageTransitionDriver()) return;
      event.preventDefault();
      open(to, options, extra);
    },
    [open]
  );

  return { open, openFromLink };
}

export default usePageTransition;
