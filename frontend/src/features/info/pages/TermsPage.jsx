import StaticDocLayout from './StaticDocLayout';
import styles from './StaticDocLayout.module.css';
import { Mail } from '@shared/components/icons';

export default function TermsPage() {
  const sections = [
    {
      num: 1,
      title: 'About Meetifyy',
      content:
        'Meetifyy is a student platform designed to help college students discover communities, connect with peers who share their interests, attend campus events, find project collaborators, and build meaningful relationships. Signing up requires a valid college or institution email address.'
    },
    {
      num: 2,
      title: 'Eligibility',
      list: [
        'Age: You must be at least 18 years old to create an account.',
        'Institution Email: You must provide a valid college or institution email address to register.',
        'Legal Capacity: You must have the legal capacity to enter into a binding agreement.',
        'Accurate Information: You must provide truthful information at signup and keep it up to date.',
        'Account Responsibility: You are responsible for keeping your login credentials secure and for all activity that takes place under your account. Notify us immediately at app.meetifyy@gmail.com if you suspect unauthorized access.'
      ]
    },
    {
      num: 3,
      title: 'Acceptable Use',
      content: 'You agree not to use the Platform to:',
      list: [
        'Harass, bully, defame, or threaten any person.',
        'Post or share illegal, abusive, fraudulent, or obscene content.',
        'Impersonate another person, organization, or misrepresent your institutional affiliation.',
        'Distribute spam, phishing links, or malicious software.',
        'Scrape, mine, or extract data from the Platform without authorization.',
        'Attempt to gain unauthorized access to any account, system, or network.'
      ]
    },
    {
      num: 4,
      title: 'Communities and Events',
      content:
        'Users may create and join communities and events on the Platform. Community creators and event organizers are responsible for the accuracy of their content, the conduct of their community, and compliance with these Terms and our Community Guidelines. Meetifyy may remove communities, events, or content that violate these Terms at any time.'
    },
    {
      num: 5,
      title: 'Content Ownership and License',
      content:
        'You retain ownership of the original content you post on Meetifyy. By posting content, you grant Meetifyy a non-exclusive, worldwide, royalty-free license to host, store, display, reproduce, and distribute that content solely as needed to operate and deliver the Platform to other users. This license does not grant Meetifyy the right to use your content in advertising or marketing. You confirm that you have the rights to grant this license and that your content does not infringe the rights of others.'
    },
    {
      num: 6,
      title: 'Meetifyy Intellectual Property',
      content:
        'All Platform branding, software, visual design, logos, graphics, and trademarks are owned by Meetifyy or its licensors. Nothing in these Terms transfers ownership of any Meetifyy intellectual property to you. You may not copy, reproduce, modify, or distribute our materials without our prior written consent.'
    },
    {
      num: 7,
      title: 'Disclaimer of Warranties',
      content:
        'The Platform is provided on an "as is" and "as available" basis. To the fullest extent permitted by law, Meetifyy makes no warranties, express or implied, including warranties of merchantability, fitness for a particular purpose, or non-infringement. We do not guarantee that the Platform will always be available, uninterrupted, or free of errors.'
    },
    {
      num: 8,
      title: 'Limitation of Liability',
      content:
        'To the maximum extent permitted by applicable law, Meetifyy and its founders shall not be liable for any indirect, incidental, special, consequential, or punitive damages, including loss of data or loss of opportunity, arising from your use of the Platform or from interactions with other users.'
    },
    {
      num: 9,
      title: 'Indemnification',
      content:
        'You agree to indemnify and hold harmless Meetifyy and its founders from any claims, liabilities, damages, or costs (including reasonable legal fees) arising from your violation of these Terms, your content, or your misuse of the Platform.'
    },
    {
      num: 10,
      title: 'Suspension and Termination',
      content:
        'Meetifyy may suspend or terminate your access to the Platform if you violate these Terms or our Community Guidelines. You may request account closure at any time by contacting us. Account closure requests are processed manually; please contact us at app.meetifyy@gmail.com.'
    },
    {
      num: 11,
      title: 'Governing Law',
      content:
        'These Terms are governed by the laws of India. Any disputes arising under or in connection with these Terms shall be subject to the exclusive jurisdiction of courts of competent jurisdiction in India. Meetifyy has not yet incorporated as a formal legal entity; this clause will be updated with a specific seat of jurisdiction when incorporation is complete.'
    },
    {
      num: 12,
      title: 'Changes to These Terms',
      content:
        'We may update these Terms from time to time. When we make material changes, we will notify you through the Platform or by email and update the date at the top of this page. For significant changes, we may ask you to re-acknowledge the updated Terms before continuing. Continued use of the Platform after notification of changes means you accept the revised Terms.'
    }
  ];

  return (
    <StaticDocLayout
      badge="Terms of Service"
      title="Terms of Service"
      subtitle="The rules and agreements that govern your use of Meetifyy."
      effectiveDate="27 August 2026"
      noHeroCard
      leftAlign
    >
      <section className={styles.cleanSection}>
        <h2 className={styles.cleanSectionTitle}>Introduction</h2>
        <p className={styles.hierarchyParagraph} style={{ marginTop: '0.5rem' }}>
          Welcome to Meetifyy. These Terms of Service ("Terms") form a legally binding agreement
          between you and Meetifyy ("Meetifyy," "we," "our," or "us") and govern your access to and
          use of our platform, including our website, web application, and related services
          (collectively, the "Platform").
        </p>
        <p className={styles.hierarchyParagraph}>
          By creating an account or using the Platform, you confirm that you have read, understood,
          and agree to be bound by these Terms and our associated policies, including the Privacy
          Policy and Community Guidelines.
        </p>
        <p className={styles.hierarchyParagraph} style={{ fontWeight: 600, color: '#dc2626' }}>
          If you do not agree to these Terms, do not use the Platform.
        </p>
      </section>

      {sections.map((s) => (
        <section key={s.num} className={styles.cleanSection}>
          <h2 className={styles.cleanSectionTitle}>{s.num}. {s.title}</h2>
          {s.content && <p className={styles.hierarchyParagraph} style={{ marginTop: '0.5rem' }}>{s.content}</p>}
          {s.list && (
            <ul className={styles.cleanBulletList}>
              {s.list.map((item, idx) => (
                <li key={idx} className={styles.cleanBulletItem}>
                  <span className={styles.cleanBulletDot} />
                  <div className={styles.cleanBulletText}>{item}</div>
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}

      <section className={styles.cleanSection} style={{ borderBottom: 'none' }}>
        <h2 className={styles.cleanSectionTitle}>13. Contact</h2>
        <p className={styles.hierarchyParagraph} style={{ marginTop: '0.5rem' }}>
          If you have questions about these Terms or need to contact us regarding your account,
          please reach out to our team:
        </p>
        <a href="mailto:app.meetifyy@gmail.com" className={styles.emailBtn} style={{ marginTop: '1rem', display: 'inline-flex' }}>
          <Mail size={18} />
          app.meetifyy@gmail.com
        </a>
      </section>
    </StaticDocLayout>
  );
}
