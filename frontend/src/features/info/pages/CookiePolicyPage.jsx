import StaticDocLayout from './StaticDocLayout';
import styles from './StaticDocLayout.module.css';
import { Cookie, Mail } from 'lucide-react';

export default function CookiePolicyPage() {
  return (
    <StaticDocLayout
      badge="Privacy & Security"
      title="Cookie Policy"
      subtitle="How Meetifyy uses cookies and similar technologies to power and protect your experience."
      effectiveDate="17 July 2026"
    >
      <section className={styles.card}>
        <div className={styles.cardHeader}>
          <div className={styles.iconWrapper}>
            <Cookie size={22} />
          </div>
          <h2 className={styles.cardTitle}>Overview</h2>
        </div>
        <p className={styles.cardText}>
          This Cookie Policy explains how Meetifyy (“Meetifyy,” “we,” “our,” or “us”) uses cookies and similar technologies when you use our website or platform.
        </p>
        <p className={styles.cardText}>
          By continuing to use Meetifyy, you agree to the use of cookies as described in this Policy.
        </p>
      </section>

      <section className={styles.card}>
        <div className={styles.cardHeader}>
          <div className={styles.numBadge}>1</div>
          <h2 className={styles.cardTitle}>What Are Cookies?</h2>
        </div>
        <p className={styles.cardText}>
          Cookies are small text files stored on your device by your web browser. They help websites remember your preferences, improve functionality, and provide a better user experience.
        </p>
      </section>

      <section className={styles.card}>
        <div className={styles.cardHeader}>
          <div className={styles.numBadge}>2</div>
          <h2 className={styles.cardTitle}>How We Use Cookies</h2>
        </div>
        <p className={styles.cardText}>We use cookies to:</p>
        <ul className={styles.bulletList}>
          <li className={styles.bulletItem}><span className={styles.bulletDot} /> Keep you signed in securely across sessions.</li>
          <li className={styles.bulletItem}><span className={styles.bulletDot} /> Remember your preferences and custom settings.</li>
          <li className={styles.bulletItem}><span className={styles.bulletDot} /> Improve website speed and overall performance.</li>
          <li className={styles.bulletItem}><span className={styles.bulletDot} /> Understand how users interact with the Platform to enhance navigation.</li>
          <li className={styles.bulletItem}><span className={styles.bulletDot} /> Enhance security and detect fraudulent activity or unauthorized access.</li>
          <li className={styles.bulletItem}><span className={styles.bulletDot} /> Diagnose technical issues and platform errors.</li>
        </ul>
      </section>

      <section className={styles.card}>
        <div className={styles.cardHeader}>
          <div className={styles.numBadge}>3</div>
          <h2 className={styles.cardTitle}>Types of Cookies We Use</h2>
        </div>
        <div className={styles.gridTwo}>
          <div className={styles.featureBox}>
            <h3 className={styles.featureBoxTitle}>Essential Cookies</h3>
            <p className={styles.featureBoxText}>Required for the Platform to function properly, including login, security, and account access.</p>
          </div>
          <div className={styles.featureBox}>
            <h3 className={styles.featureBoxTitle}>Performance & Analytics Cookies</h3>
            <p className={styles.featureBoxText}>Help us understand how visitors use Meetifyy so we can continuously improve the Platform.</p>
          </div>
          <div className={styles.featureBox}>
            <h3 className={styles.featureBoxTitle}>Functional Cookies</h3>
            <p className={styles.featureBoxText}>Remember settings such as language, theme, and custom user preferences.</p>
          </div>
          <div className={styles.featureBox}>
            <h3 className={styles.featureBoxTitle}>Security Cookies</h3>
            <p className={styles.featureBoxText}>Help protect user accounts, maintain authentication state, and prevent unauthorized access.</p>
          </div>
        </div>
      </section>

      <section className={styles.card}>
        <div className={styles.cardHeader}>
          <div className={styles.numBadge}>4</div>
          <h2 className={styles.cardTitle}>Third-Party Cookies</h2>
        </div>
        <p className={styles.cardText}>
          Some trusted third-party services we use, such as analytics or authentication providers, may place cookies on your device. These cookies are governed by the respective third parties’ privacy policies.
        </p>
      </section>

      <section className={styles.card}>
        <div className={styles.cardHeader}>
          <div className={styles.numBadge}>5</div>
          <h2 className={styles.cardTitle}>Managing Cookies</h2>
        </div>
        <p className={styles.cardText}>
          Most web browsers allow you to manage, block, or delete cookies through browser settings. Disabling certain cookies may affect the functionality of Meetifyy.
        </p>
      </section>

      <section className={styles.card}>
        <div className={styles.cardHeader}>
          <div className={styles.numBadge}>6</div>
          <h2 className={styles.cardTitle}>Changes to This Cookie Policy</h2>
        </div>
        <p className={styles.cardText}>
          We may update this Cookie Policy from time to time. Updated versions become effective when published on the Platform.
        </p>
      </section>

      <div className={styles.contactCard}>
        <h3 className={styles.contactCardTitle}>7. Contact Us</h3>
        <p className={styles.contactCardText}>
          If you have any questions about this Cookie Policy, feel free to reach out:
        </p>
        <a href="mailto:meetify0@gmail.com" className={styles.emailBtn}>
          <Mail size={18} />
          meetify0@gmail.com
        </a>
      </div>
    </StaticDocLayout>
  );
}
