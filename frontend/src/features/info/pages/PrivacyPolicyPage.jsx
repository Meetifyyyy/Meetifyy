import StaticDocLayout from './StaticDocLayout';
import styles from './StaticDocLayout.module.css';
import { Lock, Mail } from 'lucide-react';

export default function PrivacyPolicyPage() {
  return (
    <StaticDocLayout
      badge="Legal & Transparency"
      title="Privacy Policy"
      subtitle="How Meetifyy collects, uses, stores, and protects your information."
      effectiveDate="17 July 2026"
    >
      <section className={styles.card}>
        <div className={styles.cardHeader}>
          <div className={styles.iconWrapper}>
            <Lock size={22} />
          </div>
          <h2 className={styles.cardTitle}>Introduction</h2>
        </div>
        <p className={styles.cardText}>
          Welcome to Meetifyy (“Meetifyy,” “we,” “our,” or “us”). Your privacy is important to us. This Privacy Policy explains how we collect, use, store, share, and protect your information when you use the Meetifyy platform, including our website, mobile application, and related services (collectively, the “Platform”).
        </p>
        <p className={styles.cardText}>
          By using Meetifyy, you agree to the collection and use of your information in accordance with this Privacy Policy.
        </p>
      </section>

      <section className={styles.card}>
        <div className={styles.cardHeader}>
          <div className={styles.numBadge}>1</div>
          <h2 className={styles.cardTitle}>Information We Collect</h2>
        </div>
        
        <h3 style={{ fontSize: '1.05rem', fontWeight: 700, color: '#1c1917', margin: '1rem 0 0.5rem 0' }}>Information You Provide:</h3>
        <ul className={styles.bulletList}>
          <li className={styles.bulletItem}><span className={styles.bulletDot} /> Full name, email address, and username</li>
          <li className={styles.bulletItem}><span className={styles.bulletDot} /> College or university name</li>
          <li className={styles.bulletItem}><span className={styles.bulletDot} /> Profile photo, bio, and profile details</li>
          <li className={styles.bulletItem}><span className={styles.bulletDot} /> Communities you join & events you create or attend</li>
          <li className={styles.bulletItem}><span className={styles.bulletDot} /> Messages you send through the Platform</li>
          <li className={styles.bulletItem}><span className={styles.bulletDot} /> Posts, comments, images, and other content you upload</li>
          <li className={styles.bulletItem}><span className={styles.bulletDot} /> Any information you voluntarily provide</li>
        </ul>

        <h3 style={{ fontSize: '1.05rem', fontWeight: 700, color: '#1c1917', margin: '1.5rem 0 0.5rem 0' }}>Information Collected Automatically:</h3>
        <ul className={styles.bulletList}>
          <li className={styles.bulletItem}><span className={styles.bulletDot} /> Device information, browser type, and operating system</li>
          <li className={styles.bulletItem}><span className={styles.bulletDot} /> IP address, app version, and device identifiers</li>
          <li className={styles.bulletItem}><span className={styles.bulletDot} /> Usage activity, log data, date & time of access</li>
          <li className={styles.bulletItem}><span className={styles.bulletDot} /> Crash reports and diagnostics</li>
        </ul>

        <h3 style={{ fontSize: '1.05rem', fontWeight: 700, color: '#1c1917', margin: '1.5rem 0 0.5rem 0' }}>Cookies:</h3>
        <p className={styles.cardText}>
          We may use cookies and similar technologies to keep you signed in, remember preferences, improve user experience, analyze performance, and enhance security.
        </p>
      </section>

      <section className={styles.card}>
        <div className={styles.cardHeader}>
          <div className={styles.numBadge}>2</div>
          <h2 className={styles.cardTitle}>How We Use Your Information</h2>
        </div>
        <p className={styles.cardText}>We use your information to:</p>
        <ul className={styles.bulletList}>
          <li className={styles.bulletItem}><span className={styles.bulletDot} /> Create and manage your account</li>
          <li className={styles.bulletItem}><span className={styles.bulletDot} /> Connect you with other users and student communities</li>
          <li className={styles.bulletItem}><span className={styles.bulletDot} /> Enable direct messaging and group discussions</li>
          <li className={styles.bulletItem}><span className={styles.bulletDot} /> Display your student profile</li>
          <li className={styles.bulletItem}><span className={styles.bulletDot} /> Recommend relevant communities and campus events</li>
          <li className={styles.bulletItem}><span className={styles.bulletDot} /> Improve and personalize the Platform experience</li>
          <li className={styles.bulletItem}><span className={styles.bulletDot} /> Prevent fraud, abuse, and security threats</li>
          <li className={styles.bulletItem}><span className={styles.bulletDot} /> Maintain platform security and system reliability</li>
          <li className={styles.bulletItem}><span className={styles.bulletDot} /> Respond to customer support requests</li>
          <li className={styles.bulletItem}><span className={styles.bulletDot} /> Comply with legal obligations</li>
        </ul>
      </section>

      <section className={styles.card}>
        <div className={styles.cardHeader}>
          <div className={styles.numBadge}>3</div>
          <h2 className={styles.cardTitle}>Direct Messages</h2>
        </div>
        <p className={styles.cardText}>
          Messages are processed to provide the messaging service. We may review messages only when necessary to investigate abuse, spam, illegal activity, comply with legal obligations, or protect users and the Platform. We do not routinely monitor private conversations.
        </p>
      </section>

      <section className={styles.card}>
        <div className={styles.cardHeader}>
          <div className={styles.numBadge}>4</div>
          <h2 className={styles.cardTitle}>Communities and Events</h2>
        </div>
        <p className={styles.cardText}>
          Information shared in public communities or public event pages may be visible to other users. Avoid posting sensitive personal information publicly.
        </p>
      </section>

      <section className={styles.card}>
        <div className={styles.cardHeader}>
          <div className={styles.numBadge}>5</div>
          <h2 className={styles.cardTitle}>Sharing Your Information</h2>
        </div>
        <p className={styles.cardText} style={{ fontWeight: 600, color: '#1c1917' }}>
          We do not sell your personal information.
        </p>
        <p className={styles.cardText}>We may share information:</p>
        <ul className={styles.bulletList}>
          <li className={styles.bulletItem}><span className={styles.bulletDot} /> With trusted service providers helping operate the Platform</li>
          <li className={styles.bulletItem}><span className={styles.bulletDot} /> When required by law or legal proceedings</li>
          <li className={styles.bulletItem}><span className={styles.bulletDot} /> To investigate fraud, abuse, or security issues</li>
          <li className={styles.bulletItem}><span className={styles.bulletDot} /> To protect our rights, users, or safety</li>
          <li className={styles.bulletItem}><span className={styles.bulletDot} /> During a merger, acquisition, or business transfer</li>
        </ul>
      </section>

      <section className={styles.card}>
        <div className={styles.cardHeader}>
          <div className={styles.numBadge}>6</div>
          <h2 className={styles.cardTitle}>Data Security</h2>
        </div>
        <p className={styles.cardText}>
          We use reasonable technical and organizational measures to protect your information. However, no system is completely secure, and absolute security cannot be guaranteed.
        </p>
      </section>

      <section className={styles.card}>
        <div className={styles.cardHeader}>
          <div className={styles.numBadge}>7</div>
          <h2 className={styles.cardTitle}>Data Retention</h2>
        </div>
        <p className={styles.cardText}>
          We retain information only as long as necessary to provide services, comply with legal obligations, resolve disputes, and enforce our policies.
        </p>
      </section>

      <section className={styles.card}>
        <div className={styles.cardHeader}>
          <div className={styles.numBadge}>8</div>
          <h2 className={styles.cardTitle}>Your Rights</h2>
        </div>
        <p className={styles.cardText}>You may have the right to:</p>
        <ul className={styles.bulletList}>
          <li className={styles.bulletItem}><span className={styles.bulletDot} /> Access your personal information</li>
          <li className={styles.bulletItem}><span className={styles.bulletDot} /> Correct or update your profile information</li>
          <li className={styles.bulletItem}><span className={styles.bulletDot} /> Request deletion of your account and associated data</li>
          <li className={styles.bulletItem}><span className={styles.bulletDot} /> Withdraw consent where applicable</li>
          <li className={styles.bulletItem}><span className={styles.bulletDot} /> Contact us regarding privacy concerns</li>
        </ul>
      </section>

      <section className={styles.card}>
        <div className={styles.cardHeader}>
          <div className={styles.numBadge}>9</div>
          <h2 className={styles.cardTitle}>Children’s Privacy</h2>
        </div>
        <p className={styles.cardText}>
          Meetifyy is not intended for children under 13 years of age. If we learn that we have collected personal information from a child under 13, we will take reasonable steps to delete it.
        </p>
      </section>

      <section className={styles.card}>
        <div className={styles.cardHeader}>
          <div className={styles.numBadge}>10</div>
          <h2 className={styles.cardTitle}>Third-Party Services</h2>
        </div>
        <p className={styles.cardText}>
          Meetifyy may contain links to third-party websites or services. We are not responsible for their privacy practices.
        </p>
      </section>

      <section className={styles.card}>
        <div className={styles.cardHeader}>
          <div className={styles.numBadge}>11</div>
          <h2 className={styles.cardTitle}>Changes to This Privacy Policy</h2>
        </div>
        <p className={styles.cardText}>
          We may update this Privacy Policy from time to time. Continued use of the Platform after updates constitutes acceptance of the revised policy.
        </p>
      </section>

      <div className={styles.contactCard}>
        <h3 className={styles.contactCardTitle}>12. Contact Us</h3>
        <p className={styles.contactCardText}>
          For any privacy questions or requests regarding your data, reach out to us at:
        </p>
        <a href="mailto:meetify0@gmail.com" className={styles.emailBtn}>
          <Mail size={18} />
          meetify0@gmail.com
        </a>
      </div>
    </StaticDocLayout>
  );
}
