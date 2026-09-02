import { motion } from 'framer-motion';
import styles from './StudentTestimonials.module.css';

const SparkleIcon = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
    <path d="M12 2L15 9L22 12L15 15L12 22L9 15L2 12L9 9Z" fill="#FBBF24" stroke="#D97706" />
  </svg>
);

export default function StudentTestimonials() {
  const testimonials = [
    {
      stars: '5/5',
      quote: "Meetifyy is actually useful as a fresher. I didn’t know many people or even what was happening around campus, and this helped me discover events and connect with people with similar interests. Definitely made the first few weeks easier.",
      author: "Soham",
      letter: "S",
      bgClass: styles.card,
      avatarBg: styles.avatarOrange,
      sparkles: (
        <>
          <SparkleIcon className={`${styles.sparkle} ${styles.sparkleTopLeft}`} />
          <SparkleIcon className={`${styles.sparkle} ${styles.sparkleBottomRight}`} />
        </>
      )
    },
    {
      stars: '5/5',
      quote: "I started using Meetifyy just to see what was happening on campus, but ended up finding communities and people I genuinely vibed with. It’s nice having everything in one place instead of finding out about things through random WhatsApp groups.",
      author: "Shivam",
      letter: "S",
      bgClass: styles.card,
      avatarBg: styles.avatarBlue,
      sparkles: null
    },
    {
      isCta: true,
      ctaText: "Share Yours",
      ctaLink: "mailto:hello@meetifyy.app?subject=My%20Meetifyy%20Experience",
      quote: "Have a story about meeting new friends, finding communities, or discovering events on campus? We'd love to hear how Meetifyy has shaped your college life.",
      author: "Tell us about your experience",
      role: "Share your story with fellow students",
      letter: "✨",
      bgClass: styles.inviteCard,
      avatarBg: styles.avatarGradient,
      sparkles: (
        <>
          <SparkleIcon className={`${styles.sparkle} ${styles.sparkleTopLeft}`} />
          <SparkleIcon className={`${styles.sparkle} ${styles.sparkleBottomRight}`} />
        </>
      )
    }
  ];

  return (
    <section id="testimonials" className={styles.section} aria-label="Student testimonials">
      {/* Decorative Pencil/Doodle Grid & Loops */}
      <div className={styles.bgGrid} aria-hidden="true">
        <svg className={styles.bgGridSvg}>
          <defs>
            <pattern id="testigrid" width="40" height="40" patternUnits="userSpaceOnUse">
              <path d="M 40 0 L 0 0 0 40" fill="none" stroke="currentColor" strokeWidth="1" strokeDasharray="2 2" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#testigrid)" />
          <path d="M-100,200 C300,100 500,600 1200,300" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <path d="M200,600 C800,200 1000,800 1500,400" fill="none" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      </div>

      <div className={styles.container}>
        {/* Section Header */}
        <div className={styles.header}>
          <div className={styles.eyebrowWrapper}>
            <span className={styles.eyebrow}>
              Student Stories
            </span>
          </div>
          <h2 className={`${styles.title} landing-font-display`}>
            What They're{' '}
            <span className={styles.underlineWrap}>Saying
              <svg className={styles.underlineSvg} viewBox="0 0 100 10" preserveAspectRatio="none">
                <path d="M 3 8 C 30 7, 70 8, 97 4 C 60 7.5, 20 8.5, 5 9" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" />
              </svg>
            </span>
          </h2>
        </div>

        {/* Testimonials Stack */}
        <div className={styles.stack}>
          {testimonials.map((testi, idx) => (
            <motion.div
              key={idx}
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6, delay: idx * 0.15 }}
              className={`${testi.bgClass} group`}
            >
              {/* Optional Sparkles */}
              {testi.sparkles}

              {/* Avatar Icon */}
              <div className={`${styles.avatar} ${testi.avatarBg}`}>
                {testi.letter}
              </div>

              {/* Content block */}
              <div className={styles.contentBlock}>
                <div className={styles.contentHeader}>
                  <div className={styles.authorGroup}>
                    <h4 className={styles.author}>
                      {testi.author}
                    </h4>
                    {testi.role && (
                      <p className={styles.role}>
                        {testi.role}
                      </p>
                    )}
                  </div>

                  {/* Rating / CTA Badge */}
                  {testi.isCta ? (
                    <a
                      href={testi.ctaLink}
                      className={styles.ctaBadge}
                      aria-label="Share your Meetifyy experience"
                    >
                      <span className={styles.star}>★</span> {testi.ctaText}
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginLeft: '1px' }}>
                        <line x1="7" y1="17" x2="17" y2="7" />
                        <polyline points="7 7 17 7 17 17" />
                      </svg>
                    </a>
                  ) : (
                    <div className={styles.ratingBadge}>
                      <span className={styles.star}>★</span> {testi.stars}
                    </div>
                  )}
                </div>

                <p className={styles.quote}>
                  {testi.quote}
                </p>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
