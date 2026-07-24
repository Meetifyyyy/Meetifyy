import { useState, useEffect, useRef, useMemo } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '@shared/context/AuthContext';
import { showToast } from '@shared/utils/toast';
import { apiClient } from '@shared/api/apiClient';
import { useSmartBack } from '@shared/hooks/useSmartBack';
import { INTERESTS_BY_CATEGORY } from '@features/onboarding/constants/interestsData';
import { MAJORS_LIST } from '@features/campus/data/majors';
import { Pencil, Lock, Eye, EyeOff, AlertCircle, Trash2 } from 'lucide-react';
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
  const { currentUser, updateProfile, updateSettings, changePassword, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const goBack = useSmartBack();

  const [activePanel, setActivePanel] = useState(location.state?.panel || null); // null = main list

  // Account & Profile state
  const [displayName, setDisplayName] = useState(currentUser?.displayName || '');
  const [bio, setBio] = useState(currentUser?.bio || '');
  const [birthday, setBirthday] = useState(currentUser?.birthday || '');
  const [course, setCourse] = useState(currentUser?.major || '');
  const [year, setYear] = useState(currentUser?.graduationYear ? String(currentUser.graduationYear) : '');

  // Interests state
  const [selectedInterests, setSelectedInterests] = useState(currentUser?.interests || []);

  // Security state
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [passwordErrors, setPasswordErrors] = useState({});

  // Privacy & notifications state
  const settingsObj = currentUser?.settings || currentUser?.preferences || {};
  const [emailNotifs, setEmailNotifs] = useState(settingsObj.emailNotifs ?? true);
  const [pushNotifs, setPushNotifs] = useState(settingsObj.pushNotifs ?? false);
  const [privateProfile, setPrivateProfile] = useState(settingsObj.privateProfile ?? false);

  // Presence settings
  const [showOnlineStatus, setShowOnlineStatus] = useState(settingsObj.showOnlineStatus ?? true);
  const [showLastSeen, setShowLastSeen] = useState(settingsObj.showLastSeen ?? true);
  const [whoCanSeeOnline, setWhoCanSeeOnline] = useState(settingsObj.whoCanSeeOnline || 'everyone');
  const [whoCanSeeLastSeen, setWhoCanSeeLastSeen] = useState(settingsObj.whoCanSeeLastSeen || 'everyone');
  const [readReceipts, setReadReceipts] = useState(settingsObj.readReceipts ?? true);




  // Delete account state
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  // Help & Support drawer
  const [showHelpDrawer, setShowHelpDrawer] = useState(false);
  const [openFaq, setOpenFaq] = useState(null);

  useEffect(() => {
    let active = true;
    const loadFreshData = async () => {
      try {
        const [syncRes, settingsRes] = await Promise.all([
          apiClient.post('/api/auth/sync').catch(() => null),
          apiClient.get('/api/users/me/settings').catch(() => null)
        ]);
        const user = syncRes?.user || syncRes;
        if (active) {
          if (user) {
            setDisplayName(user.displayName || '');
            setBio(user.bio || '');
            setBirthday(user.birthday || '');
            setCourse(user.major || '');
            setYear(user.graduationYear ? String(user.graduationYear) : '');
            setSelectedInterests(user.interests || []);
          }
          const s = settingsRes || user?.settings || user?.preferences;
          if (s) {
            setEmailNotifs(s.emailNotifs ?? true);
            setPushNotifs(s.pushNotifs ?? false);
            setPrivateProfile(s.privateProfile ?? false);
            setShowOnlineStatus(s.showOnlineStatus ?? true);
            setShowLastSeen(s.showLastSeen ?? true);
            setWhoCanSeeOnline(s.whoCanSeeOnline || 'everyone');
            setWhoCanSeeLastSeen(s.whoCanSeeLastSeen || 'everyone');
            setReadReceipts(s.readReceipts ?? true);
          }
        }
      } catch (err) {
        console.error('Failed to load fresh settings data:', err);
      }
    };
    loadFreshData();
    return () => { active = false; };
  }, []);

  const handleSave = async () => {
    if (activePanel === 'profile') {
      await updateProfile({ 
        displayName, 
        bio, 
        birthday 
      });
      showToast('Profile details updated');
    } else if (activePanel === 'academic') {
      await updateProfile({ 
        major: course, 
        graduationYear: year ? parseInt(year, 10) : null 
      });
      showToast('Academic details updated');
    } else if (activePanel === 'security') {
      const errors = {};
      if (!currentPassword) {
        errors.current = 'Current password is required';
      }
      if (!newPassword) {
        errors.new = 'New password is required';
      } else if (newPassword.length < 8) {
        errors.new = 'Password must be at least 8 characters';
      }
      if (confirmPassword !== newPassword) {
        errors.confirm = 'Passwords do not match';
      }

      if (Object.keys(errors).length > 0) {
        setPasswordErrors(errors);
        return;
      }

      try {
        await changePassword(currentPassword, newPassword);
        setCurrentPassword('');
        setNewPassword('');
        setConfirmPassword('');
        setPasswordErrors({});
        showToast('Password changed successfully');
      } catch (err) {
        if (err.message.includes('Incorrect')) {
          setPasswordErrors({ current: err.message });
        } else {
          showToast(err.message || 'Failed to change password');
        }
      }
    } else if (activePanel === 'privacy') {
      await updateSettings({
        privateProfile,
        showOnlineStatus,
        showLastSeen,
        whoCanSeeOnline,
        whoCanSeeLastSeen,
        readReceipts,
      });
      showToast('Privacy settings saved');
    } else if (activePanel === 'notifications') {
      await updateSettings({
        emailNotifs,
        pushNotifs,
      });
      showToast('Notification preferences saved');
    } else if (activePanel === 'interests') {
      updateProfile({ interests: selectedInterests });
      showToast('Interests saved');
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

  const toggleVisibility = (inputId, showSetter) => {
    const input = document.getElementById(inputId);
    if (input) {
      const start = input.selectionStart;
      const end = input.selectionEnd;
      showSetter(prev => !prev);
      setTimeout(() => {
        input.setSelectionRange(start, end);
        input.focus();
      }, 0);
    } else {
      showSetter(prev => !prev);
    }
  };

  const panelTitle = {
    profile: 'Edit Profile',
    academic: 'Academic Info',
    security: 'Change Password',
    privacy: 'Privacy Settings',
    notifications: 'Notifications',
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

          {/* Profile & Academic section */}
          <div className={styles.sectionLabel}>Profile &amp; Academic</div>
          <div className={styles.group}>
            <button className={styles.row} onClick={() => setActivePanel('profile')}>
              <span className={styles.rowIcon}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" />
                </svg>
              </span>
              <span className={styles.rowLabel}>Edit Profile</span>
              <span className={styles.rowChev}><ChevronRight /></span>
            </button>
            <div className={styles.divider} />
            <button className={styles.row} onClick={() => setActivePanel('academic')}>
              <span className={styles.rowIcon}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M22 10v6M2 10l10-5 10 5-10 5z"/><path d="M6 12v5c0 2 2 3 6 3s6-1 6-3v-5"/>
                </svg>
              </span>
              <span className={styles.rowLabel}>Academic Info</span>
              <span className={styles.rowChev}><ChevronRight /></span>
            </button>
          </div>

          {/* Security section */}
          <div className={styles.sectionLabel}>Security</div>
          <div className={styles.group}>
            <button className={styles.row} onClick={() => setActivePanel('security')}>
              <span className={styles.rowIcon}>
                <Lock width="20" height="20" />
              </span>
              <span className={styles.rowLabel}>Change Password</span>
              <span className={styles.rowChev}><ChevronRight /></span>
            </button>
          </div>

          {/* Preferences section */}
          <div className={styles.sectionLabel}>Preferences</div>
          <div className={styles.group}>
            <button className={styles.row} onClick={() => setActivePanel('privacy')}>
              <span className={styles.rowIcon}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" />
                </svg>
              </span>
              <span className={styles.rowLabel}>Privacy Settings</span>
              <span className={styles.rowChev}><ChevronRight /></span>
            </button>
            <div className={styles.divider} />
            <button className={styles.row} onClick={() => setActivePanel('notifications')}>
              <span className={styles.rowIcon}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path><path d="M13.73 21a2 2 0 0 1-3.46 0"></path>
                </svg>
              </span>
              <span className={styles.rowLabel}>Notifications</span>
              <span className={styles.rowChev}><ChevronRight /></span>
            </button>
          </div>

          {/* Interests section */}
          <div className={styles.sectionHeader}>
            <div className={styles.sectionLabel} style={{ padding: 0 }}>Interests</div>
            <button 
              className={styles.editInterestsHeaderBtn} 
              onClick={() => setActivePanel('interests')}
              aria-label="Edit interests"
            >
              <Pencil size={18} strokeWidth={2.2} />
            </button>
          </div>
          <div className={styles.group}>
            <div className={styles.interestsRow}>
              <div className={styles.interestsInfo}>
                {currentUser?.interests && currentUser.interests.length > 0 ? (
                  <div className={styles.selectedTagsContainer}>
                    {[
                      currentUser.interests.filter((_, i) => i % 2 === 0),
                      currentUser.interests.filter((_, i) => i % 2 !== 0)
                    ].map((rowTags, rowIndex) => (
                      <div key={rowIndex} className={styles.tagsRow}>
                        {rowTags.map(interest => {
                          const emoji = emojiMap[interest] || '✨';
                          return (
                            <span key={interest} className={styles.tagPillPreview}>
                              <span>{emoji}</span> {interest}
                            </span>
                          );
                        })}
                      </div>
                    ))}
                  </div>
                ) : (
                  <span className={styles.toggleDesc}>No interests selected. Add some topics!</span>
                )}
              </div>
            </div>
          </div>

          {/* More section */}
          <div className={styles.sectionLabel}>More</div>
          <div className={styles.group}>
            <button className={styles.row} onClick={() => setShowHelpDrawer(true)}>
              <span className={styles.rowIcon}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10" /><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" /><line x1="12" y1="17" x2="12.01" y2="17" />
                </svg>
              </span>
              <span className={styles.rowLabel}>Help &amp; Support</span>
              <span className={styles.rowChev}><ChevronRight /></span>
            </button>
            <div className={styles.divider} />
            <button className={`${styles.row} ${styles.rowDanger}`} onClick={() => setShowDeleteConfirm(true)}>
              <span className={styles.rowIcon}>
                <Trash2 width="20" height="20" />
              </span>
              <span className={styles.rowLabel}>Delete Account</span>
            </button>
            <div className={styles.divider} />
            <button className={styles.row} onClick={logout}>
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

      {/* ── Edit Profile panel ── */}
      {activePanel === 'profile' && (
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
                value={currentUser?.username}
                disabled
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
          </div>
          <button className={styles.saveBtn} onClick={handleSave}>Save Changes</button>
        </div>
      )}

      {/* ── Academic Info panel ── */}
      {activePanel === 'academic' && (
        <div className={`${styles.body} animate-in`}>
          <div className={styles.lockedInfoCard}>
            <div className={styles.lockedCardHeader}>
              <Lock size={14} className={styles.lockedIcon} />
              <span className={styles.lockedHeaderTitle}>Verified Student Identity</span>
            </div>
            <div className={styles.lockedField}>
              <span className={styles.lockedLabel}>University</span>
              <span className={styles.lockedValue}>{currentUser?.university || 'GLA University'}</span>
            </div>
            <div className={styles.lockedFieldDivider} />
            <div className={styles.lockedField}>
              <span className={styles.lockedLabel}>College Email</span>
              <span className={styles.lockedValue}>{currentUser?.email || ''}</span>
            </div>
            <div className={styles.lockedHint}>
              Linked to your verified student login and cannot be modified.
            </div>
          </div>

          <div className={styles.group} style={{ overflow: 'visible', marginTop: '16px' }}>
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
          <button className={styles.saveBtn} onClick={handleSave}>Save Academic Info</button>
        </div>
      )}

      {/* ── Change Password panel ── */}
      {activePanel === 'security' && (
        <div className={`${styles.body} animate-in`}>
          <div className={styles.group}>
            {/* Current password */}
            <div className={styles.inputRow}>
              <label className={styles.inputLabel}>Current Password</label>
              <div className={styles.passwordInputWrapper}>
                <input
                  id="currentPasswordInput"
                  className={styles.input}
                  type={showCurrentPassword ? 'text' : 'password'}
                  value={currentPassword}
                  onChange={e => {
                    setCurrentPassword(e.target.value);
                    if (passwordErrors.current) setPasswordErrors(prev => ({ ...prev, current: null }));
                  }}
                  placeholder="••••••••"
                />
                <button
                  type="button"
                  onMouseDown={e => e.preventDefault()}
                  onClick={() => toggleVisibility('currentPasswordInput', setShowCurrentPassword)}
                  className={styles.eyeBtn}
                >
                  {showCurrentPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
              {passwordErrors.current && (
                <div className={styles.errorText}>
                  <AlertCircle size={12} /> {passwordErrors.current}
                </div>
              )}
            </div>

            <div className={styles.divider} />

            {/* New password */}
            <div className={styles.inputRow}>
              <label className={styles.inputLabel}>New Password</label>
              <div className={styles.passwordInputWrapper}>
                <input
                  id="newPasswordInput"
                  className={styles.input}
                  type={showNewPassword ? 'text' : 'password'}
                  value={newPassword}
                  onChange={e => {
                    setNewPassword(e.target.value);
                    if (passwordErrors.new) setPasswordErrors(prev => ({ ...prev, new: null }));
                  }}
                  placeholder="••••••••"
                />
                <button
                  type="button"
                  onMouseDown={e => e.preventDefault()}
                  onClick={() => toggleVisibility('newPasswordInput', setShowNewPassword)}
                  className={styles.eyeBtn}
                >
                  {showNewPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
              {passwordErrors.new && (
                <div className={styles.errorText}>
                  <AlertCircle size={12} /> {passwordErrors.new}
                </div>
              )}
            </div>

            <div className={styles.divider} />

            {/* Confirm password */}
            <div className={styles.inputRow}>
              <label className={styles.inputLabel}>Confirm New Password</label>
              <div className={styles.passwordInputWrapper}>
                <input
                  id="confirmPasswordInput"
                  className={styles.input}
                  type={showConfirmPassword ? 'text' : 'password'}
                  value={confirmPassword}
                  onChange={e => {
                    setConfirmPassword(e.target.value);
                    if (passwordErrors.confirm) setPasswordErrors(prev => ({ ...prev, confirm: null }));
                  }}
                  placeholder="••••••••"
                />
                <button
                  type="button"
                  onMouseDown={e => e.preventDefault()}
                  onClick={() => toggleVisibility('confirmPasswordInput', setShowConfirmPassword)}
                  className={styles.eyeBtn}
                >
                  {showConfirmPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
              {passwordErrors.confirm && (
                <div className={styles.errorText}>
                  <AlertCircle size={12} /> {passwordErrors.confirm}
                </div>
              )}
            </div>
          </div>
          <button className={styles.saveBtn} onClick={handleSave}>Change Password</button>
        </div>
      )}

      {/* ── Privacy panel ── */}
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
          <button className={styles.saveBtn} onClick={handleSave}>Save Privacy Preferences</button>
        </div>
      )}

      {/* ── Notifications panel ── */}
      {activePanel === 'notifications' && (
        <div className={`${styles.body} animate-in`}>
          <div className={styles.sectionLabel}>Notification Preferences</div>
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
          <button className={styles.saveBtn} onClick={handleSave}>Save Notification Settings</button>
        </div>
      )}

      {/* ── Interests panel ── */}
      {activePanel === 'interests' && (
        <>
          <div className={`${styles.body} ${styles.bodyInterests} animate-in`}>
            <div className={styles.interestsHeader}>
              <p className={styles.interestsSubheadline}>
                Select up to 10 topics to customize your experience ({selectedInterests.length}/10)
              </p>
            </div>

            <div className={styles.categoriesWrapper}>
              {INTERESTS_BY_CATEGORY.map((category, catIndex) => {
                const row1 = category.tags.filter((_, i) => i % 2 === 0);
                const row2 = category.tags.filter((_, i) => i % 2 !== 0);
                return (
                  <div key={catIndex} className={styles.categorySection}>
                    <h3 className={styles.categoryTitle}>{category.title}</h3>
                    <div className={styles.tagsContainer}>
                      {[row1, row2].map((rowTags, rowIndex) => (
                        <div key={rowIndex} className={styles.tagsRow}>
                          {rowTags.map((tag, tagIndex) => {
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
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
          <button className={`${styles.saveBtn} ${styles.floatingSaveBtn}`} onClick={handleSave}>Save Interests</button>
        </>
      )}

      {/* ── Delete Account Confirmation Modal ── */}
      {showDeleteConfirm && (
        <div className={styles.modalOverlay}>
          <div className={styles.modalCard}>
            <div className={styles.modalWarningIcon}>
              <AlertCircle size={32} />
            </div>
            <h3 className={styles.modalTitle}>Delete Account?</h3>
            <p className={styles.modalText}>
              This action is permanent and cannot be undone. All your posts, profile data, and matches will be deleted forever.
            </p>
            <div className={styles.modalButtons}>
              <button 
                type="button" 
                className={styles.modalCancelBtn}
                onClick={() => setShowDeleteConfirm(false)}
              >
                Cancel
              </button>
              <button 
                type="button" 
                className={styles.modalDeleteBtn}
                onClick={async () => {
                  setShowDeleteConfirm(false);
                  try {
                    await apiClient.delete('/api/users/me');
                  } catch (err) {
                    showToast('Failed to delete account. Please try again.');
                    return;
                  }
                  logout();
                }}
              >
                Delete Account
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Help & Support Drawer */}
      {showHelpDrawer && (
        <div
          style={{ position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}
          onClick={() => setShowHelpDrawer(false)}
        >
          <div
            style={{ background: 'var(--color-bg-white)', borderRadius: '20px 20px 0 0', width: '100%', maxWidth: '520px', maxHeight: '85dvh', overflowY: 'auto', padding: '1.75rem 1.5rem 2.5rem', boxShadow: '0 -8px 40px rgba(0,0,0,0.18)' }}
            onClick={e => e.stopPropagation()}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.25rem' }}>
              <h2 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 700, color: 'var(--color-text-main)' }}>Help &amp; Support</h2>
              <button onClick={() => setShowHelpDrawer(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-muted)', padding: '0.25rem' }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>

            <p style={{ margin: '0 0 1.25rem', fontSize: '0.85rem', color: 'var(--color-text-muted)', lineHeight: 1.6 }}>Quick answers below. Still stuck? Reach out.</p>

            {[
              { q: 'How do I change my username?', a: 'Go to Settings → Account & Profile. Usernames can be changed once every 30 days.' },
              { q: 'Why can\'t I send messages?', a: 'Make sure you and the other person are connected (following each other). Some users also have message privacy set to followers only.' },
              { q: 'How do I report a post or user?', a: 'Tap the ⋯ menu on any post or profile and select Report. Our team reviews all reports within 24 hours.' },
              { q: 'Can I recover a deleted post?', a: 'Deleted posts cannot be recovered. Once removed they are gone permanently.' },
              { q: 'How does the Instant Match work?', a: 'Instant Match connects you with another online user who shares an interest you both selected. Tap the ⚡ button on the Campus tab to try it.' },
            ].map((item, i) => (
              <div key={i} style={{ borderBottom: '1px solid var(--color-border)', marginBottom: '0' }}>
                <button
                  onClick={() => setOpenFaq(openFaq === i ? null : i)}
                  style={{ width: '100%', textAlign: 'left', background: 'none', border: 'none', padding: '1rem 0', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem' }}
                >
                  <span style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--color-text-main)' }}>{item.q}</span>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ flexShrink: 0, transform: openFaq === i ? 'rotate(180deg)' : 'rotate(0)', transition: 'transform 0.2s' }}><polyline points="6 9 12 15 18 9"/></svg>
                </button>
                {openFaq === i && (
                  <p style={{ margin: '0 0 1rem', fontSize: '0.85rem', color: 'var(--color-text-muted)', lineHeight: 1.6 }}>{item.a}</p>
                )}
              </div>
            ))}

            <div style={{ marginTop: '1.75rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              <a
                href="mailto:support@meetifyy.com?subject=Support%20Request"
                style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.9rem 1rem', borderRadius: '10px', background: 'var(--color-bg-soft)', textDecoration: 'none', color: 'var(--color-text-main)', fontWeight: 600, fontSize: '0.9rem' }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
                Email support@meetifyy.com
              </a>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
