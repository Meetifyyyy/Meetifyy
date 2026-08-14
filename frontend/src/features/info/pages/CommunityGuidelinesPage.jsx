import StaticDocLayout from './StaticDocLayout';
import styles from './StaticDocLayout.module.css';
import { Mail } from 'lucide-react';

export default function CommunityGuidelinesPage() {
  const guidelines = [
    {
      num: 1,
      title: 'Be Respectful & Kind',
      desc: 'Treat every member of the Meetifyy community with baseline respect. While healthy debates and discussions are encouraged, personal attacks, insults, intimidation, or sustained harassment will absolutely not be tolerated under any circumstances.'
    },
    {
      num: 2,
      title: 'Zero Tolerance for Bullying or Harassment',
      desc: 'Do not bully, threaten, stalk, or repeatedly contact someone after they have asked you to stop. Furthermore, encouraging or organizing others to harass an individual or group is strictly prohibited.'
    },
    {
      num: 3,
      title: 'No Hate Speech or Discrimination',
      desc: 'Meetifyy is an inclusive platform. Do not post content or engage in behavior that promotes, encourages, or incites hatred, violence, or discrimination against anyone based on race, ethnicity, national origin, religion, gender identity, disability, or sexual orientation.'
    },
    {
      num: 4,
      title: 'Keep Content Safe and Appropriate',
      desc: 'Do not share sexually explicit material, non-consensual intimate imagery, graphic violence, illegal content, or any media that promotes self-harm, eating disorders, or dangerous real-world activities.'
    },
    {
      num: 5,
      title: 'Be Authentic & Honest',
      desc: 'Do not impersonate another person, student organization, or university official. Do not create fake identities or intentionally misrepresent your campus affiliation to deceive others.'
    },
    {
      num: 6,
      title: 'Respect Personal Privacy (No Doxxing)',
      desc: 'Never share another person’s private or personally identifiable information without their explicit, verifiable consent. This includes phone numbers, private email addresses, home or dorm addresses, ID documents, or screenshots of private conversations.'
    },
    {
      num: 7,
      title: 'No Spam, Scams, or Exploitation',
      desc: 'Do not send unsolicited spam messages, phishing links, fraudulent offers, or engage in excessive self-promotion. Using automated scripts or fake accounts to manipulate engagement is prohibited.'
    },
    {
      num: 8,
      title: 'Community & Event Standards',
      desc: 'Community creators and event organizers must provide accurate information, clearly define the purpose of their groups, and actively moderate to ensure compliance with these Guidelines. Meetifyy reserves the right to disband communities or cancel events that violate our policies.'
    },
    {
      num: 9,
      title: 'Direct Messaging Etiquette',
      desc: 'Use the direct messaging feature responsibly. Do not harass, threaten, or send explicit content. If a user asks you to stop contacting them or blocks you, attempting to bypass those restrictions is a severe violation.'
    },
    {
      num: 10,
      title: 'Intellectual Property Respect',
      desc: 'Only upload or share content that you have created yourself or have explicit legal permission to use. Do not claim ownership over the creative work of others.'
    },
    {
      num: 11,
      title: 'Reporting Violations',
      desc: 'If you witness behavior or content that violates these Guidelines, please utilize our in-app reporting tools immediately. Your reports are confidential and critical to maintaining community safety.'
    },
    {
      num: 12,
      title: 'Enforcement & Disciplinary Action',
      desc: 'Meetifyy takes these Guidelines seriously. Violations may result in content removal, feature restrictions, temporary account suspension, or permanent bans. We will also report illegal activities to law enforcement when necessary and required by law.'
    },
    {
      num: 13,
      title: 'Policy Updates',
      desc: 'We may update these Community Guidelines as our platform evolves. Continued use of Meetifyy signifies your agreement to abide by the most current version of these rules.'
    }
  ];

  return (
    <StaticDocLayout
      badge="Safety & Culture"
      title="Community Guidelines"
      subtitle="The foundational standards for maintaining a safe, respectful, and inclusive environment for every student on Meetifyy."
      effectiveDate="17 July 2026"
      noHeroCard
      leftAlign
    >
      <section className={styles.cleanSection}>
        <h2 className={styles.cleanSectionTitle}>Our Shared Commitment</h2>
        <p className={styles.hierarchyParagraph} style={{ marginTop: '0.5rem' }}>
          Welcome to Meetifyy! Our core mission is to help students discover communities, collaborate on projects, and build meaningful relationships across campuses. To achieve this, we rely on a shared commitment to safety and respect.
        </p>
        <p className={styles.hierarchyParagraph}>
          These Community Guidelines establish the strict standards expected from every individual using the Platform. By participating in the Meetifyy ecosystem, you agree to adhere to these rules and help us foster an environment where everyone feels secure and welcome.
        </p>
      </section>

      {guidelines.map((g) => (
        <section key={g.num} className={styles.cleanSection}>
          <h2 className={styles.cleanSectionTitle}>{g.num}. {g.title}</h2>
          <p className={styles.hierarchyParagraph} style={{ marginTop: '0.5rem' }}>{g.desc}</p>
        </section>
      ))}

      <section className={styles.cleanSection} style={{ borderBottom: 'none' }}>
        <h2 className={styles.cleanSectionTitle}>14. Trust & Safety Contact</h2>
        <p className={styles.hierarchyParagraph} style={{ marginTop: '0.5rem' }}>
          If you have questions regarding these Community Guidelines, or if you need to escalate a severe safety concern, please contact our Trust & Safety team directly:
        </p>
        <a href="mailto:meetify0@gmail.com" className={styles.emailBtn} style={{ marginTop: '1rem', display: 'inline-flex' }}>
          <Mail size={18} />
          meetify0@gmail.com
        </a>
      </section>
    </StaticDocLayout>
  );
}
