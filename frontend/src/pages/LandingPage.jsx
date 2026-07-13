import { useRef, useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTheme } from '../context/ThemeContext';
import { motion } from 'framer-motion';
import {
  ArrowRight,
  Sun,
  Moon,
  HelpCircle,
  LifeBuoy,
  Bug,
  Shield,
  FileText,
} from 'lucide-react';
import Background from '../components/common/Background';
import logo from '../assets/images/meetify logo.png';
import pexelsStudents from '../assets/images/pexels-students.jpg';
import styles from './LandingPage.module.css';

const communityTags = [
  { name: 'Startups', color: '#2563EB' },
  { name: 'Design', color: '#EC4899' },
  { name: 'Music', color: '#F59E0B' },
  { name: 'Engineering', color: '#10B981' },
  { name: 'Photography', color: '#8B5CF6' },
  { name: 'Gaming', color: '#06B6D4' },
  { name: 'Travel', color: '#F97316' },
  { name: 'Fitness', color: '#EF4444' },
  { name: 'Art', color: '#A855F7' },
  { name: 'Science', color: '#0EA5E9' },
  { name: 'Writing', color: '#14B8A6' },
  { name: 'Film', color: '#D946EF' },
];

const marqueeItems = [
  'Real Conversations', 'Find Your People', 'No Algorithms',
  'Genuine Connections', 'College Communities', 'Share Your Spotlight',
];

const principles = [
  {
    title: 'Real Conversations',
    desc: 'No noise, no algorithms. Connect with people who share your passions.',
    visual: 'conversation',
  },
  {
    title: 'Meaningful Communities',
    desc: 'Find your people across clubs, interests, and campuses -- all in one place.',
    visual: 'community',
  },
  {
    title: 'Moments That Matter',
    desc: 'Share wins, start discussions, and build memories that last beyond graduation.',
    visual: 'moments',
  },
];

const fadeUp = {
  initial: { opacity: 0, y: 40 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: '-80px' },
  transition: { duration: 0.7, ease: [0.16, 1, 0.3, 1] },
};

const slideUp = (delay = 0) => ({
  initial: { opacity: 0, y: 30 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: '-60px' },
  transition: { duration: 0.6, delay, ease: [0.16, 1, 0.3, 1] },
});

