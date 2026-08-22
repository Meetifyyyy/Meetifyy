import { useState, useEffect, useRef, useMemo } from 'react';
import { useNavigate, useLocation, useParams, Navigate, Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@shared/context/AuthContext';
import { showToast } from '@shared/utils/toast';
import { apiClient } from '@shared/api/apiClient';
import { useSmartBack } from '@shared/hooks/useSmartBack';
import { validateDOB } from '@shared/utils/dateValidation';
import { INTERESTS_BY_CATEGORY } from '@features/onboarding/constants/interestsData';
import AcademicSelection from '@shared/academics/AcademicSelection';
import { useAcademicCatalog } from '@shared/academics/useAcademicCatalog';
import { validateAcademicSelection } from '@shared/academics/academicCatalog';
import {
  Pencil, Lock, Eye, EyeOff, AlertCircle, Trash2,
  User, GraduationCap, Shield, Bell, HelpCircle, LogOut,
  ChevronRight, ChevronDown, Check, X, Mail,
} from 'lucide-react';
import CustomDatePicker from '@shared/components/ui/CustomDatePicker';
import wordmark from '@assets/images/meetifyy_wordmark.svg';
import styles from './SettingsRoute.module.css';
import useDevToolsStore from '@shared/stores/devToolsStore';

// Large-device split layout only kicks in at this width — tablets and phones
// keep the existing single-pane list/detail swap untouched.
const LARGE_SCREEN_QUERY = '(min-width: 1024px)';

// Every settings sub-page is addressable as /settings/:panel. The panel used to
// live in component state seeded from location.state, which meant it could not
// be linked to, did not survive a reload, and gave mobile Back nothing to pop —
// so Back from a sub-page left Settings altogether.
const SETTINGS_PANELS = ['profile', 'academic', 'security', 'privacy', 'notifications', 'interests'];

// Old links and in-app callers that still say `account` mean the profile panel.
const PANEL_ALIASES = { account: 'profile' };

function useIsLargeScreen() {
  const [isLarge, setIsLarge] = useState(() => {
    try {
      return typeof window !== 'undefined' ? window.matchMedia(LARGE_SCREEN_QUERY).matches : false;
    } catch (_) {
      return false;
    }
  });

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    try {
      const mql = window.matchMedia(LARGE_SCREEN_QUERY);
      const handleChange = (e) => setIsLarge(e.matches);
      if (typeof mql.addEventListener === 'function') {
        mql.addEventListener('change', handleChange);
      } else if (typeof mql.addListener === 'function') {
        mql.addListener(handleChange);
      }
      setIsLarge(mql.matches);
      return () => {
        if (typeof mql.removeEventListener === 'function') {
          mql.removeEventListener('change', handleChange);
        } else if (typeof mql.removeListener === 'function') {
          mql.removeListener(handleChange);
        }
      };
    } catch (_) {}
  }, []);

  return isLarge;
}

// Right-panel placeholder shown on large screens when no settings category is
// selected yet — mirrors the app's footer links so desktop Settings isn't a
// dead blank space before the user picks something on the left.
function SettingsWelcomePanel() {
  return (
    <div className={styles.welcomePanel}>
      <div className={styles.welcomeBrand}>
        <img src={wordmark} alt="Meetifyy" className={styles.welcomeWordmark} />
        <p className={styles.welcomeTagline}>Manage your account, privacy, and preferences.</p>
      </div>

      <nav className={styles.welcomeLinks} aria-label="Meetifyy">
        <Link to="/about" className={styles.welcomeLink}>About</Link>
        <Link to="/contact" className={styles.welcomeLink}>Contact</Link>
        <Link to="/privacy-policy" className={styles.welcomeLink}>Privacy Policy</Link>
        <Link to="/terms-and-conditions" className={styles.welcomeLink}>Terms of Service</Link>
        <Link to="/community-guidelines" className={styles.welcomeLink}>Community Guidelines</Link>
        <Link to="/cookie-policy" className={styles.welcomeLink}>Cookie Policy</Link>
      </nav>

      <p className={styles.version}>Meetify · v1.0.0</p>
    </div>
  );
}

