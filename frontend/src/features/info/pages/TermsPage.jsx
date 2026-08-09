import StaticDocLayout from './StaticDocLayout';
import styles from './StaticDocLayout.module.css';
import { Mail } from 'lucide-react';

export default function TermsPage() {
  const sections = [
    {
      num: 1,
      title: 'About Meetifyy',
      content: 'Meetifyy is a digital platform designed to help students discover communities, connect with like-minded peers, participate in events, find project teammates, and build meaningful campus and professional connections. While our primary audience is college students, certain public events or communities may be accessible to a broader audience.'
    },
    {
      num: 2,
      title: 'Eligibility & Account Security',
      list: [
        'Age Requirement: You must be at least 13 years of age, or the minimum legal age required under applicable law in your jurisdiction, to use the Platform.',
        'Capacity: You must have the legal capacity to enter into a binding contract.',
        'Account Responsibility: You must provide accurate registration information and are solely responsible for maintaining the confidentiality of your login credentials and for all activities that occur under your account.',
        'Notification: You agree to immediately notify Meetifyy of any unauthorized access or security breach regarding your account.'
      ]
    },
    {
      num: 3,
      title: 'User Conduct & Prohibited Uses',
      content: 'To ensure a safe and respectful environment, you agree not to engage in the following prohibited activities:',
      list: [
        'Harassment, bullying, defamation, or hate speech targeting any individual or group.',
        'Posting illegal, abusive, obscene, or fraudulent content.',
        'Impersonating another person, organization, or misrepresenting your campus affiliation.',
        'Distributing spam, phishing links, malware, or engaging in unauthorized scraping or data mining.'
      ]
    },
    {
      num: 4,
      title: 'Communities and Events',
      content: 'Users may create and join digital communities and real-world events. Organizers are solely responsible for the content, safety, and legal compliance of their communities and events. Meetifyy reserves the right to remove any community or event that violates these Terms or our Community Guidelines without prior notice.'
    },
    {
      num: 5,
      title: 'Content Ownership & Licensing',
      content: 'Ownership: You retain all ownership rights to the original content you post on Meetifyy. However, to operate the Platform effectively, we require certain permissions.',
      list: [
        'License Grant: By posting content, you grant Meetifyy a non-exclusive, worldwide, royalty-free, sub-licensable, and transferable license to host, use, display, reproduce, modify, and distribute your content in connection with operating and promoting the Platform.',
        'IP Protection: You represent and warrant that you have the necessary rights to grant this license and that your content does not infringe upon the intellectual property rights of others.'
      ]
    },
    {
      num: 6,
      title: 'Meetifyy Intellectual Property',
      content: 'All Platform branding, software code, UI/UX designs, logos, graphics, and trademarks are the exclusive intellectual property of Meetifyy or its licensors. You may not copy, modify, or distribute our intellectual property without express written consent.'
    },
    {
      num: 7,
      title: 'Disclaimer of Warranties',
      content: 'The Platform is provided strictly on an "as is" and "as available" basis. Meetifyy disclaims all warranties, whether express or implied, including but not limited to the implied warranties of merchantability, fitness for a particular purpose, and non-infringement. We do not guarantee continuous, uninterrupted, or error-free access to the Platform.'
    },
    {
      num: 8,
      title: 'Limitation of Liability',
      content: 'To the maximum extent permitted by applicable law, Meetifyy, its founders, and affiliates shall not be liable for any indirect, incidental, special, consequential, or punitive damages, including loss of profits, data, or goodwill, arising from your use of the Platform, user interactions, or any unauthorized access to your account.'
    },
    {
      num: 9,
      title: 'Indemnification',
      content: 'You agree to indemnify, defend, and hold harmless Meetifyy and its affiliates from any legal claims, liabilities, damages, losses, and expenses (including legal fees) arising out of your violation of these Terms, your misuse of the Platform, or your infringement of any third-party rights.'
    },
    {
      num: 10,
      title: 'Suspension and Termination',
      content: 'We reserve the right to suspend or permanently terminate your account and access to the Platform at our sole discretion, without notice or liability, if we determine that you have violated these Terms. You may also request account deletion at any time via your account settings.'
    },
    {
      num: 11,
      title: 'Governing Law & Dispute Resolution',
      content: 'These Terms shall be governed by and construed in accordance with the laws of India. Any legal disputes or claims arising out of or relating to these Terms or the Platform shall be subject to the exclusive jurisdiction of the competent courts located in India.'
    },
    {
      num: 12,
      title: 'Modifications to the Terms',
      content: 'Meetifyy reserves the right to modify these Terms at any time. We will provide notice of material changes via the Platform or email. Your continued use of the Platform after the effective date of the updated Terms constitutes your binding acceptance of the changes.'
    }
  ];

  return (
    <StaticDocLayout
      badge="Terms of Service"
      title="Terms & Conditions"
      subtitle="The legally binding rules, terms, and agreements governing your use of Meetifyy."
      effectiveDate="17 July 2026"
      noHeroCard
      leftAlign
    >
      <section className={styles.cleanSection}>
        <h2 className={styles.cleanSectionTitle}>Introduction & Acceptance</h2>
        <p className={styles.hierarchyParagraph} style={{ marginTop: '0.5rem' }}>
          Welcome to Meetifyy! These Terms & Conditions (“Terms”) constitute a legally binding agreement between you and Meetifyy governing your access to and use of our platform, including our website, mobile applications, and related services (collectively, the “Platform”).
        </p>
        <p className={styles.hierarchyParagraph}>
          By registering for an account, accessing, or using the Platform, you expressly acknowledge that you have read, understood, and agree to be bound by these Terms and our associated policies.
        </p>
        <p className={styles.hierarchyParagraph} style={{ fontWeight: 600, color: '#dc2626' }}>
          If you do not agree to all of the provisions outlined in these Terms, you are not authorized to access or use the Platform.
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
        <h2 className={styles.cleanSectionTitle}>13. Contact & Grievances</h2>
        <p className={styles.hierarchyParagraph} style={{ marginTop: '0.5rem' }}>
          If you have any questions regarding these Terms & Conditions or wish to file a formal grievance, please contact our support team:
        </p>
        <a href="mailto:meetify0@gmail.com" className={styles.emailBtn} style={{ marginTop: '1rem', display: 'inline-flex' }}>
          <Mail size={18} />
          meetify0@gmail.com
        </a>
      </section>
    </StaticDocLayout>
  );
}
