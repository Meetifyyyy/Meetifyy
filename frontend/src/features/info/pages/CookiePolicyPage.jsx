import { Link } from 'react-router-dom';
import StaticDocLayout from './StaticDocLayout';
import styles from './StaticDocLayout.module.css';
import { Mail } from '@shared/components/icons';
import { useCookieConsent } from '@shared/context/CookieConsentContext';

export default function CookiePolicyPage() {
  const { openPreferences } = useCookieConsent();

  return (
    <StaticDocLayout
      badge="Privacy & Security"
      title="Cookie Policy"
      subtitle="How Meetifyy uses browser storage to keep you signed in, remember your preferences, and make the app fast."
      effectiveDate="27 August 2026"
      noHeroCard
      leftAlign
    >
      <section className={styles.cleanSection}>
        <h2 className={styles.cleanSectionTitle}>Introduction</h2>
        <p className={styles.hierarchyParagraph} style={{ marginTop: '0.5rem' }}>
          This Cookie Policy explains how Meetifyy ("Meetifyy," "we," "our," or "us") uses browser
          storage technologies when you use our platform and related services (collectively, the
          "Platform"). Despite the name, Meetifyy does not use traditional HTTP tracking cookies
          for authentication or analytics. Instead, we rely on browser-side storage APIs
          (localStorage, sessionStorage, IndexedDB, and Service Worker caches) to deliver and
          support the Platform's features. This policy is supplementary to and should be read
          alongside our{' '}
          <Link to="/privacy-policy" style={{ color: 'var(--color-primary)', textDecoration: 'none', fontWeight: 500 }}>
            Privacy Policy
          </Link>
          .
        </p>
      </section>

      <section className={styles.cleanSection}>
        <h2 className={styles.cleanSectionTitle}>1. What Storage Technologies We Use</h2>
        <p className={styles.hierarchyParagraph} style={{ marginTop: '0.5rem' }}>
          We do not use HTTP cookies set by a web server for tracking or advertising purposes,
          and the cookieless analytics described in section 4 set no cookie either. The following
          browser storage mechanisms are used:
        </p>
        <ul className={styles.cleanBulletList}>
          <li className={styles.cleanBulletItem}>
            <span className={styles.cleanBulletDot} />
            <div className={styles.cleanBulletText}>
              <strong>localStorage:</strong> Persistent key-value storage that survives browser
              restarts. Used for your authentication session token (managed by Supabase), a
              lightweight user profile cache, your theme preference, recent search history,
              muted communities, and other functional preferences.
            </div>
          </li>
          <li className={styles.cleanBulletItem}>
            <span className={styles.cleanBulletDot} />
            <div className={styles.cleanBulletText}>
              <strong>sessionStorage:</strong> Temporary key-value storage cleared when the
              browser tab is closed. Used for signup and onboarding progress, password-reset
              security state, post-login redirect intents, navigation history state, and
              internal failover flags.
            </div>
          </li>
          <li className={styles.cleanBulletItem}>
            <span className={styles.cleanBulletDot} />
            <div className={styles.cleanBulletText}>
              <strong>IndexedDB:</strong> A structured browser database with two distinct
              uses. The first is a content cache ("meetifyy_cache") that stores your feed,
              community, activity, and profile data locally so pages load quickly from cached
              results while fresh data is fetched in the background. Every cached entry has a
              time-to-live and the entire cache is cleared when you sign out. The second is a
              message outbox ("meetifyy_outbox") used by the Service Worker to queue outgoing
              messages when you are briefly offline, so they can be sent once your connection
              is restored.
            </div>
          </li>
          <li className={styles.cleanBulletItem}>
            <span className={styles.cleanBulletDot} />
            <div className={styles.cleanBulletText}>
              <strong>Service Worker Cache Storage:</strong> Used to cache static app assets
              (JavaScript, CSS bundles, images) and Google Fonts so the app loads quickly and
              works reliably on slow or unstable connections. API responses for feeds and
              communities are also cached in a separate network-first cache and cleared on
              sign-out.
            </div>
          </li>
        </ul>
      </section>

      <section className={styles.cleanSection}>
        <h2 className={styles.cleanSectionTitle}>2. Categories of Storage We Use</h2>

        <h3 className={styles.cleanSectionSubTitle} style={{ marginTop: '1rem' }}>Essential Authentication and Security</h3>
        <p className={styles.hierarchyParagraph}>
          Required to keep you signed in and your account secure. Supabase, our authentication
          provider, stores a signed session token in localStorage. We also store a lightweight
          profile cache to load the app without an extra round-trip. These are necessary to use
          your account and cannot be disabled.
        </p>

        <h3 className={styles.cleanSectionSubTitle} style={{ marginTop: '1.25rem' }}>Functional Application Storage</h3>
        <p className={styles.hierarchyParagraph}>
          Stores your personal preferences between sessions: your light or dark theme, recent
          searches, muted communities, video volume, and view mode settings. This data is not
          shared with third parties and is not used for tracking.
        </p>

        <h3 className={styles.cleanSectionSubTitle} style={{ marginTop: '1.25rem' }}>Offline and Performance Storage</h3>
        <p className={styles.hierarchyParagraph}>
          Caches feeds, communities, activities, and profiles in IndexedDB so that pages render
          immediately from local data while fresh content is loaded in the background. Caches
          static assets and API responses via the Service Worker so the app is fast on poor
          connections and can continue functioning briefly when offline. Google Fonts (Inter)
          are downloaded from Google servers on the first visit and then cached locally by the
          Service Worker using a cache-first strategy with a one-year expiry, which prevents
          repeated requests to Google on subsequent visits. All performance caches are cleared
          when you sign out.
        </p>

        <h3 className={styles.cleanSectionSubTitle} style={{ marginTop: '1.25rem' }}>Temporary Application State</h3>
        <p className={styles.hierarchyParagraph}>
          Short-lived data stored for the duration of a browser session, including multi-step
          signup and onboarding progress, password-reset state, and internal navigation tracking.
          All sessionStorage data is cleared automatically when you close the browser tab.
        </p>
      </section>

      <section className={styles.cleanSection}>
        <h2 className={styles.cleanSectionTitle}>3. Third-Party Services</h2>
        <p className={styles.hierarchyParagraph} style={{ marginTop: '0.5rem' }}>
          Meetifyy integrates the following external services. <strong>No advertising networks
          or cross-site tracking services are used.</strong>
        </p>
        <ul className={styles.cleanBulletList}>
          <li className={styles.cleanBulletItem}>
            <span className={styles.cleanBulletDot} />
            <div className={styles.cleanBulletText}>
              <strong>Supabase:</strong> Provides authentication and database services. The
              Supabase JavaScript client manages your session token in localStorage. Their
              processing is governed by the{' '}
              <a href="https://supabase.com/privacy" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--color-primary)', textDecoration: 'none' }}>Supabase Privacy Policy</a>.
            </div>
          </li>
          <li className={styles.cleanBulletItem}>
            <span className={styles.cleanBulletDot} />
            <div className={styles.cleanBulletText}>
              <strong>Google Fonts:</strong> On your first visit, the browser downloads the
              Inter typeface from Google font servers. This request may log your IP address
              per standard Google server logs. After the first load, the font is served from
              the Service Worker cache and no further requests are made to Google. Google's
              processing is governed by the{' '}
              <a href="https://policies.google.com/privacy" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--color-primary)', textDecoration: 'none' }}>Google Privacy Policy</a>.
            </div>
          </li>
          <li className={styles.cleanBulletItem}>
            <span className={styles.cleanBulletDot} />
            <div className={styles.cleanBulletText}>
              <strong>Cloudflare R2:</strong> Stores uploaded media files (profile photos,
              cover images, post attachments). Media is served directly from Cloudflare's
              content delivery network. Their processing is governed by the{' '}
              <a href="https://www.cloudflare.com/privacypolicy/" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--color-primary)', textDecoration: 'none' }}>Cloudflare Privacy Policy</a>.
            </div>
          </li>
          <li className={styles.cleanBulletItem}>
            <span className={styles.cleanBulletDot} />
            <div className={styles.cleanBulletText}>
              <strong>Vercel:</strong> Hosts the Platform and provides the cookieless Web
              Analytics and Speed Insights described in section 4. These count page views and
              measure page-load speed without setting a cookie or storing any identifier on your
              device. Their processing is governed by the{' '}
              <a href="https://vercel.com/legal/privacy-policy" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--color-primary)', textDecoration: 'none' }}>Vercel Privacy Policy</a>.
            </div>
          </li>
        </ul>
      </section>

      <section className={styles.cleanSection}>
        <h2 className={styles.cleanSectionTitle}>4. Analytics and Advertising</h2>
        <p className={styles.hierarchyParagraph} style={{ marginTop: '0.5rem' }}>
          We use <strong>Vercel Web Analytics</strong> and <strong>Vercel Speed Insights</strong>,
          provided by our hosting provider, to count page views and measure how quickly pages
          load. Both are <strong>cookieless</strong>: they set no cookie, store no identifier on
          your device, and cannot recognise you when you return or follow you to another website.
        </p>
        <p className={styles.hierarchyParagraph} style={{ marginTop: '0.75rem' }}>
          What they record is limited to the page visited, the referring page, your approximate
          location at country level, your device and browser type, and page-performance timings.
        </p>
        <p className={styles.hierarchyParagraph} style={{ marginTop: '0.75rem' }}>
          Meetifyy does <strong>not</strong> use Google Analytics, Facebook Pixel, or any
          advertising tracking service. We do not build advertising profiles, sell your data, or
          use cross-site tracking technologies.
        </p>
      </section>

      <section className={styles.cleanSection}>
        <h2 className={styles.cleanSectionTitle}>5. Managing Your Storage</h2>
        <p className={styles.hierarchyParagraph} style={{ marginTop: '0.5rem' }}>
          All storage used by Meetifyy supports core features, preferences, and performance. The
          analytics described in section 4 store nothing on your device, so there is no tracking
          identifier to clear or opt out of. You can view a summary of the storage categories we
          use:
        </p>
        <button
          onClick={openPreferences}
          style={{
            marginTop: '1rem',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.5rem',
            height: '38px',
            padding: '0 1.25rem',
            borderRadius: '999px',
            border: '1px solid var(--color-border-dark)',
            background: 'var(--color-bg-soft)',
            color: 'var(--color-text-main)',
            fontSize: '0.825rem',
            fontWeight: 600,
            cursor: 'pointer',
            fontFamily: 'inherit',
          }}
          aria-label="Open storage preferences detail"
        >
          View Storage Details
        </button>
        <p className={styles.hierarchyParagraph} style={{ marginTop: '1rem' }}>
          You can clear all browser storage associated with Meetifyy at any time by clearing
          your browser's site data for this site. Doing so will sign you out and reset all
          locally stored preferences.
        </p>
      </section>

      <section className={styles.cleanSection}>
        <h2 className={styles.cleanSectionTitle}>6. Changes to This Cookie Policy</h2>
        <p className={styles.hierarchyParagraph} style={{ marginTop: '0.5rem' }}>
          We may update this Cookie Policy when our technical infrastructure changes or when
          legal obligations require it. We will update the date at the top of this page when
          changes are made.
        </p>
      </section>

      <section className={styles.cleanSection} style={{ borderBottom: 'none' }}>
        <h2 className={styles.cleanSectionTitle}>7. Contact Us</h2>
        <p className={styles.hierarchyParagraph} style={{ marginTop: '0.5rem' }}>
          If you have questions about our use of browser storage technologies, please contact us:
        </p>
        <a href="mailto:app.meetifyy@gmail.com" className={styles.emailBtn} style={{ marginTop: '1rem', display: 'inline-flex' }}>
          <Mail size={18} />
          app.meetifyy@gmail.com
        </a>
      </section>
    </StaticDocLayout>
  );
}