// Build emoji lookup map
const emojiMap = {};
INTERESTS_BY_CATEGORY.forEach(category => {
  category.tags.forEach(tag => {
    emojiMap[tag.label] = tag.emoji;
  });
});

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
        <span className={styles.selectValue} title={selectedOption ? selectedOption.label : (placeholder || 'Select...')}>
          {selectedOption ? selectedOption.label : (placeholder || 'Select...')}
        </span>
        <ChevronDown
          size={16}
          strokeWidth={2.5}
          className={`${styles.selectChevron} ${isOpen ? styles.selectChevronOpen : ''}`}
        />
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
                    <Check size={16} strokeWidth={3} color="var(--color-primary)" />
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
  const notificationLabEnabled = useDevToolsStore((s) => s.notificationLabEnabled);
  const setNotificationLabEnabled = useDevToolsStore((s) => s.setNotificationLabEnabled);
  const { currentUser, session, updateProfile, updateSettings, updateCurrentUser, changePassword, logout, collegeName } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const goBack = useSmartBack();
  const queryClient = useQueryClient();
  const isLargeScreen = useIsLargeScreen();

  const { panel: panelParam } = useParams();
  const canonicalPanel = PANEL_ALIASES[panelParam] || panelParam || null;
  const isKnownPanel = !canonicalPanel || SETTINGS_PANELS.includes(canonicalPanel);
  const activePanel = isKnownPanel ? canonicalPanel : null; // null = main list

  const openPanel = (next) => navigate(`/settings/${next}`);
  // Returning to the list is a pop, not a new destination — otherwise Back from
  // the list would walk right back into the panel the user just left.
  const closePanel = () => goBack('/settings');

  // Account & Profile state
  const [displayName, setDisplayName] = useState(currentUser?.displayName || '');
  const [bio, setBio] = useState(currentUser?.bio || '');
  const [birthday, setBirthday] = useState(currentUser?.birthday || '');
  // Single controlled object, same shape the signup step uses.
  const [academic, setAcademic] = useState(() => ({
    course: currentUser?.course || '',
    branch: currentUser?.branch || '',
    currentYear: Number.isInteger(currentUser?.currentYear) ? currentUser.currentYear : null,
  }));
  const [academicAttempted, setAcademicAttempted] = useState(false);
  const { courses: academicCourses } = useAcademicCatalog();

  // Interests state
  const [selectedInterests, setSelectedInterests] = useState(currentUser?.interests || []);
  const [initialPanelInterests, setInitialPanelInterests] = useState(currentUser?.interests || []);

  useEffect(() => {
    if (activePanel === 'interests') {
      setInitialPanelInterests(selectedInterests);
    }
  }, [activePanel]);

  // Security state
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [passwordErrors, setPasswordErrors] = useState({});
  const [isSavingPassword, setIsSavingPassword] = useState(false);

  // Reset security panel state when navigating away/back to avoid stale errors
  // and accidentally-revealed passwords persisting across panel visits.
  useEffect(() => {
    if (activePanel !== 'security') {
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setPasswordErrors({});
      setShowCurrentPassword(false);
      setShowNewPassword(false);
      setShowConfirmPassword(false);
    }
  }, [activePanel]);

  // Privacy & notifications state
  const settingsObj = currentUser?.settings || currentUser?.preferences || {};
  const [emailNotifs, setEmailNotifs] = useState(settingsObj.emailNotifs ?? true);
  const [pushNotifs, setPushNotifs] = useState(settingsObj.pushNotifs ?? false);
  const [privateProfile, setPrivateProfile] = useState(settingsObj.privateProfile ?? false);

  // Presence settings
  const [showOnlineStatus, setShowOnlineStatus] = useState(settingsObj.showOnlineStatus ?? true);
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
            setAcademic({
              course: user.course || '',
              branch: user.branch || '',
              currentYear: Number.isInteger(user.currentYear) ? user.currentYear : null,
            });
            setSelectedInterests(user.interests || []);
            if (updateCurrentUser) {
              updateCurrentUser({ ...currentUser, ...user });
            }
          }
          const s = settingsRes || user?.settings || user?.preferences;
          if (s) {
            setEmailNotifs(s.emailNotifs ?? true);
            setPushNotifs(s.pushNotifs ?? false);
            setPrivateProfile(s.privateProfile ?? false);
            setShowOnlineStatus(s.showOnlineStatus ?? true);
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
      if (displayName && displayName.trim().length > 30) {
        showToast('Name too long (max 30)', 'error');
        return;
      }
      if (bio && bio.length > 200) {
        showToast('Bio too long (max 200)', 'error');
        return;
      }
      if (birthday) {
        const parts = birthday.split('-');
        if (parts.length === 3) {
          const dobRes = validateDOB(parts[0], parts[1], parts[2]);
          if (!dobRes.isValid) {
            showToast(dobRes.error || 'Invalid date of birth', 'error');
            return;
          }
        }
      }
      closePanel();
      showToast('Profile updated', 'success');
      if (updateCurrentUser) {
        updateCurrentUser({ ...currentUser, displayName, bio, birthday });
      }
      queryClient.invalidateQueries({ queryKey: ['profile'] });
      updateProfile({ displayName, bio, birthday }).catch(err => {
        console.error('Failed to update profile:', err);
        showToast(err?.message || "Couldn't save profile", 'error');
      });
    } else if (activePanel === 'academic') {
      // Validate before closing: the panel stays open on an incomplete selection
      // so the user can see which field is wrong, rather than being dropped back
      // to the list with a toast. The server re-validates regardless.
      setAcademicAttempted(true);
      const academicError = validateAcademicSelection(academicCourses, academic);
      if (academicError) {
        showToast(academicError, 'error');
        return;
      }

      closePanel();
      showToast('Academic details updated', 'success');
      const updatedUser = {
        ...currentUser,
        course: academic.course,
        branch: academic.branch,
        currentYear: academic.currentYear,
      };
      if (updateCurrentUser) {
        updateCurrentUser(updatedUser);
      }
      queryClient.invalidateQueries({ queryKey: ['profile'] });
      updateProfile({
        course: academic.course,
        branch: academic.branch,
        currentYear: academic.currentYear,
      }).catch(err => {
        console.error('Failed to update academic info:', err);
        showToast(err?.message || "Couldn't save academic details", 'error');
      });
    } else if (activePanel === 'security') {
      const errors = {};
      if (!currentPassword) {
        errors.current = 'Current password is required';
      }
      if (!newPassword) {
        errors.new = 'New password is required';
      } else if (newPassword.length < 8) {
        errors.new = 'Password must be at least 8 characters';
      } else if (newPassword === currentPassword) {
        errors.new = 'Must differ from your current password';
      }
      if (confirmPassword !== newPassword) {
        errors.confirm = 'Passwords do not match';
      }

      if (Object.keys(errors).length > 0) {
        setPasswordErrors(errors);
        return;
      }

      setIsSavingPassword(true);
      try {
        await changePassword(currentPassword, newPassword);
        setCurrentPassword('');
        setNewPassword('');
        setConfirmPassword('');
        setPasswordErrors({});
        showToast('Password changed', 'success');
        closePanel();
      } catch (err) {
        // Use structured error code when available (set in AuthContext changePassword)
        const isWrongPassword =
          err?.code === 'WRONG_CURRENT_PASSWORD' ||
          err?.message?.toLowerCase().includes('incorrect');
        if (isWrongPassword) {
          setPasswordErrors({ current: 'Current password is incorrect' });
        } else if (err?.code === 'PASSWORD_REUSE') {
          setPasswordErrors({ new: 'Must differ from your current password' });
        } else {
          showToast(err?.message || "Couldn't change password", 'error');
        }
      } finally {
        setIsSavingPassword(false);
      }
    } else if (activePanel === 'privacy') {
      closePanel();
      showToast('Privacy settings saved', 'success');
      if (updateCurrentUser) {
        updateCurrentUser({
          ...currentUser,
          settings: {
            ...(currentUser?.settings || {}),
            privateProfile,
            showOnlineStatus,
            readReceipts,
          }
        });
      }
      queryClient.invalidateQueries({ queryKey: ['profile'] });
      queryClient.invalidateQueries({ queryKey: ['users'] });
      queryClient.invalidateQueries({ queryKey: ['campusUsers'] });
      queryClient.invalidateQueries({ queryKey: ['conversations'] });
      updateSettings({
        privateProfile,
        showOnlineStatus,
        readReceipts,
      }).catch(err => {
        console.error('Failed to update privacy settings:', err);
        showToast(err?.message || "Couldn't save privacy settings", 'error');
      });
    } else if (activePanel === 'notifications') {
      closePanel();
      showToast('Notification settings saved', 'success');
      if (updateCurrentUser) {
        updateCurrentUser({
          ...currentUser,
          settings: {
            ...(currentUser?.settings || {}),
            emailNotifs,
            pushNotifs,
          }
        });
      }
      updateSettings({
        emailNotifs,
        pushNotifs,
      }).catch(err => {
        console.error('Failed to update notification settings:', err);
        showToast(err?.message || "Couldn't save notification settings", 'error');
      });
    } else if (activePanel === 'interests') {
      closePanel();
      showToast('Interests saved', 'success');
      if (updateCurrentUser) {
        updateCurrentUser({ ...currentUser, interests: selectedInterests });
      }
      queryClient.invalidateQueries({ queryKey: ['profile'] });
      updateProfile({ interests: selectedInterests }).catch(err => {
        console.error('Failed to update interests:', err);
        showToast(err?.message || "Couldn't save interests", 'error');
      });
    }
  };

  const toggleInterest = (id) => {
    setSelectedInterests(prev => {
      if (prev.includes(id)) {
        return prev.filter(i => i !== id);
      }
      if (prev.length >= 10) {
        showToast('Maximum 10 interests', 'error');
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
    account: 'Edit Profile',
    academic: 'Academic Info',
    security: 'Change Password',
    privacy: 'Privacy Settings',
    notifications: 'Notifications',
    interests: 'Interests & Topics',
  };

  // Each panel's markup is built once here and placed by the layout below —
  // on large screens both the list and the active detail panel render at once
  // (side by side), while mobile/tablet keeps swapping a single one in place,
  // exactly as before. Defining them once avoids duplicating any of this JSX
  // or the handlers/state it closes over.
  const listPanel = (
    <div className={`${styles.body} animate-in`}>

      {/* Profile & Academic section */}
      <div className={styles.sectionLabel}>Profile &amp; Academic</div>
      <div className={styles.group}>
        <button className={styles.row} onClick={() => openPanel('profile')}>
          <span className={styles.rowIcon}>
            <User size={20} strokeWidth={2} />
          </span>
          <span className={styles.rowLabel}>Edit Profile</span>
          <span className={styles.rowChev}><ChevronRight size={18} strokeWidth={2.25} /></span>
        </button>
        <div className={styles.divider} />
        <button className={styles.row} onClick={() => openPanel('academic')}>
          <span className={styles.rowIcon}>
            <GraduationCap size={20} strokeWidth={2} />
          </span>
          <span className={styles.rowLabel}>Academic Info</span>
          <span className={styles.rowChev}><ChevronRight size={18} strokeWidth={2.25} /></span>
        </button>
      </div>

      {/* Security section */}
      <div className={styles.sectionLabel}>Security</div>
      <div className={styles.group}>
        <button className={styles.row} onClick={() => openPanel('security')}>
          <span className={styles.rowIcon}>
            <Lock size={20} strokeWidth={2} />
          </span>
          <span className={styles.rowLabel}>Change Password</span>
          <span className={styles.rowChev}><ChevronRight size={18} strokeWidth={2.25} /></span>
        </button>
      </div>

      {/* Preferences section */}
      <div className={styles.sectionLabel}>Preferences</div>
      <div className={styles.group}>
        <button className={styles.row} onClick={() => openPanel('privacy')}>
          <span className={styles.rowIcon}>
            <Shield size={20} strokeWidth={2} />
          </span>
          <span className={styles.rowLabel}>Privacy Settings</span>
          <span className={styles.rowChev}><ChevronRight size={18} strokeWidth={2.25} /></span>
        </button>
        <div className={styles.divider} />
        <button className={styles.row} onClick={() => openPanel('notifications')}>
          <span className={styles.rowIcon}>
            <Bell size={20} strokeWidth={2} />
          </span>
          <span className={styles.rowLabel}>Notifications</span>
          <span className={styles.rowChev}><ChevronRight size={18} strokeWidth={2.25} /></span>
        </button>
      </div>

      {/* Interests section */}
      <div className={styles.sectionHeader}>
        <div className={styles.sectionLabel} style={{ padding: 0 }}>Interests</div>
        <button
          className={styles.editInterestsHeaderBtn}
          onClick={() => openPanel('interests')}
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
            <HelpCircle size={20} strokeWidth={2} />
          </span>
          <span className={styles.rowLabel}>Help &amp; Support</span>
          <span className={styles.rowChev}><ChevronRight size={18} strokeWidth={2.25} /></span>
        </button>
        <div className={styles.divider} />
        <button className={`${styles.row} ${styles.rowDanger}`} onClick={() => setShowDeleteConfirm(true)}>
          <span className={styles.rowIcon}>
            <Trash2 size={20} strokeWidth={2} />
          </span>
          <span className={styles.rowLabel}>Delete Account</span>
        </button>
        <div className={styles.divider} />
        <button className={styles.row} onClick={logout}>
          <span className={styles.rowIcon}>
            <LogOut size={20} strokeWidth={2} />
          </span>
          <span className={styles.rowLabel}>Log Out</span>
        </button>
      </div>

      {/* Developer section — dev builds only. import.meta.env.DEV is statically
          replaced at build time, so this whole block drops out in production. */}
      {import.meta.env.DEV && (
        <>
          <div className={styles.sectionLabel}>Developer</div>
          <div className={styles.group}>
            <div className={styles.toggleRow}>
              <div className={styles.toggleInfo}>
                <span className={styles.rowLabel}>Notification Lab</span>
                <span className={styles.toggleDesc}>
                  Floating panel for triggering audited notifications. Off by default
                  because it sits above the rest of the UI.
                </span>
              </div>
              <label className={styles.toggle}>
                <input
                  type="checkbox"
                  checked={notificationLabEnabled}
                  onChange={(e) => setNotificationLabEnabled(e.target.checked)}
                />
                <span className={styles.slider} />
              </label>
            </div>
          </div>
        </>
      )}

      <p className={styles.version}>Meetify · v1.0.0</p>
    </div>
  );

  const profilePanel = (
    <div className={`${styles.body} animate-in`}>
      <div className={styles.group}>
        <div className={styles.inputRow}>
          <label className={styles.inputLabel} htmlFor="settings-display-name">Display Name</label>
          <input
            id="settings-display-name"
            name="displayName"
            className={styles.input}
            type="text"
            autoComplete="name"
            value={displayName}
            maxLength={30}
            onChange={e => setDisplayName(e.target.value.slice(0, 30))}
          />
        </div>
        <div className={styles.divider} />
        <div className={styles.inputRow}>
          <label className={styles.inputLabel} htmlFor="settings-username">Username</label>
          <input
            id="settings-username"
            name="username"
            className={styles.input}
            type="text"
            autoComplete="username"
            value={currentUser?.username}
            disabled
          />
        </div>
        <div className={styles.divider} />
        <div className={styles.inputRow}>
          <label className={styles.inputLabel} htmlFor="settings-bio">Bio</label>
          <input
            id="settings-bio"
            name="bio"
            className={styles.input}
            type="text"
            value={bio}
            maxLength={200}
            onChange={e => setBio(e.target.value.slice(0, 200))}
          />
        </div>
        <div className={styles.divider} />
        <div className={styles.inputRow}>
          <label className={styles.inputLabel}>Date of Birth</label>
          <CustomDatePicker
            value={birthday}
            onChange={val => setBirthday(val)}
          />
        </div>
      </div>
      <button className={styles.saveBtn} onClick={handleSave}>Save Changes</button>
    </div>
  );

  const academicPanel = (
    <div className={`${styles.body} animate-in`}>
      <div className={styles.lockedInfoCard}>
        <div className={styles.lockedCardHeader}>
          <Lock size={14} className={styles.lockedIcon} />
          <span className={styles.lockedHeaderTitle}>Verified Student Identity</span>
        </div>
        <div className={styles.lockedField}>
          <span className={styles.lockedLabel}>College</span>
          <span className={styles.lockedValue}>{collegeName}</span>
        </div>
        <div className={styles.lockedFieldDivider} />
        <div className={styles.lockedField}>
          <span className={styles.lockedLabel}>College Email</span>
          <span className={styles.lockedValue}>
            {currentUser?.collegeEmail ||
              (currentUser?.email && !currentUser.email.endsWith('@meetifyy.user') ? currentUser.email : null) ||
              session?.user?.email ||
              ''}
          </span>
        </div>
        <div className={styles.lockedHint}>
          Linked to your verified student login and cannot be modified.
        </div>
      </div>

      <div className={styles.group} style={{ overflow: 'visible', marginTop: '12px' }}>
        <AcademicSelection
          value={academic}
          onChange={setAcademic}
          Select={CustomSelect}
          showErrors={academicAttempted}
          errors={{
            course: !academic.course ? 'Please select your course.' : null,
            branch: academic.course && !academic.branch ? 'Please select your branch.' : null,
            currentYear:
              academic.course && !Number.isInteger(academic.currentYear)
                ? 'Please select your current year.'
                : null,
          }}
          classes={{
            selectGroup: styles.selectRow,
            selectLabel: styles.inputLabel,
            messageSlot: styles.selectErrorSlot,
            messageError: styles.errorText,
          }}
        />
      </div>
      <button className={styles.saveBtn} onClick={handleSave}>Save Academic Info</button>
    </div>
  );

  const securityPanel = (
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
      <button
        className={styles.saveBtn}
        onClick={handleSave}
        disabled={isSavingPassword}
      >
        {isSavingPassword ? 'Updating…' : 'Change Password'}
      </button>
    </div>
  );

  const privacyPanel = (
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
  );

  const notificationsPanel = (
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
  );

  const interestsPanel = (
    <>
      <div className={`${styles.body} ${styles.bodyInterests} animate-in`}>
        <div className={styles.interestsHeader}>
          <p className={styles.interestsSubheadline}>
            Select up to 10 topics to customize your experience ({selectedInterests.length}/10)
          </p>
        </div>

        <div className={styles.categoriesWrapper}>
          {INTERESTS_BY_CATEGORY.map((category, catIndex) => {
            const selectedInCat = category.tags.filter(tag => initialPanelInterests.includes(tag.label));
            const unselectedInCat = category.tags.filter(tag => !initialPanelInterests.includes(tag.label));
            const sortedTags = [...selectedInCat, ...unselectedInCat];
            const row1 = sortedTags.filter((_, i) => i % 2 === 0);
            const row2 = sortedTags.filter((_, i) => i % 2 !== 0);
            return (
              <div key={catIndex} className={styles.categorySection}>
                <h3 className={styles.categoryTitle}>{category.title}</h3>
                <div className={styles.tagsContainer}>
                  {[row1, row2].map((rowTags, rowIndex) => (
                    <div key={rowIndex} className={styles.tagsRow}>
                      {rowTags.map((tag) => {
                        const isSelected = selectedInterests.includes(tag.label);
                        return (
                          <button
                            key={tag.label}
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
  );

  // Address hygiene, after every hook has run so the order stays stable.
  // An unknown panel segment is not a valid address: send it to the settings
  // root rather than render the list under a URL that means nothing.
  if (panelParam && !isKnownPanel) return <Navigate to="/settings" replace />;
  // Aliases canonicalise, so each panel has exactly one URL.
  if (panelParam && canonicalPanel !== panelParam) {
    return <Navigate to={`/settings/${canonicalPanel}`} replace />;
  }

  return (
    <main className="centre centre-wide centre--sheet animate-in">
      <div className={styles.page}>
        {/* ── Sticky header ── */}
      <header className={styles.topBar}>
        <button
          className={styles.backBtn}
          aria-label="Go back"
          onClick={() => goBack(activePanel ? '/settings' : '/home')}
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

        {/* Spacer to keep title centred — matches backBtn's own width exactly */}
        <div style={{ width: 40 }} />
      </header>

      {/* ── List + detail: split side-by-side on large screens (>=1024px),
           single-pane swap on mobile/tablet (unchanged) ── */}
      {isLargeScreen ? (
        <div className={styles.splitBody}>
          <div className={styles.splitListPane}>
            {listPanel}
          </div>
          <div className={styles.splitDetailPane}>
            {activePanel === 'profile' && profilePanel}
            {activePanel === 'academic' && academicPanel}
            {activePanel === 'security' && securityPanel}
            {activePanel === 'privacy' && privacyPanel}
            {activePanel === 'notifications' && notificationsPanel}
            {activePanel === 'interests' && interestsPanel}
            {!activePanel && <SettingsWelcomePanel />}
          </div>
        </div>
      ) : (
        <>
          {!activePanel && listPanel}
          {activePanel === 'profile' && profilePanel}
          {activePanel === 'academic' && academicPanel}
          {activePanel === 'security' && securityPanel}
          {activePanel === 'privacy' && privacyPanel}
          {activePanel === 'notifications' && notificationsPanel}
          {activePanel === 'interests' && interestsPanel}
        </>
      )}

      {/* ── Delete Account Confirmation Modal ── */}
      {showDeleteConfirm && (
        <div className={styles.modalOverlay}>
          <div className={styles.modalCard}>
            <div className={styles.modalWarningIcon}>
              <AlertCircle size={32} />
            </div>
            <h3 className={styles.modalTitle}>Delete Account</h3>
            <p className={styles.modalText}>
              All your posts, matches, and profile data will be permanently deleted.
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
                    showToast("Couldn't delete account", 'error');
                    return;
                  }
                  logout();
                }}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Help & Support Drawer */}
      {showHelpDrawer && (
        <div className={styles.helpOverlay} onClick={() => setShowHelpDrawer(false)}>
          <div className={styles.helpCard} onClick={e => e.stopPropagation()}>
            <div className={styles.helpHeader}>
              <h2 className={styles.helpTitle}>Help &amp; Support</h2>
              <button
                onClick={() => setShowHelpDrawer(false)}
                className={styles.helpCloseBtn}
                aria-label="Close"
              >
                <X size={18} strokeWidth={2.25} />
              </button>
            </div>

            <p className={styles.helpIntro}>Quick answers below. Still stuck? Reach out.</p>

            {[
              { q: 'How do I change my username?', a: 'Go to Settings → Account & Profile. Usernames can be changed once every 30 days.' },
              { q: 'Why can\'t I send messages?', a: 'Make sure you and the other person are connected (following each other). Some users also have message privacy set to followers only.' },
              { q: 'How do I report a post or user?', a: 'Tap the ⋯ menu on any post or profile and select Report. Our team reviews all reports within 24 hours.' },
              { q: 'Can I recover a deleted post?', a: 'Deleted posts cannot be recovered. Once removed they are gone permanently.' },
              { q: 'How does the Instant Match work?', a: 'Instant Match connects you with another online user who shares an interest you both selected. Tap the ⚡ button on the Campus tab to try it.' },
            ].map((item, i) => (
              <div key={i} className={styles.faqItem}>
                <button
                  onClick={() => setOpenFaq(openFaq === i ? null : i)}
                  className={styles.faqQuestion}
                >
                  <span className={styles.faqQuestionText}>{item.q}</span>
                  <ChevronDown
                    size={16}
                    strokeWidth={2.5}
                    className={`${styles.faqChevron} ${openFaq === i ? styles.faqChevronOpen : ''}`}
                  />
                </button>
                {openFaq === i && (
                  <p className={styles.faqAnswer}>{item.a}</p>
                )}
              </div>
            ))}

            <div className={styles.helpContactRow}>
              <a
                href="mailto:support@meetifyy.com?subject=Support%20Request"
                className={styles.helpContactLink}
              >
                <Mail size={18} strokeWidth={2} />
                Email support@meetifyy.com
              </a>
            </div>
          </div>
        </div>
      )}
      </div>
    </main>
  );
}
