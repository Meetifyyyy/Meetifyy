import StaticDocLayout from './StaticDocLayout';
import styles from './StaticDocLayout.module.css';
import { Mail } from '@shared/components/icons';

export default function PrivacyPolicyPage() {
  return (
    <StaticDocLayout
      badge="Legal & Transparency"
      title="Privacy Policy"
      subtitle="Comprehensive details on how Meetifyy collects, uses, shares, and protects your personal data in compliance with global privacy standards."
      effectiveDate="17 July 2026"
      noHeroCard
      leftAlign
    >
      <section className={styles.cleanSection}>
        <h2 className={styles.cleanSectionTitle}>1. Introduction & Contact Information</h2>
        <p className={styles.hierarchyParagraph} style={{ marginTop: '0.5rem' }}>
          Welcome to Meetifyy (“Meetifyy,” “we,” “our,” or “us”). Your privacy is fundamentally important to us. This Privacy Policy outlines our practices regarding the collection, use, disclosure, and safeguarding of your personal data when you use the Meetifyy platform, including our website, mobile applications, and related services (collectively, the “Platform”).
        </p>
        <p className={styles.hierarchyParagraph}>
          By accessing or using the Platform, you acknowledge that you have read, understood, and agree to the data practices described in this policy. If you have any questions or require the contact details of our Data Protection Officer (DPO), please contact us using the information provided at the end of this document.
        </p>
      </section>

      <section className={styles.cleanSection}>
        <h2 className={styles.cleanSectionTitle}>2. Types of Personal Data Collected</h2>
        <p className={styles.hierarchyParagraph} style={{ marginTop: '0.5rem' }}>
          We collect personal information through the following methods and categories:
        </p>

        <h3 className={styles.cleanSectionSubTitle} style={{ marginTop: '1rem' }}>Data You Provide Directly:</h3>
        <ul className={styles.cleanBulletList}>
          <li className={styles.cleanBulletItem}>
            <span className={styles.cleanBulletDot} />
            <div className={styles.cleanBulletText}>
              <strong>Account Credentials:</strong> Full name, email address, username, and password.
            </div>
          </li>
          <li className={styles.cleanBulletItem}>
            <span className={styles.cleanBulletDot} />
            <div className={styles.cleanBulletText}>
              <strong>Profile Data:</strong> College or university affiliation, profile photos, bio, and academic interests.
            </div>
          </li>
          <li className={styles.cleanBulletItem}>
            <span className={styles.cleanBulletDot} />
            <div className={styles.cleanBulletText}>
              <strong>User-Generated Content:</strong> Communities joined, events created or RSVP'd to, comments, posts, and media uploads.
            </div>
          </li>
          <li className={styles.cleanBulletItem}>
            <span className={styles.cleanBulletDot} />
            <div className={styles.cleanBulletText}>
              <strong>Communications:</strong> Direct messages sent through the Platform and communications with our support team.
            </div>
          </li>
        </ul>

        <h3 className={styles.cleanSectionSubTitle} style={{ marginTop: '1.25rem' }}>Data Collected Automatically:</h3>
        <ul className={styles.cleanBulletList}>
          <li className={styles.cleanBulletItem}>
            <span className={styles.cleanBulletDot} />
            <div className={styles.cleanBulletText}>
              <strong>Device Information:</strong> Hardware model, operating system, unique device identifiers, and network information.
            </div>
          </li>
          <li className={styles.cleanBulletItem}>
            <span className={styles.cleanBulletDot} />
            <div className={styles.cleanBulletText}>
              <strong>Log Data:</strong> IP addresses, browser types, access times, pages viewed, and navigation patterns.
            </div>
          </li>
          <li className={styles.cleanBulletItem}>
            <span className={styles.cleanBulletDot} />
            <div className={styles.cleanBulletText}>
              <strong>Location Information:</strong> General location derived from IP addresses to provide relevant campus community suggestions.
            </div>
          </li>
        </ul>

        <h3 className={styles.cleanSectionSubTitle} style={{ marginTop: '1.25rem' }}>Cookies and Tracking Technologies:</h3>
        <p className={styles.hierarchyParagraph}>
          We deploy cookies, web beacons, and similar tracking technologies to maintain session states, store user preferences, analyze platform usage, and enhance security. For detailed information, please review our Cookie Policy.
        </p>
      </section>

      <section className={styles.cleanSection}>
        <h2 className={styles.cleanSectionTitle}>3. Purpose & Legal Basis of Processing</h2>
        <p className={styles.hierarchyParagraph} style={{ marginTop: '0.5rem' }}>
          Under the GDPR and other applicable laws, we process your data based on the following legal grounds:
        </p>
        <ul className={styles.cleanBulletList}>
          <li className={styles.cleanBulletItem}>
            <span className={styles.cleanBulletDot} />
            <div className={styles.cleanBulletText}>
              <strong>Contractual Necessity:</strong> To create and manage your account, connect you with student communities, and provide core messaging and event features.
            </div>
          </li>
          <li className={styles.cleanBulletItem}>
            <span className={styles.cleanBulletDot} />
            <div className={styles.cleanBulletText}>
              <strong>Legitimate Interests:</strong> To improve and personalize the Platform, maintain security, detect fraud, and provide customer support.
            </div>
          </li>
          <li className={styles.cleanBulletItem}>
            <span className={styles.cleanBulletDot} />
            <div className={styles.cleanBulletText}>
              <strong>Consent:</strong> When you opt-in to specific features, such as promotional communications or location-based services.
            </div>
          </li>
          <li className={styles.cleanBulletItem}>
            <span className={styles.cleanBulletDot} />
            <div className={styles.cleanBulletText}>
              <strong>Legal Obligations:</strong> To comply with applicable laws, regulations, and authorized legal requests.
            </div>
          </li>
        </ul>
      </section>

      <section className={styles.cleanSection}>
        <h2 className={styles.cleanSectionTitle}>4. Data Sharing & Third-Party Disclosures</h2>
        <p className={styles.hierarchyParagraph} style={{ marginTop: '0.5rem', fontWeight: 600, color: '#1c1917' }}>
          We do not sell your personal information to third parties.
        </p>
        <p className={styles.hierarchyParagraph}>We may disclose your data in the following restricted circumstances:</p>
        <ul className={styles.cleanBulletList}>
          <li className={styles.cleanBulletItem}>
            <span className={styles.cleanBulletDot} />
            <div className={styles.cleanBulletText}>
              <strong>Service Providers:</strong> Trusted third-party vendors (e.g., cloud hosting, analytics, security) who assist in operating our Platform under strict data processing agreements.
            </div>
          </li>
          <li className={styles.cleanBulletItem}>
            <span className={styles.cleanBulletDot} />
            <div className={styles.cleanBulletText}>
              <strong>Other Users:</strong> Information shared in public communities, event pages, or public profiles is visible to other registered users.
            </div>
          </li>
          <li className={styles.cleanBulletItem}>
            <span className={styles.cleanBulletDot} />
            <div className={styles.cleanBulletText}>
              <strong>Legal and Safety Requirements:</strong> When legally required, or to protect the rights, property, and safety of Meetifyy, our users, or the public.
            </div>
          </li>
          <li className={styles.cleanBulletItem}>
            <span className={styles.cleanBulletDot} />
            <div className={styles.cleanBulletText}>
              <strong>Business Transfers:</strong> In the event of a merger, acquisition, or sale of assets, user data may be transferred as a business asset.
            </div>
          </li>
        </ul>
      </section>

      <section className={styles.cleanSection}>
        <h2 className={styles.cleanSectionTitle}>5. User Rights (GDPR & CCPA/CPRA)</h2>
        <p className={styles.hierarchyParagraph} style={{ marginTop: '0.5rem' }}>
          Depending on your jurisdiction, you hold specific rights regarding your personal data:
        </p>
        <ul className={styles.cleanBulletList}>
          <li className={styles.cleanBulletItem}>
            <span className={styles.cleanBulletDot} />
            <div className={styles.cleanBulletText}>
              <strong>Right to Access & Know:</strong> You can request a copy of the personal data we hold about you and details on how it is processed.
            </div>
          </li>
          <li className={styles.cleanBulletItem}>
            <span className={styles.cleanBulletDot} />
            <div className={styles.cleanBulletText}>
              <strong>Right to Rectification:</strong> You can correct inaccurate or incomplete personal information directly through account settings or support.
            </div>
          </li>
          <li className={styles.cleanBulletItem}>
            <span className={styles.cleanBulletDot} />
            <div className={styles.cleanBulletText}>
              <strong>Right to Erasure (Right to be Forgotten):</strong> You may request the deletion of your account and associated personal data.
            </div>
          </li>
          <li className={styles.cleanBulletItem}>
            <span className={styles.cleanBulletDot} />
            <div className={styles.cleanBulletText}>
              <strong>Right to Opt-Out:</strong> Maintain the right to opt-out of sharing personal information for cross-context behavioral advertising.
            </div>
          </li>
          <li className={styles.cleanBulletItem}>
            <span className={styles.cleanBulletDot} />
            <div className={styles.cleanBulletText}>
              <strong>Right to Non-Discrimination:</strong> We will not discriminate against you for exercising your privacy rights.
            </div>
          </li>
        </ul>
      </section>

      <section className={styles.cleanSection}>
        <h2 className={styles.cleanSectionTitle}>6. Data Retention & Security</h2>
        <h3 className={styles.cleanSectionSubTitle} style={{ marginTop: '1rem' }}>Data Retention:</h3>
        <p className={styles.hierarchyParagraph}>
          We retain your personal data only for as long as necessary to fulfill the purposes outlined in this policy, maintain your active account, comply with legal obligations, and resolve disputes. Account deletion permanently removes or anonymizes data within 30 days.
        </p>
        <h3 className={styles.cleanSectionSubTitle} style={{ marginTop: '1.25rem' }}>Security Measures:</h3>
        <p className={styles.hierarchyParagraph}>
          We implement industry-standard technical and organizational measures (encryption, secure socket layer technology, security audits) to protect your data against unauthorized access, alteration, or destruction.
        </p>
      </section>

      <section className={styles.cleanSection}>
        <h2 className={styles.cleanSectionTitle}>7. Children’s Privacy</h2>
        <p className={styles.hierarchyParagraph} style={{ marginTop: '0.5rem' }}>
          Meetifyy is strictly intended for university and college students. We do not knowingly collect personal data from individuals under 13 years of age. If we become aware that such data was inadvertently collected, we will take immediate steps to delete it.
        </p>
      </section>

      <section className={styles.cleanSection}>
        <h2 className={styles.cleanSectionTitle}>8. Updates & Policy Changes</h2>
        <p className={styles.hierarchyParagraph} style={{ marginTop: '0.5rem' }}>
          We may revise this Privacy Policy periodically. We will notify you of material changes via in-app notifications or email. Your continued use of the Platform constitutes acceptance of the updated terms.
        </p>
      </section>

      <section className={styles.cleanSection} style={{ borderBottom: 'none' }}>
        <h2 className={styles.cleanSectionTitle}>9. Contact Us</h2>
        <p className={styles.hierarchyParagraph} style={{ marginTop: '0.5rem' }}>
          For inquiries regarding this Privacy Policy, to exercise your data rights, or to contact our Data Protection Officer, please reach out to us at:
        </p>
        <a href="mailto:meetify0@gmail.com" className={styles.emailBtn} style={{ marginTop: '1rem', display: 'inline-flex' }}>
          <Mail size={18} />
          meetify0@gmail.com
        </a>
      </section>
    </StaticDocLayout>
  );
}
