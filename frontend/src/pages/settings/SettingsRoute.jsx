import { useState, useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { showToast } from '../../utils/toast';
import { useSmartBack } from '../../hooks/useSmartBack';
import styles from './SettingsRoute.module.css';

function ChevronRight() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}

function CustomSelect({ value, onChange, options, disabled }) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef(null);

  useEffect(() => {
    const handleOutsideClick = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, []);

  const selectedOption = options.find(o => o.value === value) || options[0];

  return (
    <div className={`${styles.customSelectContainer} ${disabled ? styles.disabledSelect : ''}`} ref={containerRef}>
      <button 
        type="button"
        className={styles.selectButton} 
        onClick={() => !disabled && setIsOpen(!isOpen)}
        disabled={disabled}
      >
        <span className={styles.selectValue}>{selectedOption?.label}</span>
        <svg 
          width="16" 
          height="16" 
          viewBox="0 0 24 24" 
          fill="none" 
          stroke="currentColor" 
          strokeWidth="2.5" 
          strokeLinecap="round" 
          strokeLinejoin="round"
          className={`${styles.selectChevron} ${isOpen ? styles.selectChevronOpen : ''}`}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {isOpen && (
        <div className={styles.selectDropdown}>
          {options.map((opt) => (
            <button
              key={opt.value}
              type="button"
              className={`${styles.selectOption} ${opt.value === value ? styles.selectOptionActive : ''}`}
              onClick={() => {
                onChange(opt.value);
                setIsOpen(false);
              }}
            >
              {opt.label}
              {opt.value === value && (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--color-primary)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function SettingsRoute() {
  const { currentUser, updateProfile } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const goBack = useSmartBack();

  const [activePanel, setActivePanel] = useState(location.state?.panel || null); // null = main list

  // Account state
  const [displayName, setDisplayName] = useState(currentUser?.displayName || '');
  const [email, setEmail] = useState(currentUser?.email || '');
  const [bio, setBio] = useState(currentUser?.bio || '');

  // Social Links state
  const [socialLinks, setSocialLinks] = useState({
    instagram: currentUser?.socialLinks?.instagram || '',
    facebook: currentUser?.socialLinks?.facebook || '',
    linkedin: currentUser?.socialLinks?.linkedin || '',
    twitter: currentUser?.socialLinks?.twitter || '',
  });
  const [socialErrors, setSocialErrors] = useState({});

  // Privacy & notifications state — initialized from user object
  const [emailNotifs, setEmailNotifs] = useState(currentUser?.preferences?.emailNotifs ?? true);
  const [pushNotifs, setPushNotifs] = useState(currentUser?.preferences?.pushNotifs ?? false);
  const [privateProfile, setPrivateProfile] = useState(currentUser?.preferences?.privateProfile ?? false);

  // Presence settings
  const [showOnlineStatus, setShowOnlineStatus] = useState(currentUser?.preferences?.showOnlineStatus ?? true);
  const [showLastSeen, setShowLastSeen] = useState(currentUser?.preferences?.showLastSeen ?? true);
  const [whoCanSeeOnline, setWhoCanSeeOnline] = useState(currentUser?.preferences?.whoCanSeeOnline || 'everyone');
  const [whoCanSeeLastSeen, setWhoCanSeeLastSeen] = useState(currentUser?.preferences?.whoCanSeeLastSeen || 'everyone');
  const [readReceipts, setReadReceipts] = useState(currentUser?.preferences?.readReceipts ?? true);
  const validateSocialLinks = () => {
    const errors = {};
    if (socialLinks.instagram && !socialLinks.instagram.includes('instagram.com/')) {
      errors.instagram = 'Must be a valid Instagram URL';
    }
    if (socialLinks.facebook && !socialLinks.facebook.includes('facebook.com/')) {
      errors.facebook = 'Must be a valid Facebook URL';
    }
    if (socialLinks.linkedin && !socialLinks.linkedin.includes('linkedin.com/')) {
      errors.linkedin = 'Must be a valid LinkedIn URL';
    }
    if (socialLinks.twitter && !socialLinks.twitter.includes('twitter.com/') && !socialLinks.twitter.includes('x.com/')) {
      errors.twitter = 'Must be a valid Twitter/X URL';
    }
    setSocialErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSave = () => {
    if (activePanel === 'account') {
      updateProfile({ displayName, email, bio });
      showToast('Saved');
    } else if (activePanel === 'social') {
      if (!validateSocialLinks()) {
        showToast('Please fix the errors before saving');
        return;
      }
      updateProfile({ socialLinks });
      showToast('Saved');
    } else if (activePanel === 'privacy') {
      // Persist preferences to the user object so they survive refresh
      updateProfile({
        preferences: {
          ...(currentUser?.preferences || {}),
          emailNotifs,
          pushNotifs,
          privateProfile,
          showOnlineStatus,
          showLastSeen,
          whoCanSeeOnline,
          whoCanSeeLastSeen,
          readReceipts,
        }
      });
      showToast('Saved');
    } else {
      showToast('Saved');
    }
  };

  const panelTitle = {
    account: 'Account Details',
    social: 'Social Links',
    privacy: 'Privacy & Notifications',
  };

  return (
    <div className={styles.page}>
      {/* ── Sticky header ── */}
      <header className={styles.topBar}>
        <button
          className={styles.backBtn}
          aria-label="Go back"
          onClick={() => {
            if (activePanel) setActivePanel(null);
            else goBack('/home');
          }}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="19" y1="12" x2="5" y2="12" />
            <polyline points="12 19 5 12 12 5" />
          </svg>
        </button>

        <span className={styles.topBarTitle}>
          {activePanel ? panelTitle[activePanel] : 'Settings'}
        </span>

        {/* Spacer to keep title centred */}
        <div style={{ width: 44 }} />
      </header>

      {/* ── Main list ── */}
      {!activePanel && (
        <div className={`${styles.body} animate-in`}>

          {/* Account section */}
          <div className={styles.sectionLabel}>Account</div>
          <div className={styles.group}>
            <button className={styles.row} onClick={() => setActivePanel('account')}>
              <span className={styles.rowIcon}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" />
                </svg>
              </span>
              <span className={styles.rowLabel}>Account Details</span>
              <span className={styles.rowChev}><ChevronRight /></span>
            </button>
            <div className={styles.divider} />
            <button className={styles.row} onClick={() => setActivePanel('social')}>
              <span className={styles.rowIcon}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path>
                </svg>
              </span>
              <span className={styles.rowLabel}>Social Links</span>
              <span className={styles.rowChev}><ChevronRight /></span>
            </button>
            <div className={styles.divider} />
            <button className={styles.row} onClick={() => setActivePanel('privacy')}>
              <span className={styles.rowIcon}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" />
                </svg>
              </span>
              <span className={styles.rowLabel}>Privacy &amp; Notifications</span>
              <span className={styles.rowChev}><ChevronRight /></span>
            </button>
          </div>

          {/* More section */}
          <div className={styles.sectionLabel}>More</div>
          <div className={styles.group}>
            <button className={styles.row} onClick={() => showToast('Help centre coming soon')}>
              <span className={styles.rowIcon}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10" /><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" /><line x1="12" y1="17" x2="12.01" y2="17" />
                </svg>
              </span>
              <span className={styles.rowLabel}>Help &amp; Support</span>
              <span className={styles.rowChev}><ChevronRight /></span>
            </button>
            <div className={styles.divider} />
            <button className={`${styles.row} ${styles.rowDanger}`} onClick={() => showToast('Log out coming soon')}>
              <span className={styles.rowIcon}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" />
                </svg>
              </span>
              <span className={styles.rowLabel}>Log Out</span>
            </button>
          </div>

          <p className={styles.version}>Meetify · v1.0.0</p>
        </div>
      )}

      {/* ── Account Details panel ── */}
      {activePanel === 'account' && (
        <div className={`${styles.body} animate-in`}>
          <div className={styles.group}>
            <div className={styles.inputRow}>
              <label className={styles.inputLabel}>Display Name</label>
              <input
                className={styles.input}
                type="text"
                value={displayName}
                onChange={e => setDisplayName(e.target.value)}
              />
            </div>
            <div className={styles.divider} />
            <div className={styles.inputRow}>
              <label className={styles.inputLabel}>Username</label>
              <input
                className={styles.input}
                type="text"
                defaultValue={currentUser?.username}
                disabled
              />
            </div>
            <div className={styles.divider} />
            <div className={styles.inputRow}>
              <label className={styles.inputLabel}>Email</label>
              <input
                className={styles.input}
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
              />
            </div>
            <div className={styles.divider} />
            <div className={styles.inputRow}>
              <label className={styles.inputLabel}>Bio</label>
              <input
                className={styles.input}
                type="text"
                value={bio}
                onChange={e => setBio(e.target.value)}
              />
            </div>
          </div>
          <button className={styles.saveBtn} onClick={handleSave}>Save Changes</button>
        </div>
      )}

      {/* ── Social Links panel ── */}
      {activePanel === 'social' && (
        <div className={`${styles.body} animate-in`}>
          <div className={styles.group}>
            {['instagram', 'facebook', 'linkedin', 'twitter'].map((platform, idx) => (
              <div key={platform}>
                {idx > 0 && <div className={styles.divider} />}
                <div className={styles.inputRow}>
                  <label className={styles.inputLabel} style={{ textTransform: 'capitalize' }}>{platform}</label>
                  <input
                    className={styles.input}
                    type="text"
                    placeholder={`https://${platform === 'twitter' ? 'x' : platform}.com/yourprofile`}
                    value={socialLinks[platform]}
                    onChange={e => {
                      setSocialLinks(prev => ({ ...prev, [platform]: e.target.value }));
                      if (socialErrors[platform]) setSocialErrors(prev => ({ ...prev, [platform]: null }));
                    }}
                  />
                  {socialErrors[platform] && <div style={{ color: 'var(--color-danger)', fontSize: '0.75rem', marginTop: '4px' }}>{socialErrors[platform]}</div>}
                </div>
              </div>
            ))}
          </div>
          <button className={styles.saveBtn} onClick={handleSave}>Save Links</button>
        </div>
      )}

      {/* ── Privacy & Notifications panel ── */}
      {activePanel === 'privacy' && (
        <div className={`${styles.body} animate-in`}>
          <div className={styles.sectionLabel}>Profile Visibility</div>
          <div className={styles.group}>
            <div className={styles.toggleRow}>
              <div className={styles.toggleInfo}>
                <span className={styles.rowLabel}>Private Profile</span>
                <span className={styles.toggleDesc}>Only approved followers see your posts</span>
              </div>
              <label className={styles.toggle}>
                <input type="checkbox" checked={privateProfile} onChange={e => setPrivateProfile(e.target.checked)} />
                <span className={styles.slider} />
              </label>
            </div>
          </div>

          <div className={styles.sectionLabel}>Online Status &amp; Presence</div>
          <div className={styles.group} style={{ overflow: 'visible' }}>
            <div className={styles.toggleRow}>
              <div className={styles.toggleInfo}>
                <span className={styles.rowLabel}>Show Online Status</span>
                <span className={styles.toggleDesc}>Allow other users to see when you're online.</span>
              </div>
              <label className={styles.toggle}>
                <input type="checkbox" checked={showOnlineStatus} onChange={e => setShowOnlineStatus(e.target.checked)} />
                <span className={styles.slider} />
              </label>
            </div>
            
            <div className={styles.divider} style={{ marginLeft: 16 }} />

            <div className={`${styles.selectRow} ${!showOnlineStatus ? styles.disabledRow : ''}`}>
              <div className={styles.toggleInfo}>
                <span className={styles.rowLabel}>Who Can See My Online Status</span>
                <span className={styles.toggleDesc}>Manage visibility rules for your online state</span>
              </div>
              <CustomSelect 
                value={whoCanSeeOnline}
                onChange={setWhoCanSeeOnline}
                options={[
                  { value: 'everyone', label: 'Everyone' },
                  { value: 'following', label: 'People I Follow' },
                  { value: 'mutual', label: 'Mutual Connections' },
                  { value: 'nobody', label: 'Nobody' }
                ]}
                disabled={!showOnlineStatus}
              />
            </div>

            <div className={styles.divider} style={{ marginLeft: 16 }} />

            <div className={styles.toggleRow}>
              <div className={styles.toggleInfo}>
                <span className={styles.rowLabel}>Show Last Seen</span>
                <span className={styles.toggleDesc}>Allow others to see when you were last active.</span>
              </div>
              <label className={styles.toggle}>
                <input type="checkbox" checked={showLastSeen} onChange={e => setShowLastSeen(e.target.checked)} />
                <span className={styles.slider} />
              </label>
            </div>

            <div className={styles.divider} style={{ marginLeft: 16 }} />

            <div className={`${styles.selectRow} ${!showLastSeen ? styles.disabledRow : ''}`}>
              <div className={styles.toggleInfo}>
                <span className={styles.rowLabel}>Who Can See My Last Seen</span>
                <span className={styles.toggleDesc}>Manage visibility rules for your last active time</span>
              </div>
              <CustomSelect 
                value={whoCanSeeLastSeen}
                onChange={setWhoCanSeeLastSeen}
                options={[
                  { value: 'everyone', label: 'Everyone' },
                  { value: 'following', label: 'People I Follow' },
                  { value: 'mutual', label: 'Mutual Connections' },
                  { value: 'nobody', label: 'Nobody' }
                ]}
                disabled={!showLastSeen}
              />
            </div>

            <div className={styles.divider} style={{ marginLeft: 16 }} />

            <div className={styles.toggleRow}>
              <div className={styles.toggleInfo}>
                <span className={styles.rowLabel}>Read Receipts</span>
                <span className={styles.toggleDesc}>Allow others to know when you've read their messages.</span>
              </div>
              <label className={styles.toggle}>
                <input type="checkbox" checked={readReceipts} onChange={e => setReadReceipts(e.target.checked)} />
                <span className={styles.slider} />
              </label>
            </div>
          </div>

          <div className={styles.sectionLabel}>Notifications</div>
          <div className={styles.group}>
            <div className={styles.toggleRow}>
              <div className={styles.toggleInfo}>
                <span className={styles.rowLabel}>Email Notifications</span>
                <span className={styles.toggleDesc}>Get emails for important activity</span>
              </div>
              <label className={styles.toggle}>
                <input type="checkbox" checked={emailNotifs} onChange={e => setEmailNotifs(e.target.checked)} />
                <span className={styles.slider} />
              </label>
            </div>
            <div className={styles.divider} style={{ marginLeft: 16 }} />
            <div className={styles.toggleRow}>
              <div className={styles.toggleInfo}>
                <span className={styles.rowLabel}>Push Notifications</span>
                <span className={styles.toggleDesc}>Browser push alerts</span>
              </div>
              <label className={styles.toggle}>
                <input type="checkbox" checked={pushNotifs} onChange={e => setPushNotifs(e.target.checked)} />
                <span className={styles.slider} />
              </label>
            </div>
          </div>
          <button className={styles.saveBtn} onClick={handleSave}>Save Preferences</button>
        </div>
      )}


    </div>
  );
}
