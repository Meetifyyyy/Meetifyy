import { useLayoutEffect } from 'react';
import { IS_MOBILE_BUILD } from '@config';

/**
 * Lets a screen that draws its own imagery behind a system bar say so.
 *
 * In the installed app the bars are transparent and the page paints them (see
 * `src/mobile/installSystemBars.js`). By default a fixed strip continues
 * whatever the page paints at that edge, which is right for ordinary screens.
 * A screen that runs a photograph or a gradient all the way to the edge wants
 * the strip out of the way instead:
 *
 *   status: 'transparent'       the page draws behind the status bar
 *   navigation: 'transparent'   the page draws behind the navigation bar
 *   statusIcons / navigationIcons: 'light' | 'dark'
 *                               the icons' appearance where the colour beneath
 *                               them is not something the page can be sampled for
 *   canvas: true                the document behind the screen takes the screen's
 *                               own bottom colour. For a full-screen dark page
 *                               over the light theme: while the WebView is being
 *                               resized (the keyboard opening or closing) the
 *                               strip it exposes is the document, not the page,
 *                               and was a light patch across a dark screen.
 *
 * It writes attributes on <html>, in a LAYOUT effect: that runs in the same
 * commit that mounts the screen, before the frame paints, so the bars change
 * with the screen in one frame. (A plain effect runs after paint, which is a
 * frame of the previous screen's bars under the new screen.)
 *
 * A stack rather than save-and-restore. Two screens can overlap while one
 * leaves and another arrives, and restoring "whatever was there when I
 * mounted" then puts back a value that has already been superseded. Here the
 * most recent screen that asked for a setting wins, and the setting goes when
 * the last one asking for it does.
 *
 * Inert on the website: `IS_MOBILE_BUILD` is a build-time literal, so the
 * attributes are never written there.
 */

const ATTRIBUTES = {
  status: 'data-bars',
  statusIcons: 'data-status-bar-icons',
  navigation: 'data-navigation-bar',
  navigationIcons: 'data-navigation-bar-icons',
  canvas: 'data-bars-canvas',
};

const requests = [];

function apply() {
  const root = document.documentElement;
  for (const [key, attribute] of Object.entries(ATTRIBUTES)) {
    let value = null;
    for (let i = requests.length - 1; i >= 0; i -= 1) {
      if (requests[i].config[key] != null) {
        value = requests[i].config[key] === true ? '' : requests[i].config[key];
        break;
      }
    }
    if (value === null) root.removeAttribute(attribute);
    else if (root.getAttribute(attribute) !== value) root.setAttribute(attribute, value);
  }
}

export function useSystemBars(config, enabled = true) {
  const key = JSON.stringify(config);
  useLayoutEffect(() => {
    if (!IS_MOBILE_BUILD || !enabled) return undefined;
    const request = { config: JSON.parse(key) };
    requests.push(request);
    apply();
    return () => {
      requests.splice(requests.indexOf(request), 1);
      apply();
    };
  }, [key, enabled]);
}

export default useSystemBars;
