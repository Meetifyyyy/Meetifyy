import { useEffect, useRef } from 'react';
import PropTypes from 'prop-types';
import { useNavigate } from 'react-router-dom';
import { config } from '@config';

/**
 * Installed app only: the legal pages are not part of the APK.
 *
 * Every route that would render one renders this instead, which opens the same
 * path on the website in the system browser and steps back off the route, so
 * the app stays where the user was. Doing it at the route catches every way in:
 * a <Link>, a `navigate()` call, an internal link inside other HTML, or a deep
 * link.
 *
 * A top-level navigation, not `window.open`: the Capacitor WebView ignores
 * `window.open` (there is no Browser plugin), but its WebViewClient intercepts a
 * navigation to any host other than the app's own and hands it to the OS as a
 * view intent, so the page opens in the default browser and the app's document
 * is untouched. None of these paths are claimed by the App Links filter in
 * AndroidManifest.xml, so the browser does not bounce them back into the app.
 */
export default function OpenLegalOnWebsite({ path }) {
  const navigate = useNavigate();
  const opened = useRef(false);

  useEffect(() => {
    // StrictMode double-invokes effects in development; open the browser once.
    if (opened.current) return;
    opened.current = true;

    window.location.assign(`${config.app.siteUrl}${path}`);

    if (window.history.state?.idx > 0) navigate(-1);
    else navigate('/', { replace: true });
  }, [navigate, path]);

  return null;
}

OpenLegalOnWebsite.propTypes = {
  path: PropTypes.string.isRequired,
};
