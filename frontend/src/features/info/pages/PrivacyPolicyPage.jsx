import StaticDocLayout from './StaticDocLayout';
import styles from './StaticDocLayout.module.css';
import { Mail } from '@shared/components/icons';

export default function PrivacyPolicyPage() {
  return (
    <StaticDocLayout
      badge="Legal & Transparency"
      title="Privacy Policy"
      subtitle="How Meetifyy collects, uses, and protects your personal data."
      effectiveDate="27 August 2026"
      noHeroCard
      leftAlign
    >
      <section className={styles.cleanSection}>
        <h2 className={styles.cleanSectionTitle}>1. Introduction</h2>
        <p className={styles.hierarchyParagraph} style={{ marginTop: '0.5rem' }}>
          Welcome to Meetifyy ("Meetifyy," "we," "our," or "us"). This Privacy Policy describes how
          we collect, use, and handle your personal information when you use the Meetifyy platform,
          including our website, web application, and related services (collectively, the "Platform").
        </p>
        <p className={styles.hierarchyParagraph}>
          By creating an account or using the Platform, you acknowledge that you have read and
          understood this policy. If you have any questions, please contact us using the details at
          the end of this document.
        </p>
      </section>

      <section className={styles.cleanSection}>
        <h2 className={styles.cleanSectionTitle}>2. Personal Data We Collect</h2>
        <p className={styles.hierarchyParagraph} style={{ marginTop: '0.5rem' }}>
          We collect personal information in the following categories:
        </p>

        <h3 className={styles.cleanSectionSubTitle} style={{ marginTop: '1rem' }}>Data You Provide Directly</h3>
        <ul className={styles.cleanBulletList}>
          <li className={styles.cleanBulletItem}>
            <span className={styles.cleanBulletDot} />
            <div className={styles.cleanBulletText}>
              <strong>Account Information:</strong> Your full name, username, date of birth,
              college email address, and password when you register.
            </div>
          </li>
          <li className={styles.cleanBulletItem}>
            <span className={styles.cleanBulletDot} />
            <div className={styles.cleanBulletText}>
              <strong>Academic Details:</strong> Your college or university affiliation, course,
              branch, and current year of study.
            </div>
          </li>
          <li className={styles.cleanBulletItem}>
            <span className={styles.cleanBulletDot} />
            <div className={styles.cleanBulletText}>
              <strong>Profile Data:</strong> Your bio, profile photo, cover image, interests,
              and any other information you choose to add to your profile.
            </div>
          </li>
          <li className={styles.cleanBulletItem}>
            <span className={styles.cleanBulletDot} />
            <div className={styles.cleanBulletText}>
              <strong>User-Generated Content:</strong> Posts, comments, messages, media uploads,
              communities you join or create, events you create or attend, and reports you submit.
            </div>
          </li>
          <li className={styles.cleanBulletItem}>
            <span className={styles.cleanBulletDot} />
            <div className={styles.cleanBulletText}>
              <strong>Support Communications:</strong> Your name, email address, and any
              information you include when contacting our support team.
            </div>
          </li>
        </ul>

        <h3 className={styles.cleanSectionSubTitle} style={{ marginTop: '1.25rem' }}>Data Collected Automatically</h3>
        <ul className={styles.cleanBulletList}>
          <li className={styles.cleanBulletItem}>
            <span className={styles.cleanBulletDot} />
            <div className={styles.cleanBulletText}>
              <strong>Server Logs:</strong> Our servers may record IP addresses, request timestamps,
              and other standard HTTP log data as part of routine infrastructure operation and
              security monitoring.
            </div>
          </li>
        </ul>

        <h3 className={styles.cleanSectionSubTitle} style={{ marginTop: '1.25rem' }}>Browser Storage</h3>
        <p className={styles.hierarchyParagraph}>
          We use browser-side storage technologies (localStorage, sessionStorage, IndexedDB, and
          Service Worker caches) to keep you signed in, remember your preferences, and make the
          Platform faster. We do not use traditional tracking cookies, web beacons, or any
          advertising tracking technologies. We do use cookieless analytics to count page views
          and measure page speed, which store nothing on your device. For full details, see our{' '}
          <a href="/cookie-policy" style={{ color: 'var(--color-primary)', textDecoration: 'none', fontWeight: 500 }}>
            Cookie Policy
          </a>.
        </p>
      </section>

      <section className={styles.cleanSection}>
        <h2 className={styles.cleanSectionTitle}>3. How We Use Your Data</h2>
        <p className={styles.hierarchyParagraph} style={{ marginTop: '0.5rem' }}>
          We use your personal information for the following purposes:
        </p>
        <ul className={styles.cleanBulletList}>
          <li className={styles.cleanBulletItem}>
            <span className={styles.cleanBulletDot} />
            <div className={styles.cleanBulletText}>
              <strong>Account and Service Delivery:</strong> To create and manage your account,
              verify your college email, connect you with campus communities and events, and
              provide direct messaging.
            </div>
          </li>
          <li className={styles.cleanBulletItem}>
            <span className={styles.cleanBulletDot} />
            <div className={styles.cleanBulletText}>
              <strong>Transactional Communications:</strong> To send email verification codes,
              password reset links, account security alerts, and support replies. We do not send
              promotional or marketing emails.
            </div>
          </li>
          <li className={styles.cleanBulletItem}>
            <span className={styles.cleanBulletDot} />
            <div className={styles.cleanBulletText}>
              <strong>Safety and Trust:</strong> To detect abuse, investigate reported content,
              enforce our Community Guidelines, and respond to legal requests.
            </div>
          </li>
          <li className={styles.cleanBulletItem}>
            <span className={styles.cleanBulletDot} />
            <div className={styles.cleanBulletText}>
              <strong>Platform Improvement:</strong> To understand how the Platform is used and
              to fix problems and improve features.
            </div>
          </li>
        </ul>
      </section>

      <section className={styles.cleanSection}>
        <h2 className={styles.cleanSectionTitle}>4. Legal Basis for Processing</h2>
        <p className={styles.hierarchyParagraph} style={{ marginTop: '0.5rem' }}>
          Where applicable under data protection law, we rely on the following legal bases:
        </p>
        <ul className={styles.cleanBulletList}>
          <li className={styles.cleanBulletItem}>
            <span className={styles.cleanBulletDot} />
            <div className={styles.cleanBulletText}>
              <strong>Contract:</strong> To create your account and provide the core features of
              the Platform you signed up for.
            </div>
          </li>
          <li className={styles.cleanBulletItem}>
            <span className={styles.cleanBulletDot} />
            <div className={styles.cleanBulletText}>
              <strong>Legitimate Interests:</strong> To maintain security, prevent abuse, improve
              the Platform, and provide customer support.
            </div>
          </li>
          <li className={styles.cleanBulletItem}>
            <span className={styles.cleanBulletDot} />
            <div className={styles.cleanBulletText}>
              <strong>Legal Obligations:</strong> To comply with applicable laws and respond to
              lawful requests from authorities.
            </div>
          </li>
        </ul>
      </section>

      <section className={styles.cleanSection}>
        <h2 className={styles.cleanSectionTitle}>5. Data Sharing</h2>
        <p className={styles.hierarchyParagraph} style={{ marginTop: '0.5rem', fontWeight: 600 }}>
          We do not sell your personal information.
        </p>
        <p className={styles.hierarchyParagraph}>
          We share your data only in the following limited circumstances:
        </p>
        <ul className={styles.cleanBulletList}>
          <li className={styles.cleanBulletItem}>
            <span className={styles.cleanBulletDot} />
            <div className={styles.cleanBulletText}>
              <strong>Other Users:</strong> Information you post in public communities, event
              pages, or on your public profile is visible to other registered users of the
              Platform.
            </div>
          </li>
          <li className={styles.cleanBulletItem}>
            <span className={styles.cleanBulletDot} />
            <div className={styles.cleanBulletText}>
              <strong>Infrastructure Providers:</strong> We use Supabase for authentication and
              database services, Cloudflare R2 for file storage, Resend for transactional
              email delivery, and Vercel for hosting and cookieless analytics. These providers
              process data only on our behalf and under our instructions. No advertising
              providers receive your data, and Vercel receives only anonymous page-view and
              page-performance measurements.
            </div>
          </li>
          <li className={styles.cleanBulletItem}>
            <span className={styles.cleanBulletDot} />
            <div className={styles.cleanBulletText}>
              <strong>Legal and Safety Requirements:</strong> When required by law or to protect
              the safety, rights, or property of users or the public.
            </div>
          </li>
          <li className={styles.cleanBulletItem}>
            <span className={styles.cleanBulletDot} />
            <div className={styles.cleanBulletText}>
              <strong>Business Transfers:</strong> In the event of a merger, acquisition, or
              transfer of Meetifyy's operations, your data may transfer as part of that
              transaction. We will notify you if this occurs.
            </div>
          </li>
        </ul>
      </section>

      <section className={styles.cleanSection}>
        <h2 className={styles.cleanSectionTitle}>6. Your Privacy Rights</h2>
        <p className={styles.hierarchyParagraph} style={{ marginTop: '0.5rem' }}>
          Depending on your jurisdiction, you may have the following rights regarding your
          personal data:
        </p>
        <ul className={styles.cleanBulletList}>
          <li className={styles.cleanBulletItem}>
            <span className={styles.cleanBulletDot} />
            <div className={styles.cleanBulletText}>
              <strong>Access:</strong> You can request a copy of the personal data we hold about
              you.
            </div>
          </li>
          <li className={styles.cleanBulletItem}>
            <span className={styles.cleanBulletDot} />
            <div className={styles.cleanBulletText}>
              <strong>Rectification:</strong> You can correct inaccurate or incomplete
              information through your account settings or by contacting us.
            </div>
          </li>
          <li className={styles.cleanBulletItem}>
            <span className={styles.cleanBulletDot} />
            <div className={styles.cleanBulletText}>
              <strong>Erasure:</strong> You can request the deletion of your account and
              associated personal data by contacting us. We will process deletion requests in
              accordance with our obligations and technical capabilities.
            </div>
          </li>
          <li className={styles.cleanBulletItem}>
            <span className={styles.cleanBulletDot} />
            <div className={styles.cleanBulletText}>
              <strong>Non-Discrimination:</strong> We will not treat you differently for
              exercising your privacy rights.
            </div>
          </li>
        </ul>
        <p className={styles.hierarchyParagraph} style={{ marginTop: '1rem' }}>
          Meetifyy does not currently sell personal information, and does not share personal
          information for cross-context behavioral advertising purposes.
        </p>
        <p className={styles.hierarchyParagraph}>
          To exercise any of these rights, contact us at the address below.
        </p>
      </section>

      <section className={styles.cleanSection}>
        <h2 className={styles.cleanSectionTitle}>7. Data Retention</h2>
        <p className={styles.hierarchyParagraph} style={{ marginTop: '0.5rem' }}>
          We retain your personal data for as long as your account is active and as necessary to
          provide the Platform, comply with legal obligations, resolve disputes, and enforce our
          agreements. Some data may be retained after account closure where required by law or
          for legitimate safety and operational reasons (for example, moderation records and
          reports related to serious violations).
        </p>
        <p className={styles.hierarchyParagraph}>
          If you wish to request deletion of your data, please contact us directly.
        </p>
      </section>

      <section className={styles.cleanSection}>
        <h2 className={styles.cleanSectionTitle}>8. Security</h2>
        <p className={styles.hierarchyParagraph} style={{ marginTop: '0.5rem' }}>
          We take reasonable technical and organizational measures to protect your data.
          Authentication is handled through Supabase, which issues cryptographically signed
          session tokens. Passwords are never stored by Meetifyy; they are managed entirely
          by Supabase Auth. Data is transmitted over HTTPS. File uploads are stored in
          Cloudflare R2, a managed object storage service. Authentication endpoints are
          served without service worker caching to prevent sensitive tokens from being stored
          in browser cache.
        </p>
        <p className={styles.hierarchyParagraph}>
          No system is completely secure. We encourage you to use a strong password and to
          contact us immediately if you suspect unauthorized access to your account.
        </p>
      </section>

      <section className={styles.cleanSection}>
        <h2 className={styles.cleanSectionTitle}>9. Children's Privacy</h2>
        <p className={styles.hierarchyParagraph} style={{ marginTop: '0.5rem' }}>
          Meetifyy requires all users to be at least 18 years old and to verify a college or
          institution email address to sign up. We do not knowingly collect personal data from
          anyone under 18. If we become aware that a user under 18 has registered, we will
          close the account and remove their data.
        </p>
      </section>

      <section className={styles.cleanSection}>
        <h2 className={styles.cleanSectionTitle}>10. Changes to This Policy</h2>
        <p className={styles.hierarchyParagraph} style={{ marginTop: '0.5rem' }}>
          We may update this Privacy Policy from time to time. When we make material changes,
          we will update the date at the top of this page and may notify you through the
          Platform or by email. We encourage you to review this policy periodically.
        </p>
      </section>

      <section className={styles.cleanSection} style={{ borderBottom: 'none' }}>
        <h2 className={styles.cleanSectionTitle}>11. Contact Us</h2>
        <p className={styles.hierarchyParagraph} style={{ marginTop: '0.5rem' }}>
          If you have questions about this Privacy Policy or wish to exercise your data rights,
          please reach out to us at:
        </p>
        <a href="mailto:app.meetifyy@gmail.com" className={styles.emailBtn} style={{ marginTop: '1rem', display: 'inline-flex' }}>
          <Mail size={18} />
          app.meetifyy@gmail.com
        </a>
      </section>
    </StaticDocLayout>
  );
}