export default function LandingPage() {
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();
  const scrollRef = useRef(null);
  const [headerVisible, setHeaderVisible] = useState(true);
  const lastScrollY = useRef(0);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const onScroll = () => {
      const currentY = el.scrollTop;
      if (currentY < 10) {
        setHeaderVisible(true);
      } else if (currentY > lastScrollY.current) {
        setHeaderVisible(false);
      } else {
        setHeaderVisible(true);
      }
      lastScrollY.current = currentY;
    };

    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <>
      <Background />
      <div className={styles.page} ref={scrollRef}>

        <motion.header
          className={styles.header}
          animate={{ y: headerVisible ? 0 : -96 }}
          transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
        >
          <div className={styles.brandLeft} onClick={() => navigate('/')}>
            <img className={styles.logo} src={logo} alt="Meetify" />
            <span className={styles.brandName}>Meetifyy</span>
          </div>
          <div className={styles.headerActions}>
            <button
              className={styles.themeBtn}
              onClick={toggleTheme}
              aria-label="Toggle theme"
            >
              {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
            </button>
            <button className={styles.loginBtn} onClick={() => navigate('/login')}>
              Log in
            </button>
          </div>
        </motion.header>

        <motion.section
          className={styles.hero}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.8 }}
        >
          <div className={styles.heroLeft}>
            <motion.p
              className={styles.heroTitle}
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7, delay: 0.3, ease: [0.16, 1, 0.3, 1] }}
            >
              Where your <span className={styles.heroTitleGradient}>college story</span> begins...
              <br />
              Meet new people, join communities, and make the most of your college journey.
            </motion.p>

            <motion.div
              className={styles.heroActions}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.65, ease: [0.16, 1, 0.3, 1] }}
            >
              <button className={styles.heroBtnPrimary} onClick={() => navigate('/signup')}>
                Try it now <ArrowRight size={16} />
              </button>
            </motion.div>
          </div>

          <motion.div
            className={styles.heroRight}
            initial={{ opacity: 0, x: 40 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.8, delay: 0.5, ease: [0.16, 1, 0.3, 1] }}
          >
            <img
              className={styles.heroImage}
              src={pexelsStudents}
              alt="College students"
            />
          </motion.div>

        </motion.section>

        <motion.div className={styles.marqueeSection} {...fadeUp}>
          <div className={styles.marqueeTrack}>
            {[...Array(2)].map((_, loopIdx) =>
              marqueeItems.map((item, i) => (
                <span className={styles.marqueeItem} key={`${loopIdx}-${i}`}>
                  {item}
                  <span className={styles.marqueeDot} />
                </span>
              ))
            )}
          </div>
        </motion.div>

        <motion.section className={styles.statement} {...fadeUp}>
          <p className={styles.statementText}>
            College isn't just about what you learn in class.{' '}
            <span className={styles.statementEm}>It's who you meet along the way.</span>
          </p>
        </motion.section>

        <section className={styles.principles}>
          {principles.map((item, i) => (
            <motion.div className={styles.principle} key={i} {...slideUp(i * 0.15)}>
              <div className={`${styles.principleVisual} ${styles[item.visual]}`}>
                <img src={pexelsStudents} alt="" className={styles.visualPhoto} />
              </div>
              <div className={styles.principleCopy}>
                <p className={styles.principleText}>
                  <span className={styles.principleTitle}>{item.title}</span>
                  <br />
                  {item.desc}
                </p>
              </div>
            </motion.div>
          ))}
        </section>

        <motion.section className={styles.statsBanner} {...fadeUp}>
          <p className={styles.statsText}>
            <span className={styles.statsNumber}>12,000+</span> members ·{' '}
            <span className={styles.statsNumber}>340</span> communities ·{' '}
            <span className={styles.statsNumber}>89,000</span> conversations
          </p>
        </motion.section>

        <motion.section className={styles.communities} {...fadeUp}>
          <div className={styles.communitiesIntro}>
            <h2 className={styles.communitiesTitle}>
              Whatever you're into,
              <br />
              <span>there's a community for it</span>
            </h2>
            <p className={styles.communitiesSub}>
              From niche hobbies to major passions -- find your people, join the conversation.
            </p>
          </div>
          <div className={styles.tagCloud}>
            {communityTags.map((tag, i) => (
              <motion.span
                className={styles.tag}
                key={i}
                initial={{ opacity: 0, scale: 0.9 }}
                whileInView={{ opacity: 1, scale: 1 }}
                viewport={{ once: true }}
                transition={{ duration: 0.3, delay: i * 0.04 }}
              >
                <span className={styles.tagDot} style={{ background: tag.color }} />
                {tag.name}
              </motion.span>
            ))}
          </div>
        </motion.section>

        <motion.section className={styles.cta} {...fadeUp}>
          <h2 className={styles.ctaTitle}>Ready to find your people?</h2>
          <p className={styles.ctaSub}>
            Join thousands of students already sharing their spotlight.
          </p>
          <button className={styles.ctaBtn} onClick={() => navigate('/signup')}>
            Join Meetify <ArrowRight size={16} />
          </button>
        </motion.section>

        <footer className={styles.footer}>
          <div className={styles.footerInner}>
            <div className={styles.footerBrandCol}>
              <div className={styles.footerBrand}>
                <img className={styles.footerLogo} src={logo} alt="Meetify" />
                Meetifyy
              </div>
              <p className={styles.footerTagline}>Where your college story begins. Built for students, by students.</p>
            </div>
            <div>
              <h4 className={styles.footerColTitle}>Support</h4>
              <ul className={styles.footerLinks}>
                <li><a href="#" className={styles.footerLink}><HelpCircle size={14} /> FAQ</a></li>
                <li><a href="#" className={styles.footerLink}><LifeBuoy size={14} /> Help &amp; Support</a></li>
                <li><a href="#" className={styles.footerLink}><Bug size={14} /> Report a Bug</a></li>
              </ul>
            </div>
            <div>
              <h4 className={styles.footerColTitle}>Legal</h4>
              <ul className={styles.footerLinks}>
                <li><a href="#" className={styles.footerLink}><Shield size={14} /> Privacy Policy</a></li>
                <li><a href="#" className={styles.footerLink}><FileText size={14} /> Terms of Service</a></li>
              </ul>
            </div>
            <div>
              <h4 className={styles.footerColTitle}>Social</h4>
              <ul className={styles.footerLinks}>
                <li><a href="#" className={styles.footerLink}>Twitter / X</a></li>
                <li><a href="#" className={styles.footerLink}>LinkedIn</a></li>
                <li><a href="#" className={styles.footerLink}>Instagram</a></li>
              </ul>
            </div>
          </div>
          <div className={styles.footerBottom}>
            <span className={styles.footerCopy}>&copy; 2026 Meetify. All rights reserved.</span>
            <div className={styles.footerSocials}>
              <a href="#" className={styles.footerSocialLink} aria-label="Twitter">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                </svg>
              </a>
              <a href="#" className={styles.footerSocialLink} aria-label="LinkedIn">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
                </svg>
              </a>
              <a href="#" className={styles.footerSocialLink} aria-label="Instagram">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="2" y="2" width="20" height="20" rx="5" ry="5" />
                  <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
                  <line x1="17.5" y1="6.5" x2="17.51" y2="6.5" />
                </svg>
              </a>
            </div>
          </div>
        </footer>

      </div>
    </>
  );
}
