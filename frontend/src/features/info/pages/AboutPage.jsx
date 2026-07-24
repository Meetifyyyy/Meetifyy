import StaticDocLayout from './StaticDocLayout';
import styles from './StaticDocLayout.module.css';
import { Users, Target, Eye, Sparkles, Heart, Shield, Compass, Group } from 'lucide-react';

export default function AboutPage() {
  return (
    <StaticDocLayout
      badge="Our Story"
      title="About Meetifyy"
      subtitle="Welcome to Meetifyy — where students find their people."
    >
      {/* Intro section */}
      <section className={styles.card}>
        <div className={styles.cardHeader}>
          <div className={styles.iconWrapper}>
            <Compass size={22} />
          </div>
          <h2 className={styles.cardTitle}>Why We Built Meetifyy</h2>
        </div>
        <p className={styles.cardText}>
          College is more than just lectures, assignments, and exams. It’s about the people you meet, the communities you join, the experiences you create, and the opportunities you discover. Yet, for many students, making meaningful connections isn’t always easy.
        </p>
        <p className={styles.cardText}>
          That’s why we built Meetifyy.
        </p>
        <p className={styles.cardText}>
          Meetifyy is a student-first platform designed to help college students connect with like-minded people, discover communities, participate in events, find project teammates, and build lasting relationships both inside and outside the classroom.
        </p>
      </section>

      {/* What you're looking for */}
      <section className={styles.card}>
        <div className={styles.cardHeader}>
          <div className={styles.iconWrapper}>
            <Sparkles size={22} />
          </div>
          <h2 className={styles.cardTitle}>What You'll Find Here</h2>
        </div>
        <p className={styles.cardText}>
          Whether you’re looking for:
        </p>
        <ul className={styles.bulletList}>
          <li className={styles.bulletItem}><span className={styles.bulletDot} /> New friends & campus social circles</li>
          <li className={styles.bulletItem}><span className={styles.bulletDot} /> Study partners for exams & courses</li>
          <li className={styles.bulletItem}><span className={styles.bulletDot} /> Hackathon teammates & project collaborators</li>
          <li className={styles.bulletItem}><span className={styles.bulletDot} /> Club communities & student organizations</li>
          <li className={styles.bulletItem}><span className={styles.bulletDot} /> Campus events & meetups</li>
          <li className={styles.bulletItem}><span className={styles.bulletDot} /> Networking opportunities</li>
          <li className={styles.bulletItem}><span className={styles.bulletDot} /> People who share your passions & interests</li>
        </ul>
        <p className={styles.cardText} style={{ marginTop: '1rem' }}>
          Meetifyy brings them all together in one place.
        </p>
      </section>

      {/* Mission & Vision */}
      <div className={styles.gridTwo}>
        <section className={styles.card}>
          <div className={styles.cardHeader}>
            <div className={styles.iconWrapper}>
              <Target size={22} />
            </div>
            <h2 className={styles.cardTitle}>Our Mission</h2>
          </div>
          <p className={styles.cardText}>
            To make meaningful student connections easier, stronger, and more accessible for every college student.
          </p>
          <p className={styles.cardText}>
            We believe that one connection can change a student’s college journey—leading to friendships, collaborations, opportunities, and lifelong memories.
          </p>
        </section>

        <section className={styles.card}>
          <div className={styles.cardHeader}>
            <div className={styles.iconWrapper}>
              <Eye size={22} />
            </div>
            <h2 className={styles.cardTitle}>Our Vision</h2>
          </div>
          <p className={styles.cardText}>
            We envision a future where every student, regardless of their background or college, has the opportunity to find a community where they truly belong.
          </p>
          <p className={styles.cardText}>
            We want Meetifyy to become the go-to platform for discovering people, communities, and opportunities across campuses.
          </p>
        </section>
      </div>

      {/* What Makes Us Different */}
      <section className={styles.card}>
        <div className={styles.cardHeader}>
          <div className={styles.iconWrapper}>
            <Users size={22} />
          </div>
          <h2 className={styles.cardTitle}>What Makes Meetifyy Different?</h2>
        </div>
        <p className={styles.cardText}>
          Unlike traditional social platforms, Meetifyy is built around meaningful connections rather than endless scrolling.
        </p>
        <div className={styles.gridTwo}>
          <div className={styles.featureBox}>
            <h3 className={styles.featureBoxTitle}>Discover Communities</h3>
            <p className={styles.featureBoxText}>Find groups and clubs that match your exact interests and university vibe.</p>
          </div>
          <div className={styles.featureBox}>
            <h3 className={styles.featureBoxTitle}>Meet Like-Minded People</h3>
            <p className={styles.featureBoxText}>Connect directly with students who share your academic or personal goals.</p>
          </div>
          <div className={styles.featureBox}>
            <h3 className={styles.featureBoxTitle}>Find Teammates</h3>
            <p className={styles.featureBoxText}>Build dream teams for projects, hackathons, and campus competitions.</p>
          </div>
          <div className={styles.featureBox}>
            <h3 className={styles.featureBoxTitle}>Stay Updated</h3>
            <p className={styles.featureBoxText}>Never miss out on campus events, meetups, and club activities.</p>
          </div>
        </div>
      </section>

      {/* Our Values */}
      <section className={styles.card}>
        <div className={styles.cardHeader}>
          <div className={styles.iconWrapper}>
            <Heart size={22} />
          </div>
          <h2 className={styles.cardTitle}>Our Values</h2>
        </div>
        <div className={styles.gridTwo}>
          <div className={styles.featureBox}>
            <h3 className={styles.featureBoxTitle}>Community First</h3>
            <p className={styles.featureBoxText}>People are at the heart of everything we build.</p>
          </div>
          <div className={styles.featureBox}>
            <h3 className={styles.featureBoxTitle}>Inclusivity</h3>
            <p className={styles.featureBoxText}>Everyone deserves a place where they feel welcome, respected, and valued.</p>
          </div>
          <div className={styles.featureBox}>
            <h3 className={styles.featureBoxTitle}>Authentic Connections</h3>
            <p className={styles.featureBoxText}>We encourage genuine relationships over superficial interactions.</p>
          </div>
          <div className={styles.featureBox}>
            <h3 className={styles.featureBoxTitle}>Growth Through Collaboration</h3>
            <p className={styles.featureBoxText}>Great ideas often begin with great people. We help students find both.</p>
          </div>
        </div>
        <div className={styles.featureBox} style={{ marginTop: '1.25rem' }}>
          <h3 className={styles.featureBoxTitle}>Safety & Respect</h3>
          <p className={styles.featureBoxText}>We’re committed to creating a positive, respectful, and secure environment for our community.</p>
        </div>
      </section>

      {/* Join callout */}
      <div className={styles.contactCard}>
        <h3 className={styles.contactCardTitle}>Join the Community</h3>
        <p className={styles.contactCardText}>
          Whether you’re a first-year student looking to make friends, a club leader building a community, a hackathon participant searching for teammates, or someone simply looking to meet people with similar interests, Meetifyy is here to help.
        </p>
        <p className={styles.contactCardText} style={{ fontWeight: 600, color: '#ffffff' }}>
          Because college isn’t just about earning a degree. It’s about finding your people.
        </p>
      </div>
    </StaticDocLayout>
  );
}
