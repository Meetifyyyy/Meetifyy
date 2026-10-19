import { Link } from 'react-router-dom';
import { config, IS_MOBILE_BUILD } from '@config';

/**
 * A Terms / Privacy link inside the signup form.
 *
 * Website: a new tab, as before. Installed app: `target="_blank"` loads the
 * app's own `/terms-and-conditions` into the SAME WebView (it has no second
 * window), which reloads the whole document, discarding everything typed and
 * the person's place, and the legal route then steps back to the opening
 * screen. Instead the click hands the website's address straight to the system
 * browser (the WebViewClient sends any other host to the OS) without
 * navigating the app, so the form stays mounted exactly as it was.
 */
export default function LegalLink({ path, className, children }) {
  if (IS_MOBILE_BUILD) {
    const href = `${config.app.siteUrl}${path}`;
    return (
      <a
        href={href}
        className={className}
        rel="noopener noreferrer"
        onClick={(e) => {
          e.preventDefault();
          window.location.assign(href);
        }}
      >
        {children}
      </a>
    );
  }
  return (
    <Link to={path} target="_blank" rel="noopener noreferrer" className={className}>
      {children}
    </Link>
  );
}
