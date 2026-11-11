import { useCallback, useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { closePage, openPage, withPageTransition } from '@shared/lib/navigation/pageTransition';
import { SLIDE_EFFECT } from '@shared/lib/navigation/slideTransition';

/**
 * A screen inside the chat (details, its settings, its gallery) addressed by a
 * query parameter, opened and closed with the app's page slide.
 *
 * Opening pushes `?<param>=<value>` with the slide's mark on the entry, through
 * `openPage`, so the shell pictures the screen, the page changes underneath and
 * the new one slides in. The mark is what makes the phone's Back replay the
 * slide in reverse (`closePage` in mobile/main.jsx) with nothing else wired.
 * The screen's own back arrow does the same: it pops the entry it pushed, so
 * Back and the arrow leave the history exactly as it was.
 *
 * A screen reached some other way (a reload, a shared link) has no entry of
 * ours behind it: closing drops the parameter in place, without the motion,
 * rather than walking the user out of the chat.
 *
 * On the website (no driver) both are plain navigations.
 *
 * Returns `[isOpen, open, close]`.
 */
export function useSlidePage(param, value) {
  const navigate = useNavigate();
  const location = useLocation();
  const isOpen = new URLSearchParams(location.search).get(param) === value;
  const pushed = useRef(false);

  useEffect(() => {
    if (!isOpen) pushed.current = false;
  }, [isOpen]);

  const searchWith = useCallback((edit) => {
    const params = new URLSearchParams(location.search);
    edit(params);
    const search = params.toString();
    return { pathname: location.pathname, search: search ? `?${search}` : '' };
  }, [location.pathname, location.search]);

  const open = useCallback(() => {
    if (isOpen) return;
    pushed.current = true;
    const to = searchWith((p) => p.set(param, value));
    openPage(() => navigate(to, { state: withPageTransition(null, SLIDE_EFFECT) }), SLIDE_EFFECT);
  }, [isOpen, searchWith, param, value, navigate]);

  const close = useCallback(() => {
    if (!isOpen) return;
    if (pushed.current) {
      pushed.current = false;
      closePage(() => navigate(-1));
      return;
    }
    navigate(searchWith((p) => p.delete(param)), { replace: true });
  }, [isOpen, searchWith, param, navigate]);

  return [isOpen, open, close];
}

export default useSlidePage;
