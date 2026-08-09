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
        Meetifyy is a student-first platform designed to help college students connect with like-minded people, discover communities, participate in events, find project teammates, and build lasting relationships both inside and outside the classroom.
      </p>
      <div className={styles.heroImageWrapper}>
        <img src="/about_hero.webp" alt="Meetifyy" className={styles.heroImage} />
      </div>

      {/* What You'll Find Here */}
      <section className={styles.centerSection}>
        <span className={styles.bigEmoji}>🎓</span>
        <h2 className={styles.cleanSectionTitle}>What You'll Find Here</h2>
        <p className={styles.hierarchyParagraph}>
          Find new campus friends, study partners, hackathon collaborators, club communities, and local events—all brought together in one place.
        </p>
      </section>

      {/* Mission & Vision */}
      <section className={styles.centerSection}>
        <span className={styles.bigEmoji}>🚀</span>
        <h2 className={styles.cleanSectionTitle}>Our Mission & Vision</h2>
        <p className={styles.hierarchyParagraph}>
          We make student connections effortless and meaningful. We envision a future where every college student finds a community where they truly belong.
        </p>
      </section>

      {/* What Makes Us Different */}
      <section className={styles.centerSection}>
        <span className={styles.bigEmoji}>💡</span>
        <h2 className={styles.cleanSectionTitle}>What Makes Meetifyy Different?</h2>
        <p className={styles.hierarchyParagraph}>
          Built for real-world campus interactions instead of endless doom-scrolling. Connect directly with peers who share your academic and personal goals.
        </p>
      </section>

      {/* Our Values */}
      <section className={styles.centerSection}>
        <span className={styles.bigEmoji}>❤️</span>
        <h2 className={styles.cleanSectionTitle}>Our Core Values</h2>
        <p className={styles.hierarchyParagraph}>
          Community first, inclusivity always, authentic connections over vanity metrics, and a safe, respectful environment for everyone.
        </p>
      </section>

      {/* Join Callout */}
      <section className={styles.centerSection}>
        <span className={styles.bigEmoji}>✨</span>
        <h2 className={styles.cleanSectionTitle}>Join the Community</h2>
        <p className={styles.hierarchyParagraph}>
          Whether you’re a freshman, club leader, or builder, Meetifyy is built for you.
        </p>
        <p className={styles.highlightText} style={{ textAlign: 'center' }}>
          Because college isn’t just about earning a degree—it’s about finding your people.
        </p>
      </section>
    </StaticDocLayout>
  );
}
