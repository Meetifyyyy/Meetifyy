import StaticDocLayout from './StaticDocLayout';
import styles from './StaticDocLayout.module.css';
import { ShieldCheck, Mail } from 'lucide-react';

export default function CommunityGuidelinesPage() {
  const guidelines = [
    {
      num: 1,
      title: 'Be Respectful',
      desc: 'Treat everyone with kindness and respect. Healthy discussions are encouraged, but personal attacks, insults, intimidation, or harassment are not acceptable.'
    },
    {
      num: 2,
      title: 'No Bullying or Harassment',
      desc: 'Do not bully, threaten, stalk, repeatedly contact someone after they ask you to stop, or encourage others to harass anyone.'
    },
    {
      num: 3,
      title: 'No Hate Speech or Discrimination',
      desc: 'Do not promote or encourage hatred or discrimination based on race, ethnicity, nationality, religion, gender, disability, sexual orientation, or any other protected characteristic.'
    },
    {
      num: 4,
      title: 'Keep Content Appropriate',
      desc: 'Do not post sexually explicit material, graphic violence, illegal content, content promoting self-harm or violence, or offensive and obscene material.'
    },
    {
      num: 5,
      title: 'Be Authentic',
      desc: 'Do not impersonate another person or organization, create fake identities, or misrepresent your college or affiliations.'
    },
    {
      num: 6,
      title: 'Respect Privacy',
      desc: 'Do not share another person’s personal information without permission, including phone numbers, email addresses, home addresses, identification documents, financial information, or private conversations.'
    },
    {
      num: 7,
      title: 'No Spam or Scams',
      desc: 'Do not send spam, phishing links, fraudulent offers, excessive promotions, or manipulate engagement using fake accounts.'
    },
    {
      num: 8,
      title: 'Communities and Events',
      desc: 'Community creators and event organizers should provide accurate information, clearly explain their purpose, moderate responsibly, and comply with applicable laws. Meetifyy may remove communities or events that violate these Guidelines.'
    },
    {
      num: 9,
      title: 'Direct Messaging',
      desc: 'Use direct messaging respectfully. Do not harass, threaten, send explicit content, spam, or share harmful or illegal material. Respect users who ask you to stop contacting them.'
    },
    {
      num: 10,
      title: 'Intellectual Property',
      desc: 'Only share content that you own or have permission to use.'
    },
    {
      num: 11,
      title: 'Report Problems',
      desc: 'Report content or behavior that violates these Guidelines using the reporting features or by contacting Meetifyy.'
    },
    {
      num: 12,
      title: 'Enforcement',
      desc: 'Meetifyy may remove content, remove communities or events, restrict features, issue warnings, temporarily suspend accounts, permanently ban accounts, or report illegal activities where required by law.'
    },
    {
      num: 13,
      title: 'Changes',
      desc: 'Meetifyy may update these Community Guidelines at any time. Continued use of the Platform constitutes acceptance of the updated Guidelines.'
    }
  ];

  return (
    <StaticDocLayout
      badge="Safety & Culture"
      title="Community Guidelines"
      subtitle="Our standards to ensure a safe, respectful, and welcoming environment for every student on Meetifyy."
      effectiveDate="17 July 2026"
    >
      <section className={styles.card}>
        <div className={styles.cardHeader}>
          <div className={styles.iconWrapper}>
            <ShieldCheck size={22} />
          </div>
          <h2 className={styles.cardTitle}>Our Shared Commitment</h2>
        </div>
        <p className={styles.cardText}>
          Welcome to Meetifyy! Our goal is to help students and communities connect, collaborate, and build meaningful relationships. These Community Guidelines explain the standards expected from everyone using the Platform.
        </p>
        <p className={styles.cardText}>
          By using Meetifyy, you agree to follow these guidelines and help create a safe, respectful, and welcoming environment for all users.
        </p>
      </section>

      {guidelines.map((g) => (
        <section key={g.num} className={styles.card}>
          <div className={styles.cardHeader}>
            <div className={styles.numBadge}>{g.num}</div>
            <h2 className={styles.cardTitle}>{g.title}</h2>
          </div>
          <p className={styles.cardText}>{g.desc}</p>
        </section>
      ))}

      <div className={styles.contactCard}>
        <h3 className={styles.contactCardTitle}>14. Contact Us</h3>
        <p className={styles.contactCardText}>
          If you have questions about these Community Guidelines or wish to report a violation, please get in touch with us:
        </p>
        <a href="mailto:meetify0@gmail.com" className={styles.emailBtn}>
          <Mail size={18} />
          meetify0@gmail.com
        </a>
        <p className={styles.contactCardText} style={{ marginTop: '0.5rem', fontSize: '0.875rem' }}>
          Thank you for helping make Meetifyy a safe, respectful, and inclusive place where everyone can Find Your People.
        </p>
      </div>
    </StaticDocLayout>
  );
}
