import StaticDocLayout from './StaticDocLayout';
import styles from './StaticDocLayout.module.css';
import { Mail } from '@shared/components/icons';

export default function CommunityGuidelinesPage() {
  const guidelines = [
    {
      num: 1,
      title: 'Treat Others with Respect',
      desc: 'Engage with other members of the Meetifyy community with basic courtesy and respect. Healthy disagreement is welcome; personal attacks, sustained insults, and intimidation are not.'
    },
    {
      num: 2,
      title: 'No Bullying or Harassment',
      desc: 'Do not bully, threaten, stalk, or repeatedly contact someone who has asked you to stop. Organizing or encouraging others to target a specific person or group is prohibited.'
    },
    {
      num: 3,
      title: 'No Hate Speech or Discrimination',
      desc: 'Meetifyy is open to students of every background. Do not post content that promotes hatred, incites violence, or discriminates against any person or group on the basis of race, ethnicity, national origin, religion, gender, gender identity, disability, or sexual orientation.'
    },
    {
      num: 4,
      title: 'Keep Content Appropriate',
      desc: 'Do not share sexually explicit material, non-consensual intimate imagery, graphic violence, or illegal content. Do not post content that promotes, glorifies, or provides instructions for self-harm, suicide, or dangerous activities. Educational, harm-reduction, and recovery-oriented discussion is permitted.'
    },
    {
      num: 5,
      title: 'Be Honest About Who You Are',
      desc: 'Do not impersonate another person, student organization, or institution. Do not create accounts with false identities or misrepresent your institutional affiliation to deceive others.'
    },
    {
      num: 6,
      title: 'Respect Personal Privacy',
      desc: 'Do not share another person\'s private information without their permission. This includes home or dorm addresses, phone numbers, private email addresses, identity documents, and screenshots of private conversations. Sharing such information without consent, regardless of where it was originally obtained, is not allowed.'
    },
    {
      num: 7,
      title: 'No Spam, Scams, or Deception',
      desc: 'Do not send unsolicited bulk messages, phishing links, or fraudulent offers. Excessive self-promotion and the use of automated accounts or scripts to manipulate engagement are prohibited.'
    },
    {
      num: 8,
      title: 'Community and Event Responsibility',
      desc: 'Community creators and event organizers are responsible for providing accurate information and keeping their communities and events in compliance with these Guidelines. Meetifyy may remove or close communities and events that breach our policies.'
    },
    {
      num: 9,
      title: 'Messaging Etiquette',
      desc: 'Use direct messages in good faith. Do not send harassing, threatening, or explicitly sexual messages. If someone asks you to stop contacting them or blocks you, respect that. Attempting to circumvent a block is a violation of these Guidelines.'
    },
    {
      num: 10,
      title: 'Respect Intellectual Property',
      desc: 'Only post or share content you have created yourself or have the right to use. Do not claim ownership of other people\'s creative work.'
    },
    {
      num: 11,
      title: 'Reporting Violations',
      desc: 'If you see content or behavior that violates these Guidelines, use the in-app reporting tools. Reports help us keep the Platform safe. Reported information may be reviewed by Meetifyy staff and, where required by law or safety considerations, shared with relevant authorities.'
    },
    {
      num: 12,
      title: 'Enforcement',
      desc: 'Violations of these Guidelines may result in content removal, feature restrictions, account suspension, or permanent bans, depending on severity and context. Illegal activity will be reported to law enforcement where required.'
    },
    {
      num: 13,
      title: 'Updates to These Guidelines',
      desc: 'We may revise these Community Guidelines as the Platform grows. We will update the date at the top of the page when changes are made. Continued use of Meetifyy means you agree to the current version of these Guidelines.'
    }
  ];

  return (
    <StaticDocLayout
      badge="Safety & Culture"
      title="Community Guidelines"
      subtitle="The standards that keep Meetifyy safe, respectful, and worth showing up to."
      effectiveDate="27 August 2026"
      noHeroCard
      leftAlign
    >
      <section className={styles.cleanSection}>
        <h2 className={styles.cleanSectionTitle}>Our Shared Commitment</h2>
        <p className={styles.hierarchyParagraph} style={{ marginTop: '0.5rem' }}>
          Meetifyy exists to help students find their people: study partners, collaborators, friends,
          and communities that share their interests. That only works if everyone here acts in good
          faith.
        </p>
        <p className={styles.hierarchyParagraph}>
          These Guidelines describe the behavior we expect from every person on the Platform. They
          apply to all content and interactions, whether in public communities, private messages, or
          event pages. By using Meetifyy, you agree to follow them.
        </p>
      </section>

      {guidelines.map((g) => (
        <section key={g.num} className={styles.cleanSection}>
          <h2 className={styles.cleanSectionTitle}>{g.num}. {g.title}</h2>
          <p className={styles.hierarchyParagraph} style={{ marginTop: '0.5rem' }}>{g.desc}</p>
        </section>
      ))}

      <section className={styles.cleanSection} style={{ borderBottom: 'none' }}>
        <h2 className={styles.cleanSectionTitle}>14. Contact</h2>
        <p className={styles.hierarchyParagraph} style={{ marginTop: '0.5rem' }}>
          If you need to escalate a safety concern or have a question about these Guidelines,
          contact us directly:
        </p>
        <a href="mailto:app.meetifyy@gmail.com" className={styles.emailBtn} style={{ marginTop: '1rem', display: 'inline-flex' }}>
          <Mail size={18} />
          app.meetifyy@gmail.com
        </a>
      </section>
    </StaticDocLayout>
  );
}
