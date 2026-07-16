import { useState, useEffect, useRef, useMemo } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '@shared/context/AuthContext';
import { showToast } from '@shared/utils/toast';
import { useSmartBack } from '@shared/hooks/useSmartBack';
import { INTERESTS_BY_CATEGORY } from '@features/onboarding/constants/interestsData';
import { MAJORS_LIST } from '@features/campus/data/majors';
import styles from './SettingsRoute.module.css';

// Build emoji lookup map
const emojiMap = {};
INTERESTS_BY_CATEGORY.forEach(category => {
  category.tags.forEach(tag => {
    emojiMap[tag.label] = tag.emoji;
  });
});

function ChevronRight() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}

function PencilIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
      <path d="M18.5 2.5a2.121 2.121 0 1 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
    </svg>
  );
}

function CustomSelect({ value, onChange, options, disabled, placeholder, searchable }) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const containerRef = useRef(null);

  useEffect(() => {
    const handleOutsideClick = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setIsOpen(false);
        setSearchQuery('');
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, []);

  const selectedOption = options.find(o => String(o.value) === String(value));

  const filteredOptions = useMemo(() => {
    if (!searchable || !searchQuery) return options;
    const query = searchQuery.toLowerCase().trim();
    return options.filter(opt => 
      String(opt.label).toLowerCase().includes(query) || 
      String(opt.value).toLowerCase().includes(query)
    );
  }, [options, searchQuery, searchable]);

  return (
    <div className={`${styles.customSelectContainer} ${disabled ? styles.disabledSelect : ''}`} ref={containerRef}>
      <button 
        type="button"
        className={styles.selectButton} 
        onClick={() => !disabled && setIsOpen(!isOpen)}
        disabled={disabled}
      >
        <span className={styles.selectValue}>
          {selectedOption ? selectedOption.label : (placeholder || 'Select...')}
        </span>
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
          {searchable && (
            <div className={styles.selectSearchContainer}>
              <input
                type="text"
                className={styles.selectSearchInput}
                placeholder="Search..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                onClick={e => e.stopPropagation()}
                autoFocus
              />
            </div>
          )}
          <div className={styles.selectDropdownOptions}>
            {filteredOptions.length > 0 ? (
              filteredOptions.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  className={`${styles.selectOption} ${String(opt.value) === String(value) ? styles.selectOptionActive : ''}`}
                  onClick={() => {
                    onChange(opt.value);
                    setIsOpen(false);
                    setSearchQuery('');
                  }}
                >
                  {opt.label}
                  {String(opt.value) === String(value) && (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--color-primary)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  )}
                </button>
              ))
            ) : (
              <div className={styles.noResults}>No results found</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function SettingsRoute() {
  const { currentUser, updateProfile, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const goBack = useSmartBack();

  const [activePanel, setActivePanel] = useState(location.state?.panel || null); // null = main list

  // Account state
  const [displayName, setDisplayName] = useState(currentUser?.displayName || '');
  const [email, setEmail] = useState(currentUser?.email || '');
  const [bio, setBio] = useState(currentUser?.bio || '');
  const [birthday, setBirthday] = useState(currentUser?.birthday || '');
  const [university] = useState(currentUser?.university || 'GLA University'); // Read-only
  const [course, setCourse] = useState(currentUser?.course || currentUser?.branch || '');
  const [year, setYear] = useState(currentUser?.year || '');

  // Interests state
  const [selectedInterests, setSelectedInterests] = useState(currentUser?.interests || []);

  // Social Links state
  const [socialLinks, setSocialLinks] = useState({
    instagram: currentUser?.socialLinks?.instagram || '',
    facebook: currentUser?.socialLinks?.facebook || '',
    linkedin: currentUser?.socialLinks?.linkedin || '',
    twitter: currentUser?.socialLinks?.twitter || '',
  });
  const [socialErrors, setSocialErrors] = useState({});

  // Privacy & notifications state
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
      updateProfile({ 
        displayName, 
        email, 
        bio, 
        birthday, 
        course, 
        branch: course, 
        year 
      });
      showToast('Saved');
    } else if (activePanel === 'social') {
      if (!validateSocialLinks()) {
        showToast('Please fix the errors before saving');
        return;
      }
      updateProfile({ socialLinks });
      showToast('Saved');
    } else if (activePanel === 'privacy') {
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
    } else if (activePanel === 'interests') {
      updateProfile({ interests: selectedInterests });
      showToast('Saved');
    } else {
      showToast('Saved');
    }
  };

  const toggleInterest = (id) => {
    setSelectedInterests(prev => {
      if (prev.includes(id)) {
        return prev.filter(i => i !== id);
      }
      if (prev.length >= 10) {
        showToast('Maximum 10 interests allowed');
        return prev;
      }
      return [...prev, id];
    });
  };

  const panelTitle = {
    account: 'Account Details',
    social: 'Social Links',
    privacy: 'Privacy & Notifications',
    interests: 'Interests & Topics',
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

          {/* Interests section */}
          <div className={styles.sectionLabel}>Interests</div>
          <div className={styles.group}>
            <div className={styles.interestsRow}>
              <div className={styles.interestsInfo}>
                <span className={styles.rowLabel} style={{ fontWeight: 600 }}>My Interests</span>
                {currentUser?.interests && currentUser.interests.length > 0 ? (
                  <div className={styles.selectedTagsContainer}>
                    {currentUser.interests.map(interest => {
                      const emoji = emojiMap[interest] || '✨';
                      return (
                        <span key={interest} className={styles.tagPillPreview}>
                          <span>{emoji}</span> {interest}
                        </span>
                      );
                    })}
                  </div>
                ) : (
                  <span className={styles.toggleDesc}>No interests selected. Add some topics!</span>
                )}
              </div>
              <button 
                className={styles.editInterestsBtn} 
                onClick={() => setActivePanel('interests')}
                aria-label="Edit interests"
              >
                <PencilIcon />
              </button>
            </div>
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
            <button className={`${styles.row} ${styles.rowDanger}`} onClick={logout}>
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
          <div className={styles.group} style={{ overflow: 'visible' }}>
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
            
            <div className={styles.divider} />
            <div className={styles.inputRow}>
              <label className={styles.inputLabel}>Date of Birth</label>
              <input
                className={styles.input}
                type="date"
                value={birthday}
                onChange={e => setBirthday(e.target.value)}
              />
            </div>

            <div className={styles.divider} />
            <div className={styles.inputRow}>
              <label className={styles.inputLabel}>University</label>
              <input
                className={styles.input}
                type="text"
                value={university}
                disabled
              />
            </div>

            <div className={styles.divider} />
            <div className={styles.selectRow} style={{ overflow: 'visible' }}>
              <div className={styles.toggleInfo}>
                <span className={styles.inputLabel}>Major / Course</span>
              </div>
              <CustomSelect 
                value={course}
                onChange={setCourse}
                options={MAJORS_LIST}
                placeholder="Select Major"
                searchable={true}
              />
            </div>

            <div className={styles.divider} />
            <div className={styles.selectRow} style={{ overflow: 'visible' }}>
              <div className={styles.toggleInfo}>
                <span className={styles.inputLabel}>Year of Passing</span>
              </div>
              <CustomSelect 
                value={year}
                onChange={setYear}
                options={Array.from({ length: 9 }, (_, i) => {
                  const y = String(new Date().getFullYear() - 2 + i);
                  return { value: y, label: y };
                })}
                placeholder="Select Year"
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
                  {socialErrors[platform] && <div className={styles.errorText}>{socialErrors[platform]}</div>}
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
            
            <div className={styles.nestedDivider} />

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

            <div className={styles.nestedDivider} />

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

            <div className={styles.nestedDivider} />

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

            <div className={styles.nestedDivider} />

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
            <div className={styles.nestedDivider} />
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

      {/* ── Interests panel ── */}
      {activePanel === 'interests' && (
        <div className={`${styles.body} animate-in`}>
          <div className={styles.interestsHeader}>
            <p className={styles.interestsSubheadline}>
              Select up to 10 topics to customize your experience ({selectedInterests.length}/10)
            </p>
          </div>

          <div className={styles.categoriesWrapper}>
            {INTERESTS_BY_CATEGORY.map((category, catIndex) => (
              <div key={catIndex} className={styles.categorySection}>
                <h3 className={styles.categoryTitle}>{category.title}</h3>
                <div className={styles.tagsContainer}>
                  {category.tags.map((tag, tagIndex) => {
                    const isSelected = selectedInterests.includes(tag.label);
                    return (
                      <button 
                        key={tagIndex}
                        type="button"
                        className={`${styles.optionPill} ${isSelected ? styles.selectedPill : ''}`}
                        onClick={() => toggleInterest(tag.label)}
                      >
                        <span className={styles.pillIcon}>{tag.emoji}</span>
                        <span className={styles.pillLabel}>{tag.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>

          <button className={styles.saveBtn} onClick={handleSave}>Save Interests</button>
        </div>
      )}

    </div>
  );
}
