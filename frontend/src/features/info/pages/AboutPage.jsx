import StaticDocLayout from './StaticDocLayout';
import styles from './StaticDocLayout.module.css';

export default function AboutPage() {
  return (
    <StaticDocLayout
      title="About Meetifyy"
      noHeroCard
    >
      {/* Intro section */}
      <p className={styles.changaIntroText}>
        Meetifyy is a student-first platform built to help college students find their people:
        whether that's a study partner, a hackathon team, a club, or just someone who shares the
        same niche interest.
      </p>
      <div className={styles.heroImageWrapper}>
        <img src="/about_hero.webp" alt="Students connecting on Meetifyy" className={styles.heroImage} />
      </div>

      {/* What You'll Find Here */}
      <section className={styles.centerSection}>
        <span className={styles.bigEmoji}>🎓</span>
        <h2 className={styles.cleanSectionTitle}>What You'll Find Here</h2>
        <p className={styles.hierarchyParagraph}>
          Communities organized around courses, clubs, and shared interests. Campus events you
          can discover and RSVP to. Crew activities where you can find collaborators for projects
          and hackathons. And direct messaging to actually connect with the people you meet.
        </p>
      </section>

      {/* Mission */}
      <section className={styles.centerSection}>
        <span className={styles.bigEmoji}>🚀</span>
        <h2 className={styles.cleanSectionTitle}>Why We Built This</h2>
        <p className={styles.hierarchyParagraph}>
          College is one of the best times to meet people who shape how you think and what you do
          next. But between classes, different schedules, and the sheer size of most campuses, it's
          genuinely hard to find your community. Meetifyy tries to make that easier.
        </p>
      </section>

      {/* What Makes Us Different */}
      <section className={styles.centerSection}>
        <span className={styles.bigEmoji}>💡</span>
        <h2 className={styles.cleanSectionTitle}>Built for Real Connections</h2>
        <p className={styles.hierarchyParagraph}>
          Meetifyy is organized around campus life and real-world activities rather than follower
          counts and viral content. The goal is to connect you with people at your college who
          actually share your goals, not to keep you scrolling.
        </p>
      </section>

      {/* Our Values */}
      <section className={styles.centerSection}>
        <span className={styles.bigEmoji}>❤️</span>
        <h2 className={styles.cleanSectionTitle}>What We Care About</h2>
        <p className={styles.hierarchyParagraph}>
          Community over metrics. An environment where every student feels welcome. Honest
          connections rather than performative ones. And a platform that respects your privacy and
          doesn't make money from your attention.
        </p>
      </section>

      {/* Join Callout */}
      <section className={styles.centerSection}>
        <span className={styles.bigEmoji}>✨</span>
        <h2 className={styles.cleanSectionTitle}>Join the Community</h2>
        <p className={styles.hierarchyParagraph}>
          Whether you're in your first week or your final semester, Meetifyy is a good place to
          start.
        </p>
        <p className={styles.highlightText} style={{ textAlign: 'center' }}>
          College is more than a degree. It's about the people you meet along the way.
        </p>
      </section>
    </StaticDocLayout>
  );
}
