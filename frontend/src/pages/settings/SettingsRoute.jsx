import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';
import { showToast } from '../../utils/toast';
import styles from './SettingsRoute.module.css';

export default function SettingsRoute() {
  const { currentUser, updateProfile } = useAuth();
  const { theme, setTheme } = useTheme();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('account');

  const [displayName, setDisplayName] = useState(currentUser?.displayName || '');
  const [username, setUsername] = useState(currentUser?.username || '');
  const [usernameError, setUsernameError] = useState('');
  const [email, setEmail] = useState(currentUser?.email || '');
  const [bio, setBio] = useState(currentUser?.bio || '');

  const [igLink, setIgLink] = useState(currentUser?.socialLinks?.instagram || '');
  const [liLink, setLiLink] = useState(currentUser?.socialLinks?.linkedin || '');
  const [ghLink, setGhLink] = useState(currentUser?.socialLinks?.github || '');
  const [twLink, setTwLink] = useState(currentUser?.socialLinks?.twitter || '');
  const [webLink, setWebLink] = useState(currentUser?.socialLinks?.website || '');

  const [emailNotifs, setEmailNotifs] = useState(true);
  const [pushNotifs, setPushNotifs] = useState(false);
  const [privateProfile, setPrivateProfile] = useState(false);

  const validateUsername = (val) => {
    if (!val.trim()) return 'Username cannot be empty.';
    if (!/^[a-z0-9_]+$/.test(val)) return 'Only lowercase letters, numbers, and underscores allowed.';
    if (val.length < 3) return 'Username must be at least 3 characters.';
    if (val.length > 30) return 'Username must be 30 characters or less.';
    return '';
  };

  const handleUsernameChange = (val) => {
    const clean = val.toLowerCase().replace(/\s/g, '');
    setUsername(clean);
    setUsernameError(validateUsername(clean));
  };

  const handleSave = () => {
    if (activeTab === 'account') {
      const err = validateUsername(username);
      if (err) {
        setUsernameError(err);
        showToast('Please fix the username before saving.');
        return;
      }
      updateProfile({
        displayName,
        username,
        email,
        bio,
        socialLinks: {
          instagram: igLink.trim() || undefined,
          linkedin: liLink.trim() || undefined,
          github: ghLink.trim() || undefined,
          twitter: twLink.trim() || undefined,
          website: webLink.trim() || undefined,
        },
      });
    }
    showToast('Settings saved successfully');
  };

  const themeOptions = [
    {
      id: 'light', label: 'Light', desc: 'Always light',
      icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>,
    },
    {
      id: 'dark', label: 'Dark', desc: 'Always dark',
      icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>,
    },
    {
      id: 'system', label: 'System', desc: 'Follows your OS setting',
      icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>,
    },
  ];

  const socialFields = [
    {
      label: 'Instagram', val: igLink, set: setIgLink,
      placeholder: 'https://instagram.com/yourhandle',
      icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="2" width="20" height="20" rx="5" ry="5"/><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"/><line x1="17.5" y1="6.5" x2="17.51" y2="6.5"/></svg>,
    },
    {
      label: 'LinkedIn', val: liLink, set: setLiLink,
      placeholder: 'https://linkedin.com/in/yourprofile',
      icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-2-2 2 2 0 0 0-2 2v7h-4v-7a6 6 0 0 1 6-6z"/><rect x="2" y="9" width="4" height="12"/><circle cx="4" cy="4" r="2"/></svg>,
    },
    {
      label: 'GitHub', val: ghLink, set: setGhLink,
      placeholder: 'https://github.com/yourusername',
      icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"/></svg>,
    },
    {
      label: 'Twitter / X', val: twLink, set: setTwLink,
      placeholder: 'https://x.com/yourhandle',
      icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>,
    },
    {
      label: 'Website', val: webLink, set: setWebLink,
      placeholder: 'https://yourwebsite.com',
      icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>,
    },
  ];

  return (
    <main className="centre centre-wide animate-in">
      <div className={styles.settingsContainer}>

        {/* ── Sidebar ── */}
        <aside className={styles.sidebar}>

          {/* Back button — visible across all three tabs */}
          <button className={styles.backBtn} onClick={() => navigate(-1)}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
            Back
          </button>

          <div className={styles.sidebarDivider} />

          <button
            className={`${styles.navBtn} ${activeTab === 'account' ? styles.active : ''}`}
            onClick={() => setActiveTab('account')}
          >
            Account Details
          </button>
          <button
            className={`${styles.navBtn} ${activeTab === 'privacy' ? styles.active : ''}`}
            onClick={() => setActiveTab('privacy')}
          >
            Privacy &amp; Notifications
          </button>
          <button
            className={`${styles.navBtn} ${activeTab === 'appearance' ? styles.active : ''}`}
            onClick={() => setActiveTab('appearance')}
          >
            Appearance
          </button>
        </aside>

        {/* ── Content ── */}
        <section className={styles.content}>

          {/* Account Details */}
          {activeTab === 'account' && (
            <div className="animate-in">
              <h2 className={styles.sectionTitle}>Account Details</h2>
              <div className={styles.settingGroup}>

                <div className={styles.inputGroup}>
                  <label>Display Name</label>
                  <input type="text" value={displayName} onChange={e => setDisplayName(e.target.value)} />
                </div>

                <div className={styles.inputGroup}>
                  <label>Username</label>
                  <div style={{ position: 'relative' }}>
                    <span style={{
                      position: 'absolute', left: '0.85rem', top: '50%', transform: 'translateY(-50%)',
                      color: 'var(--color-text-light)', fontWeight: 500, fontSize: '0.9rem', pointerEvents: 'none',
                    }}>@</span>
                    <input
                      type="text"
                      value={username}
                      onChange={e => handleUsernameChange(e.target.value)}
                      style={{
                        paddingLeft: '1.85rem',
                        borderColor: usernameError ? 'var(--color-danger)' : undefined,
                        boxShadow: usernameError ? '0 0 0 3px rgba(239,68,68,0.12)' : undefined,
                      }}
                      autoComplete="off"
                      spellCheck={false}
                    />
                  </div>
                  {usernameError ? (
                    <span style={{ fontSize: '0.78rem', color: 'var(--color-danger)', marginTop: '0.15rem' }}>
                      {usernameError}
                    </span>
                  ) : username !== currentUser?.username ? (
                    <span style={{ fontSize: '0.78rem', color: 'var(--color-success)', marginTop: '0.15rem' }}>
                      ✓ Username available
                    </span>
                  ) : (
                    <span style={{ fontSize: '0.78rem', color: 'var(--color-text-light)', marginTop: '0.15rem' }}>
                      Lowercase letters, numbers, and underscores only.
                    </span>
                  )}
                </div>

                <div className={styles.inputGroup}>
                  <label>Email Address</label>
                  <input type="email" value={email} onChange={e => setEmail(e.target.value)} />
                </div>

                <div className={styles.inputGroup}>
                  <label>Bio</label>
                  <input type="text" value={bio} onChange={e => setBio(e.target.value)} />
                </div>

                {/* Social Links */}
                <div className={styles.inputGroup}>
                  <label style={{ fontWeight: 700, fontSize: '0.82rem', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--color-text-light)' }}>
                    Social Links
                  </label>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginTop: '0.25rem' }}>
                    {socialFields.map(({ label, val, set, placeholder, icon }) => (
                      <div key={label} style={{ position: 'relative' }}>
                        <span style={{
                          position: 'absolute', left: '0.75rem', top: '50%', transform: 'translateY(-50%)',
                          color: 'var(--color-text-light)', display: 'flex', alignItems: 'center', pointerEvents: 'none',
                        }}>{icon}</span>
                        <input
                          type="url"
                          value={val}
                          onChange={e => set(e.target.value)}
                          placeholder={placeholder}
                          aria-label={label}
                          style={{ paddingLeft: '2.4rem', width: '100%' }}
                        />
                      </div>
                    ))}
                  </div>
                </div>

                <button className={styles.saveBtn} onClick={handleSave}>Save Changes</button>
              </div>
            </div>
          )}

          {/* Privacy & Notifications */}
          {activeTab === 'privacy' && (
            <div className="animate-in">
              <h2 className={styles.sectionTitle}>Privacy &amp; Notifications</h2>
              <div className={styles.settingGroup}>
                <div className={styles.settingItem}>
                  <div className={styles.settingInfo}>
                    <span className={styles.settingLabel}>Private Profile</span>
                    <span className={styles.settingDesc}>Only approved followers can see your posts.</span>
                  </div>
                  <label className={styles.toggle}>
                    <input type="checkbox" checked={privateProfile} onChange={e => setPrivateProfile(e.target.checked)} />
                    <span className={styles.slider}></span>
                  </label>
                </div>
                <div className={styles.settingItem}>
                  <div className={styles.settingInfo}>
                    <span className={styles.settingLabel}>Email Notifications</span>
                    <span className={styles.settingDesc}>Receive emails for important activity.</span>
                  </div>
                  <label className={styles.toggle}>
                    <input type="checkbox" checked={emailNotifs} onChange={e => setEmailNotifs(e.target.checked)} />
                    <span className={styles.slider}></span>
                  </label>
                </div>
                <div className={styles.settingItem}>
                  <div className={styles.settingInfo}>
                    <span className={styles.settingLabel}>Push Notifications</span>
                    <span className={styles.settingDesc}>Receive browser push notifications.</span>
                  </div>
                  <label className={styles.toggle}>
                    <input type="checkbox" checked={pushNotifs} onChange={e => setPushNotifs(e.target.checked)} />
                    <span className={styles.slider}></span>
                  </label>
                </div>
                <button className={styles.saveBtn} onClick={handleSave}>Save Preferences</button>
              </div>
            </div>
          )}

          {/* Appearance */}
          {activeTab === 'appearance' && (
            <div className="animate-in">
              <h2 className={styles.sectionTitle}>Appearance</h2>
              <div className={styles.settingGroup}>
                <div className={styles.themeSection}>
                  <span className={styles.settingLabel}>Color Theme</span>
                  <span className={styles.settingDesc} style={{ marginBottom: '1rem', display: 'block' }}>
                    Choose how Meetify looks for you.
                  </span>
                  <div className={styles.themeCards}>
                    {themeOptions.map(opt => (
                      <button
                        key={opt.id}
                        className={`${styles.themeCard} ${theme === opt.id ? styles.themeCardActive : ''}`}
                        onClick={() => { setTheme(opt.id); showToast(`Switched to ${opt.label} mode`); }}
                      >
                        <span className={styles.themeCardIcon}>{opt.icon}</span>
                        <span className={styles.themeCardLabel}>{opt.label}</span>
                        <span className={styles.themeCardDesc}>{opt.desc}</span>
                        {theme === opt.id && (
                          <span className={styles.themeCardCheck}>
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                              <polyline points="20 6 9 17 4 12"/>
                            </svg>
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

        </section>
      </div>
    </main>
  );
}
