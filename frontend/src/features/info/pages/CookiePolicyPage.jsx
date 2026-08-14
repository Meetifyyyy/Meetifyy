import StaticDocLayout from './StaticDocLayout';
import styles from './StaticDocLayout.module.css';
import { Mail } from 'lucide-react';

export default function CookiePolicyPage() {
  return (
    <StaticDocLayout
      badge="Privacy & Security"
      title="Cookie Policy"
      subtitle="How Meetifyy uses cookies, tracking pixels, and similar technologies to power and protect your experience."
      effectiveDate="17 July 2026"
      noHeroCard
      leftAlign
    >
      <section className={styles.cleanSection}>
        <h2 className={styles.cleanSectionTitle}>Introduction</h2>
        <p className={styles.hierarchyParagraph} style={{ marginTop: '0.5rem' }}>
          This Cookie Policy explains how Meetifyy (“Meetifyy,” “we,” “our,” or “us”) uses cookies and similar technologies when you visit or interact with our website, mobile applications, and related services (collectively, the “Platform”).
        </p>
        <p className={styles.hierarchyParagraph}>
          By continuing to use Meetifyy, you consent to the deployment of cookies and similar technologies as described in this Policy, in conjunction with our overarching Privacy Policy.
        </p>
      </section>

      <section className={styles.cleanSection}>
        <h2 className={styles.cleanSectionTitle}>1. What Are Cookies?</h2>
        <p className={styles.hierarchyParagraph} style={{ marginTop: '0.5rem' }}>
          Cookies are small, secure text files that are placed on your computer, smartphone, or other electronic device by your web browser when you visit a website. They allow the website to recognize your device, remember your preferences, and provide a more personalized, seamless user experience over time.
        </p>
      </section>

      <section className={styles.cleanSection}>
        <h2 className={styles.cleanSectionTitle}>2. How We Use Cookies</h2>
        <p className={styles.hierarchyParagraph} style={{ marginTop: '0.5rem' }}>
          We deploy these technologies for a variety of critical and functional purposes, including to:
        </p>
        <ul className={styles.cleanBulletList}>
          <li className={styles.cleanBulletItem}>
            <span className={styles.cleanBulletDot} />
            <div className={styles.cleanBulletText}>Maintain secure authentication and keep you signed in across sessions.</div>
          </li>
          <li className={styles.cleanBulletItem}>
            <span className={styles.cleanBulletDot} />
            <div className={styles.cleanBulletText}>Remember your custom settings, such as language and theme preferences.</div>
          </li>
          <li className={styles.cleanBulletItem}>
            <span className={styles.cleanBulletDot} />
            <div className={styles.cleanBulletText}>Analyze user engagement to improve website speed, routing, and overall performance.</div>
          </li>
          <li className={styles.cleanBulletItem}>
            <span className={styles.cleanBulletDot} />
            <div className={styles.cleanBulletText}>Understand how you interact with the Platform to enhance navigation and feature discovery.</div>
          </li>
          <li className={styles.cleanBulletItem}>
            <span className={styles.cleanBulletDot} />
            <div className={styles.cleanBulletText}>Bolster security by detecting anomalous, fraudulent activity or unauthorized account access.</div>
          </li>
          <li className={styles.cleanBulletItem}>
            <span className={styles.cleanBulletDot} />
            <div className={styles.cleanBulletText}>Diagnose technical infrastructure issues and platform errors.</div>
          </li>
        </ul>
      </section>

      <section className={styles.cleanSection}>
        <h2 className={styles.cleanSectionTitle}>3. Categories of Cookies We Use</h2>
        
        <h3 className={styles.cleanSectionSubTitle} style={{ marginTop: '1rem' }}>Essential & Strictly Necessary</h3>
        <p className={styles.hierarchyParagraph}>
          Crucial for the core functioning of the Platform. These enable secure login, session management, and basic account access. The Platform cannot function properly without them.
        </p>

        <h3 className={styles.cleanSectionSubTitle} style={{ marginTop: '1.25rem' }}>Performance & Analytics</h3>
        <p className={styles.hierarchyParagraph}>
          Allow us to measure and analyze visitor traffic and behavior. This aggregated data helps us continuously refine and improve the Meetifyy experience.
        </p>

        <h3 className={styles.cleanSectionSubTitle} style={{ marginTop: '1.25rem' }}>Functional</h3>
        <p className={styles.hierarchyParagraph}>
          Remember specific choices you make (such as your campus network, language, or theme) to provide a more tailored and consistent user experience.
        </p>

        <h3 className={styles.cleanSectionSubTitle} style={{ marginTop: '1.25rem' }}>Security & Integrity</h3>
        <p className={styles.hierarchyParagraph}>
          Operate in the background to protect user accounts, maintain authentication state integrity, and prevent malicious bot access.
        </p>
      </section>

      <section className={styles.cleanSection}>
        <h2 className={styles.cleanSectionTitle}>4. Third-Party Cookies</h2>
        <p className={styles.hierarchyParagraph} style={{ marginTop: '0.5rem' }}>
          In some instances, we integrate trusted third-party services—such as analytics providers (e.g., Google Analytics) or secure authentication gateways—that may deploy their own cookies on your device. The collection and processing of data by these third parties are governed strictly by their respective privacy policies.
        </p>
      </section>

      <section className={styles.cleanSection}>
        <h2 className={styles.cleanSectionTitle}>5. Managing & Controlling Cookies</h2>
        <p className={styles.hierarchyParagraph} style={{ marginTop: '0.5rem' }}>
          You retain full control over your cookie preferences. Most modern web browsers allow you to view, manage, block, or delete cookies through their privacy settings. Please note that restricting or disabling certain cookies—particularly Essential and Security cookies—will severely impair or completely disable your ability to use Meetifyy.
        </p>
      </section>

      <section className={styles.cleanSection}>
        <h2 className={styles.cleanSectionTitle}>6. Changes to This Cookie Policy</h2>
        <p className={styles.hierarchyParagraph} style={{ marginTop: '0.5rem' }}>
          We reserve the right to update this Cookie Policy periodically to reflect changes in our technological practices or legal obligations. Updated versions become effective immediately upon publication on the Platform.
        </p>
      </section>

      <section className={styles.cleanSection} style={{ borderBottom: 'none' }}>
        <h2 className={styles.cleanSectionTitle}>7. Contact Us</h2>
        <p className={styles.hierarchyParagraph} style={{ marginTop: '0.5rem' }}>
          For inquiries specific to our use of cookies or other tracking technologies, please contact our privacy team at:
        </p>
        <a href="mailto:meetify0@gmail.com" className={styles.emailBtn} style={{ marginTop: '1rem', display: 'inline-flex' }}>
          <Mail size={18} />
          meetify0@gmail.com
        </a>
      </section>
    </StaticDocLayout>
  );
}
