import { useState } from 'react';
import StaticDocLayout from './StaticDocLayout';
import styles from './StaticDocLayout.module.css';
import { Mail, MessageSquare, Send, CheckCircle2, HelpCircle, Shield, Sparkles } from 'lucide-react';

export default function ContactPage() {
  const [submitted, setSubmitted] = useState(false);
  const [form, setForm] = useState({ name: '', email: '', subject: 'General Support', message: '' });

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!form.name || !form.email || !form.message) return;
    setSubmitted(true);
  };

  return (
    <StaticDocLayout
      badge="Get In Touch"
      title="Contact Us"
      subtitle="Have questions, feedback, or need help with Meetifyy? We're here for you."
    >
      <div className={styles.gridTwo}>
        {/* Contact channels card */}
        <section className={styles.card}>
          <div className={styles.cardHeader}>
            <div className={styles.iconWrapper}>
              <Mail size={22} />
            </div>
            <h2 className={styles.cardTitle}>Direct Channels</h2>
          </div>
          <p className={styles.cardText}>
            Reach out to our team directly for support, community inquiries, or partnership opportunities.
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginTop: '1.25rem' }}>
            <div className={styles.featureBox}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
                <HelpCircle size={18} color="#ea580c" />
                <h3 className={styles.featureBoxTitle}>General Support & Queries</h3>
              </div>
              <p className={styles.featureBoxText}>Questions about account, communities, or platform features.</p>
            </div>

            <div className={styles.featureBox}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
                <Shield size={18} color="#ea580c" />
                <h3 className={styles.featureBoxTitle}>Safety & Guidelines Reporting</h3>
              </div>
              <p className={styles.featureBoxText}>Report violations, harassment, or safety concerns.</p>
            </div>

            <div className={styles.featureBox}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
                <Sparkles size={18} color="#ea580c" />
                <h3 className={styles.featureBoxTitle}>Campus & Club Partnerships</h3>
              </div>
              <p className={styles.featureBoxText}>Bring Meetifyy to your campus or verify your student organization.</p>
            </div>
          </div>

          <div style={{ marginTop: '1.5rem', paddingTop: '1.25rem', borderTop: '1px solid #e7e5e4' }}>
            <p className={styles.cardText} style={{ fontWeight: 600, color: '#1c1917' }}>Primary Support Email:</p>
            <a href="mailto:meetify0@gmail.com" className={styles.emailBtn} style={{ marginTop: '0.5rem' }}>
              <Mail size={18} />
              meetify0@gmail.com
            </a>
          </div>
        </section>

        {/* Contact form card */}
        <section className={styles.card}>
          <div className={styles.cardHeader}>
            <div className={styles.iconWrapper}>
              <MessageSquare size={22} />
            </div>
            <h2 className={styles.cardTitle}>Send a Message</h2>
          </div>

          {submitted ? (
            <div style={{ padding: '2rem 1rem', textAlign: 'center' }}>
              <CheckCircle2 size={48} color="#ea580c" style={{ margin: '0 auto 1rem auto' }} />
              <h3 style={{ fontSize: '1.25rem', fontWeight: 700, color: '#0c0a09', margin: '0 0 0.5rem 0' }}>
                Message Sent!
              </h3>
              <p className={styles.cardText}>
                Thanks for reaching out! We’ll get back to you at <strong>{form.email}</strong> as soon as possible.
              </p>
              <button
                onClick={() => { setSubmitted(false); setForm({ name: '', email: '', subject: 'General Support', message: '' }); }}
                className={styles.emailBtn}
                style={{ margin: '1.25rem auto 0 auto', cursor: 'pointer', border: 'none' }}
              >
                Send Another Message
              </button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.84rem', fontWeight: 600, color: '#44403c', marginBottom: '0.35rem' }}>
                  Your Name
                </label>
                <input
                  type="text"
                  required
                  placeholder="Rahul Sharma"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  style={{
                    width: '100%',
                    padding: '0.75rem 1rem',
                    borderRadius: '10px',
                    border: '1px solid #d6d3d1',
                    fontSize: '0.9375rem',
                    outline: 'none',
                    boxSizing: 'border-box'
                  }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.84rem', fontWeight: 600, color: '#44403c', marginBottom: '0.35rem' }}>
                  Email Address
                </label>
                <input
                  type="email"
                  required
                  placeholder="student@university.edu"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  style={{
                    width: '100%',
                    padding: '0.75rem 1rem',
                    borderRadius: '10px',
                    border: '1px solid #d6d3d1',
                    fontSize: '0.9375rem',
                    outline: 'none',
                    boxSizing: 'border-box'
                  }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.84rem', fontWeight: 600, color: '#44403c', marginBottom: '0.35rem' }}>
                  Topic
                </label>
                <select
                  value={form.subject}
                  onChange={(e) => setForm({ ...form, subject: e.target.value })}
                  style={{
                    width: '100%',
                    padding: '0.75rem 1rem',
                    borderRadius: '10px',
                    border: '1px solid #d6d3d1',
                    fontSize: '0.9375rem',
                    outline: 'none',
                    background: '#ffffff',
                    boxSizing: 'border-box'
                  }}
                >
                  <option value="General Support">General Support</option>
                  <option value="Community / Event Help">Community / Event Help</option>
                  <option value="Report an Issue">Report an Issue</option>
                  <option value="Campus Leader Program">Campus Leader Program</option>
                  <option value="Other Inquiry">Other Inquiry</option>
                </select>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.84rem', fontWeight: 600, color: '#44403c', marginBottom: '0.35rem' }}>
                  Message
                </label>
                <textarea
                  required
                  rows={4}
                  placeholder="How can we help you today?"
                  value={form.message}
                  onChange={(e) => setForm({ ...form, message: e.target.value })}
                  style={{
                    width: '100%',
                    padding: '0.75rem 1rem',
                    borderRadius: '10px',
                    border: '1px solid #d6d3d1',
                    fontSize: '0.9375rem',
                    outline: 'none',
                    resize: 'vertical',
                    boxSizing: 'border-box'
                  }}
                />
              </div>

              <button
                type="submit"
                className={styles.emailBtn}
                style={{ width: '100%', justifyContent: 'center', cursor: 'pointer', border: 'none', marginTop: '0.5rem' }}
              >
                <Send size={18} />
                Send Message
              </button>
            </form>
          )}
        </section>
      </div>
    </StaticDocLayout>
  );
}
