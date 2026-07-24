import StaticDocLayout from './StaticDocLayout';
import styles from './StaticDocLayout.module.css';
import { Scale, Mail } from 'lucide-react';

export default function TermsPage() {
  const sections = [
    {
      num: 1,
      title: 'About Meetifyy',
      content: 'Meetifyy is a platform designed to help students discover communities, connect with like-minded people, participate in events, find project teammates, and build meaningful campus and professional connections. While our primary audience is college students, certain events, communities, or services may also be accessible to a broader audience.'
    },
    {
      num: 2,
      title: 'Eligibility',
      list: [
        'Be at least 13 years of age or the minimum legal age required under applicable law.',
        'Have the legal capacity to enter into these Terms.',
        'Provide accurate and complete registration information.',
        'Keep your account information up to date.'
      ]
    },
    {
      num: 3,
      title: 'User Accounts',
      content: 'You are responsible for maintaining your login credentials, all activity on your account, providing truthful information, and notifying Meetifyy of unauthorized access.'
    },
    {
      num: 4,
      title: 'Acceptable Use',
      content: 'Do not harass users, post illegal or abusive content, impersonate others, spam, distribute malware, or misuse the Platform.'
    },
    {
      num: 5,
      title: 'Communities and Events',
      content: 'Users may create communities and events. Organizers are responsible for their content and compliance with applicable laws. Meetifyy may remove violating content.'
    },
    {
      num: 6,
      title: 'Direct Messaging',
      content: 'Do not send abusive, illegal, fraudulent, or spam messages. Reported conversations may be reviewed where permitted by law.'
    },
    {
      num: 7,
      title: 'User Content',
      content: 'You retain ownership of your content. By posting, you grant Meetifyy a worldwide, non-exclusive, royalty-free license to host, display, reproduce, distribute, and use your content to operate, improve, and promote the Platform.'
    },
    {
      num: 8,
      title: 'Intellectual Property',
      content: 'All Meetifyy branding, software, designs, logos, graphics, and trademarks belong to Meetifyy or its licensors.'
    },
    {
      num: 9,
      title: 'Privacy',
      content: 'Your use of Meetifyy is governed by our Privacy Policy.'
    },
    {
      num: 10,
      title: 'Safety',
      content: 'Meetifyy does not conduct background checks. Users are responsible for exercising caution when interacting online or offline.'
    },
    {
      num: 11,
      title: 'Suspension and Termination',
      content: 'Meetifyy may suspend or terminate accounts that violate these Terms. Users may request account deletion at any time.'
    },
    {
      num: 12,
      title: 'Disclaimer',
      content: 'The Platform is provided “as is” and “as available” without guarantees regarding availability, accuracy, or user conduct.'
    },
    {
      num: 13,
      title: 'Limitation of Liability',
      content: 'Meetifyy is not liable for user-generated content, user interactions, disputes, or indirect or consequential damages to the maximum extent permitted by law.'
    },
    {
      num: 14,
      title: 'Changes',
      content: 'Meetifyy may update these Terms at any time. Continued use of the Platform constitutes acceptance of the revised Terms.'
    },
    {
      num: 15,
      title: 'Governing Law',
      content: 'These Terms are governed by the laws of India. Disputes shall be subject to the exclusive jurisdiction of competent courts in India.'
    }
  ];

  return (
    <StaticDocLayout
      badge="Terms of Service"
      title="Terms & Conditions"
      subtitle="The rules, terms, and agreements governing your use of Meetifyy."
      effectiveDate="17 July 2026"
    >
      <section className={styles.card}>
        <div className={styles.cardHeader}>
          <div className={styles.iconWrapper}>
            <Scale size={22} />
          </div>
          <h2 className={styles.cardTitle}>Agreement Overview</h2>
        </div>
        <p className={styles.cardText}>
          Welcome to Meetifyy! These Terms & Conditions (“Terms”) govern your access to and use of the Meetifyy platform, including our website, mobile application, and related services (collectively, the “Platform”). By creating an account or using Meetifyy, you agree to be bound by these Terms.
        </p>
        <p className={styles.cardText} style={{ fontWeight: 600, color: '#dc2626' }}>
          If you do not agree with these Terms, please do not use the Platform.
        </p>
      </section>

      {sections.map((s) => (
        <section key={s.num} className={styles.card}>
          <div className={styles.cardHeader}>
            <div className={styles.numBadge}>{s.num}</div>
            <h2 className={styles.cardTitle}>{s.title}</h2>
          </div>
          {s.content && <p className={styles.cardText}>{s.content}</p>}
          {s.list && (
            <ul className={styles.bulletList}>
              {s.list.map((item, idx) => (
                <li key={idx} className={styles.bulletItem}>
                  <span className={styles.bulletDot} />
                  {item}
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}

      <div className={styles.contactCard}>
        <h3 className={styles.contactCardTitle}>16. Contact Us</h3>
        <p className={styles.contactCardText}>
          If you have any questions regarding these Terms & Conditions, please contact us:
        </p>
        <a href="mailto:meetify0@gmail.com" className={styles.emailBtn}>
          <Mail size={18} />
          meetify0@gmail.com
        </a>
        <p className={styles.contactCardText} style={{ marginTop: '0.5rem', fontSize: '0.875rem' }}>
          By creating an account or using Meetifyy, you acknowledge that you have read, understood, and agreed to these Terms & Conditions.
        </p>
      </div>
    </StaticDocLayout>
  );
}
