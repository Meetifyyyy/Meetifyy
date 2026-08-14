import { useState } from 'react';
import StaticDocLayout from './StaticDocLayout';
import styles from './StaticDocLayout.module.css';
import { Mail, Send, CheckCircle2 } from 'lucide-react';

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
      subtitle="Have inquiries, feedback, or require assistance with Meetifyy? Our team is available to help."
      noHeroCard
      leftAlign
    >
      <section className={styles.cleanSection}>
        <h2 className={styles.cleanSectionTitle}>Direct Channels</h2>
        <p className={styles.hierarchyParagraph} style={{ marginTop: '0.5rem' }}>
          Reach out to our dedicated teams directly for support, compliance inquiries, or institutional partnership opportunities.
        </p>

        <div style={{ marginTop: '1.25rem', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          <div>
            <h3 className={styles.cleanSectionSubTitle}>General Support & Inquiries</h3>
            <p className={styles.hierarchyParagraph}>Assistance with account management, communities, or platform features.</p>
          </div>

          <div>
            <h3 className={styles.cleanSectionSubTitle}>Trust, Safety & Compliance</h3>
            <p className={styles.hierarchyParagraph}>Report policy violations, harassment, or escalate safety concerns.</p>
          </div>

          <div>
            <h3 className={styles.cleanSectionSubTitle}>Institutional Partnerships</h3>
            <p className={styles.hierarchyParagraph}>Collaborate with Meetifyy for campus integration or official student organization verification.</p>
          </div>
        </div>

        <div style={{ marginTop: '1.5rem', paddingTop: '1rem', borderTop: '1px solid #f5f5f4' }}>
          <p className={styles.hierarchyParagraph} style={{ fontWeight: 600, color: '#1c1917' }}>Primary Support Email:</p>
          <a href="mailto:meetify0@gmail.com" className={styles.emailBtn} style={{ marginTop: '0.75rem', display: 'inline-flex' }}>
            <Mail size={18} />
            meetify0@gmail.com
          </a>
        </div>
      </section>

      <section className={styles.cleanSection} style={{ borderBottom: 'none' }}>
        <h2 className={styles.cleanSectionTitle}>Send a Message</h2>
        <p className={styles.hierarchyParagraph} style={{ marginTop: '0.5rem', marginBottom: '1.5rem' }}>
          Fill out the form below to submit a message directly to our support staff.
        </p>

        {submitted ? (
          <div style={{ padding: '1.5rem 0', textAlign: 'left' }}>
            <CheckCircle2 size={36} color="#ea580c" style={{ marginBottom: '0.75rem' }} />
            <h3 style={{ fontSize: '1.25rem', fontFamily: 'Changa One, sans-serif', color: '#0c0a09', margin: '0 0 0.5rem 0' }}>
              Message Sent
            </h3>
            <p className={styles.hierarchyParagraph}>
              Thanks for reaching out! We’ll get back to you at <strong>{form.email}</strong> as soon as possible.
            </p>
            <button
              onClick={() => { setSubmitted(false); setForm({ name: '', email: '', subject: 'General Support', message: '' }); }}
              className={styles.emailBtn}
              style={{ marginTop: '1.25rem', cursor: 'pointer', border: 'none' }}
            >
              Send Another Message
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', maxWidth: '36rem' }}>
            <div>
              <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 600, color: '#374151', marginBottom: '0.35rem', fontFamily: 'Inter, sans-serif' }}>
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
                  boxSizing: 'border-box',
                  fontFamily: 'Inter, sans-serif'
                }}
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 600, color: '#374151', marginBottom: '0.35rem', fontFamily: 'Inter, sans-serif' }}>
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
                  boxSizing: 'border-box',
                  fontFamily: 'Inter, sans-serif'
                }}
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 600, color: '#374151', marginBottom: '0.35rem', fontFamily: 'Inter, sans-serif' }}>
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
                  boxSizing: 'border-box',
                  fontFamily: 'Inter, sans-serif'
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
              <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 600, color: '#374151', marginBottom: '0.35rem', fontFamily: 'Inter, sans-serif' }}>
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
                  boxSizing: 'border-box',
                  fontFamily: 'Inter, sans-serif'
                }}
              />
            </div>

            <button
              type="submit"
              className={styles.emailBtn}
              style={{ width: 'fit-content', cursor: 'pointer', border: 'none', marginTop: '0.5rem' }}
            >
              <Send size={18} />
              Send Message
            </button>
          </form>
        )}
      </section>
    </StaticDocLayout>
  );
}
