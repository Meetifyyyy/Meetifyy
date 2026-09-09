import { useState, useEffect, useRef, useMemo } from 'react';
import OtpDialog from '@shared/components/OtpDialog';
import DeletionScheduledNotice from '../components/DeletionScheduledNotice';
import {
  beginDeletionCountdown,
  endDeletionCountdown,
} from '@shared/lib/deletionHandoff';
import { useNavigate, useLocation, useParams, Navigate, Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@shared/context/AuthContext';
import { showToast } from '@shared/utils/toast';
import { apiClient } from '@shared/api/apiClient';
import { useSmartBack } from '@shared/hooks/useSmartBack';
import { useOverlayBack } from '@shared/hooks/useOverlayBack';
import { useScrollLock } from '@shared/hooks/useScrollLock';
import { useSmartNavigation } from '@shared/hooks/useSmartNavigation';
import { validateDOB } from '@shared/utils/dateValidation';
import { validatePasswordChange } from '@features/auth/shared/passwordRules';
import { INTERESTS_BY_CATEGORY } from '@shared/constants/interestsData';
import AcademicSelection from '@shared/academics/AcademicSelection';
import { useAcademicCatalog } from '@shared/academics/useAcademicCatalog';
import { validateAcademicSelection } from '@shared/academics/academicCatalog';
import {
  Pencil, Lock, AlertCircle, Trash2,
  User, GraduationCap, Shield, Bell, HelpCircle, LogOut,
  ChevronRight, ChevronDown, Check, Ban,
  LockKeyhole, Cookie, Sparkles, Eye,
} from '@shared/components/icons';
import wordmark from '@assets/images/meetifyy_wordmark.svg';
import PasswordToggle, { usePasswordVisibility } from '@shared/components/forms/PasswordToggle';
import styles from './SettingsRoute.module.css';
import useDevToolsStore from '@shared/stores/devToolsStore';
import BlockedContacts from '../panels/BlockedContacts';
import SettingsVerificationPanel from '../panels/SettingsVerificationPanel';
import SettingsHelpPanel from '../panels/SettingsHelpPanel';
import { IS_DEV_BUILD } from '@config';
import { useCookieConsent } from '@shared/context/CookieConsentContext';

// Large-device split layout only kicks in at this width — tablets and phones
// keep the existing single-pane list/detail swap untouched.
const LARGE_SCREEN_QUERY = '(min-width: 1024px)';

/**
 * The Settings tree: what the root lists, and what sits under each entry.
 *
 * Two levels, and no more. The root used to render every individual setting at
 * once — ten rows under seven headings, with Delete Account among them — so the
 * page that exists to be scanned was the longest one in the product. Grouping
 * moves the scanning to four entries and puts each setting one predictable step
 * away: Settings -> category -> setting.
 *
 * Declared as data rather than markup because the same tree answers four
 * separate questions: what the root renders, what a category renders, which
 * URLs are valid, and which category a panel belongs to (which is where Back
 * goes). Those drifted apart when they were four hand-maintained lists.
 *
 * An entry with `panel` and no `items` is a leaf: the root row opens the panel
 * directly, because a category holding one setting is a step that exists only
 * to be walked through. Notifications and Help & Support are the two.
 *
 * Nothing here is new. Every `panel` is a panel that already existed at the
 * same URL, and every `action` is a handler that already existed on the root.
 */
export const SETTINGS_TREE = [
  {
    slug: 'account',
    label: 'Account',
    description: 'Profile, academic details and verification',
    icon: User,
    items: [
      { panel: 'profile', label: 'Edit Profile', icon: Pencil },
      { panel: 'academic', label: 'Academic Info', icon: GraduationCap },
      { panel: 'verification', label: 'Account Verification', icon: Shield },
    ],
  },
  /**
   * Interests sat under Account, which put the one setting people actually
   * revisit two steps in behind the ones they set once. It is not an account
   * detail either — it feeds the feed and the people suggestions, so it reads
   * as its own thing at the root. The picker it opens is unchanged.
   */
  {
    slug: 'interests',
    label: 'Interests & Topics',
    description: 'Topics that shape your feed and who you meet',
    icon: Sparkles,
    panel: 'interests',
  },
  {
    slug: 'privacy-security',
    label: 'Privacy & Security',
    description: 'Blocked accounts, your password, and your data',
    icon: LockKeyhole,
    items: [
      { panel: 'blocked-contacts', label: 'Blocked Contacts', icon: Ban },
      { panel: 'security', label: 'Change Password', icon: Lock },
      { action: 'cookies', label: 'Cookie Preferences', icon: Cookie },
    ],
    /**
     * Kept apart from the settings above rather than listed among them, and off
     * the root page entirely. Deleting an account is not a preference, and a
     * row that ends the account should not sit one mis-tap away from the row
     * that changes a display name. The flow it opens is untouched: the same
     * confirmation, the same emailed code, the same 30-day countdown.
     */
    danger: [{ action: 'delete', label: 'Delete Account', icon: Trash2 }],
  },
  {
    slug: 'privacy',
    label: 'Visibility',
    description: 'Who can see your profile, your status and your reads',
    icon: Eye,
    panel: 'privacy',
  },
  {
    slug: 'notifications',
    label: 'Notifications',
    description: 'Email and push alerts',
    icon: Bell,
    panel: 'notifications',
  },
  {
    slug: 'help',
    label: 'Help & Support',
    description: 'Answers, and a way to reach the team',
    icon: HelpCircle,
    panel: 'help',
  },
];

/** Category slugs — the entries that open a list rather than a settings panel. */
export const SETTINGS_CATEGORIES = SETTINGS_TREE.filter((e) => e.items).map((e) => e.slug);

/**
 * Every settings sub-page is addressable as /settings/:panel. The panel used to
 * live in component state seeded from location.state, which meant it could not
 * be linked to, did not survive a reload, and gave mobile Back nothing to pop —
 * so Back from a sub-page left Settings altogether.
 *
 * Derived from the tree so a panel cannot be reachable in the UI but rejected
 * by the URL, or the reverse.
 */
export const SETTINGS_PANELS = SETTINGS_TREE.flatMap((entry) =>
  entry.items
    ? [...entry.items, ...(entry.danger || [])].filter((i) => i.panel).map((i) => i.panel)
    : entry.panel
      ? [entry.panel]
      : [],
);

/** Which category a panel sits under — where closing that panel returns to. */
export const PANEL_PARENT = SETTINGS_TREE.reduce((acc, entry) => {
  if (!entry.items) return acc;
  for (const item of [...entry.items, ...(entry.danger || [])]) {
    if (item.panel) acc[item.panel] = entry.slug;
  }
  return acc;
}, {});

// Old links that named a panel differently. `account` is deliberately absent:
// it is now a category of its own, and it opens with Edit Profile as its first
// row. Everything that links into Settings from elsewhere in the app names
// `profile` or `verification`, both unchanged.
const PANEL_ALIASES = { 'help-and-support': 'help', 'help-support': 'help' };

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
    } catch (_) {
      return;
    }
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
      </div>

      <nav className={styles.welcomeLinks} aria-label="Meetifyy">
        <Link to="/about" className={styles.welcomeLink}>About</Link>
        <Link to="/help-and-support" className={styles.welcomeLink}>Help &amp; Support</Link>
        <Link to="/privacy-policy" className={styles.welcomeLink}>Privacy Policy</Link>
        <Link to="/terms-and-conditions" className={styles.welcomeLink}>Terms of Service</Link>
        <Link to="/community-guidelines" className={styles.welcomeLink}>Community Guidelines</Link>
        <Link to="/cookie-policy" className={styles.welcomeLink}>Cookie Policy</Link>
      </nav>

      <p className={styles.version}>Meetifyy · v1.0.0</p>
    </div>
  );
}

function CustomSelect({ value, onChange, options = [], disabled, placeholder, searchable, placement = 'bottom', id }) {
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
    <div className={`${styles.customSelectContainer} ${disabled ? styles.disabledSelect : ''} ${isOpen ? styles.customSelectOpen : ''}`} ref={containerRef}>
      <button 
        id={id}
        type="button"
        className={`${styles.selectButton} ${isOpen ? styles.selectButtonActive : ''}`} 
        onClick={() => !disabled && setIsOpen(!isOpen)}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
      >
        <span
          className={`${styles.selectValue} ${!selectedOption ? styles.selectPlaceholder : ''}`}
        >
          {selectedOption ? selectedOption.label : (placeholder || 'Select...')}
        </span>
        <ChevronDown
          size={16}
          strokeWidth={2.5}
          className={`${styles.selectChevron} ${isOpen ? styles.selectChevronOpen : ''}`}
        />
      </button>

      {isOpen && (
        <div
          className={`${styles.selectDropdown} ${placement === 'top' ? styles.selectDropdownTop : ''}`}
          role="listbox"
        >
          {searchable && (
            <div className={styles.selectSearchContainer}>
              <input
                type="text"
                className={styles.selectSearchInput}
                placeholder="Search options..."
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
                  role="option"
                  aria-selected={String(opt.value) === String(value)}
                  className={`${styles.selectOption} ${String(opt.value) === String(value) ? styles.selectOptionActive : ''}`}
                  onClick={() => {
                    onChange(opt.value);
                    setIsOpen(false);
                    setSearchQuery('');
                  }}
                >
                  <span className={styles.selectOptionLabel}>{opt.label}</span>
                  {String(opt.value) === String(value) && (
                    <Check size={16} strokeWidth={3} className={styles.selectOptionCheck} />
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
  const { openPreferences: openCookiePreferences } = useCookieConsent();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const { panel: panelParam } = useParams();
  const isLargeScreen = useIsLargeScreen();

  const goBack = useSmartBack();
  const { smartNavigate } = useSmartNavigation();

  // One route param serves both levels: /settings/:panel is a category slug or a
  // settings panel. Keeping it as one segment means the existing route, every
  // saved link and the SEO route table need no change, and a panel URL stays
  // exactly as long as it was.
  const canonicalSlug = PANEL_ALIASES[panelParam] || panelParam || null;
  const activeCategory = canonicalSlug && SETTINGS_CATEGORIES.includes(canonicalSlug)
    ? canonicalSlug
    : null;
  const isKnownPanel = SETTINGS_PANELS.includes(canonicalSlug);
  const activePanel = isKnownPanel ? canonicalSlug : null; // null = category list

  // The category whose list belongs behind whatever is open. A panel shows its
  // parent's list, so the left pane on desktop keeps its context and Back has
  // somewhere to go that is not the root.
  const openCategory = activeCategory || (activePanel ? PANEL_PARENT[activePanel] : null) || null;

  const openPanel = (next) => navigate(`/settings/${next}`);

  /**
   * Closing is a move UP the tree, not a plain history pop.
   *
   * Panels can be reached from more than one place — Blocked Contacts from the
   * Privacy panel as well as from its category — so popping one entry could
   * land on a sibling rather than on the list above. `smartNavigate` pops when
   * the entry behind us really is the destination and replaces otherwise, so
   * closing always shows the parent exactly once whichever way it was opened.
   */
  const closePanel = () => {
    const parent = activePanel ? PANEL_PARENT[activePanel] : null;
    smartNavigate(parent ? `/settings/${parent}` : '/settings');
  };

  /** Leaving a category goes to the root; leaving a panel goes to its category. */
  const goUp = () => {
    if (activePanel) return closePanel();
    if (activeCategory) return smartNavigate('/settings');
    return goBack('/home');
  };

  // Account & Profile state
  const [displayName, setDisplayName] = useState(currentUser?.displayName || '');
  const [bio, setBio] = useState(currentUser?.bio || '');
  
  // Birthday state broken down like signup (Month dropdown, Day input, Year input)
  const initialDobParts = (currentUser?.birthday || '').split('-');
  const [birthYear, setBirthYear] = useState(initialDobParts[0] || '');
  const [birthMonth, setBirthMonth] = useState(initialDobParts[1] ? String(parseInt(initialDobParts[1], 10)) : '');
  const [birthDay, setBirthDay] = useState(initialDobParts[2] ? String(parseInt(initialDobParts[2], 10)) : '');
  const [dobAttempted, setDobAttempted] = useState(false);

  // Single controlled object, same shape the signup step uses.
  const [academic, setAcademic] = useState(() => ({
    course: currentUser?.course || '',
    branch: currentUser?.branch || '',
    passingYear: Number.isInteger(currentUser?.passingYear ?? currentUser?.currentYear)
      ? (currentUser?.passingYear ?? currentUser?.currentYear)
      : null,
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
  // The same show/hide behaviour every other password field in the app uses —
  // one implementation, including the caret preservation across the type swap.
  const currentPw = usePasswordVisibility();
  const newPw = usePasswordVisibility();
  const confirmPw = usePasswordVisibility();
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
      currentPw.hide();
      newPw.hide();
      confirmPw.hide();
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
  const [deleting, setDeleting] = useState(false);
  // The deletion flow is three states, driven entirely by the server:
  //   confirm  → the existing warning dialog
  //   otp      → a code has been emailed; nothing is scheduled yet
  //   scheduled→ the deletion is persisted; this is only the sign-out countdown
  const [deletionChallenge, setDeletionChallenge] = useState(null);
  const [deletionScheduled, setDeletionScheduled] = useState(null);

  // Delete-account confirmation is a destructive dialog over the panel; Back
  // must cancel it, never navigate past it.
  useOverlayBack(showDeleteConfirm, () => setShowDeleteConfirm(false));
  useScrollLock(showDeleteConfirm);

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
            if (user.birthday) {
              const parts = user.birthday.split('-');
              setBirthYear(parts[0] || '');
              setBirthMonth(parts[1] ? String(parseInt(parts[1], 10)) : '');
              setBirthDay(parts[2] ? String(parseInt(parts[2], 10)) : '');
            }
            setAcademic({
              course: user.course || '',
              branch: user.branch || '',
              passingYear: Number.isInteger(user.passingYear ?? user.currentYear)
                ? (user.passingYear ?? user.currentYear)
                : null,
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
      let finalBirthday = currentUser?.birthday || '';
      if (birthYear || birthMonth || birthDay) {
        const dobRes = validateDOB(birthYear, birthMonth, birthDay);
        if (!dobRes.isValid) {
          setDobAttempted(true);
          showToast(dobRes.error || 'Invalid date of birth', 'error');
          return;
        }
        finalBirthday = dobRes.dobString;
      }
      closePanel();
      showToast('Profile updated', 'success');
      if (updateCurrentUser) {
        updateCurrentUser({ ...currentUser, displayName, bio, birthday: finalBirthday });
      }
      queryClient.invalidateQueries({ queryKey: ['profile'] });
      updateProfile({ displayName, bio, birthday: finalBirthday }).catch(err => {
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
        passingYear: academic.passingYear,
      };
      if (updateCurrentUser) {
        updateCurrentUser(updatedUser);
      }
      queryClient.invalidateQueries({ queryKey: ['profile'] });
      updateProfile({
        course: academic.course,
        branch: academic.branch,
        passingYear: academic.passingYear,
      }).catch(err => {
        console.error('Failed to update academic info:', err);
        showToast(err?.message || "Couldn't save academic details", 'error');
      });
    } else if (activePanel === 'security') {
      // Shared with signup and reset — see passwordRules. This panel used to
      // carry its own `length < 8`, which let a password over bcrypt's 72-byte
      // limit through to GoTrue and back as an opaque error.
      const errors = validatePasswordChange({
        currentPassword,
        newPassword,
        confirmPassword,
      });

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
      showToast('Visibility settings saved', 'success');
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

  const panelTitle = {
    profile: 'Edit Profile',
    account: 'Edit Profile',
    academic: 'Academic Info',
    security: 'Change Password',
    privacy: 'Visibility Settings',
    notifications: 'Notifications',
    interests: 'Interests & Topics',
    'blocked-contacts': 'Blocked Contacts',
    verification: 'Account Verification',
    help: 'Help & Support',
  };

  // Each panel's markup is built once here and placed by the layout below —
  // on large screens both the list and the active detail panel render at once
  // (side by side), while mobile/tablet keeps swapping a single one in place,
  // exactly as before. Defining them once avoids duplicating any of this JSX
  // or the handlers/state it closes over.
  /**
   * Shared row markup, so a category row, a settings row and a destructive row
   * cannot drift apart. `to` is only for highlighting the active panel in the
   * desktop split, where the list stays on screen beside the detail.
   */
  const settingsRow = ({ key, icon: Icon, label, description, onClick, active, danger, chevron = true }) => (
    <button
      key={key}
      className={`${styles.row} ${active ? styles.rowActive : ''} ${danger ? styles.rowDanger : ''}`}
      onClick={onClick}
    >
      <span className={styles.rowIcon}>
        <Icon size={20} strokeWidth={2} />
      </span>
      <span className={styles.rowText}>
        <span className={styles.rowLabel}>{label}</span>
        {description && <span className={styles.rowDesc}>{description}</span>}
      </span>
      {chevron && (
        <span className={styles.rowChev}><ChevronRight size={18} strokeWidth={2.25} /></span>
      )}
    </button>
  );

  const runItemAction = (action) => {
    if (action === 'cookies') return openCookiePreferences();
    if (action === 'delete') return setShowDeleteConfirm(true);
  };

  /**
   * The root: four entries and a way out.
   *
   * Everything else moved one level down. What stays here is what belongs on a
   * page whose job is to be scanned — the categories, and Log Out, which is
   * frequent, reversible and not a setting. Delete Account is deliberately not
   * here; it lives under Privacy & Security, separated from the settings above
   * it.
   */
  const listPanel = (
    <div className={`${styles.body} animate-in`}>
      <div className={styles.group}>
        {SETTINGS_TREE.map((entry, i) => (
          <div key={entry.slug}>
            {i > 0 && <div className={styles.divider} />}
            {settingsRow({
              key: entry.slug,
              icon: entry.icon,
              label: entry.label,
              description: entry.description,
              // A leaf opens its panel; a category opens its list.
              onClick: () => openPanel(entry.slug),
              // A leaf is "open" when its panel is showing; a category when
              // either its list or one of its panels is.
              active: isLargeScreen
                && (openCategory === entry.slug || activePanel === entry.slug),
            })}
          </div>
        ))}
      </div>

      <div className={styles.group}>
        {settingsRow({
          key: 'logout',
          icon: LogOut,
          label: 'Log Out',
          onClick: logout,
          chevron: false,
        })}
      </div>

      {/* Developer section — dev builds only. `IS_DEV_BUILD` folds to a
          build-time constant, so this whole block drops out in production. */}
      {IS_DEV_BUILD && (
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

      <div className={styles.mobileOnlyWelcome}>
        <SettingsWelcomePanel />
      </div>
    </div>
  );

  /** One category's settings. Built from the same tree the root is built from. */
  const categoryPanel = (slug) => {
    const entry = SETTINGS_TREE.find((e) => e.slug === slug);
    if (!entry || !entry.items) return null;

    return (
      <div className={`${styles.body} animate-in`}>
        <div className={styles.group}>
          {entry.items.map((item, i) => (
            <div key={item.panel || item.action}>
              {i > 0 && <div className={styles.divider} />}
              {settingsRow({
                key: item.panel || item.action,
                icon: item.icon,
                label: item.label,
                onClick: () => (item.panel ? openPanel(item.panel) : runItemAction(item.action)),
                active: isLargeScreen && item.panel && activePanel === item.panel,
              })}
            </div>
          ))}
        </div>

        {entry.danger && (
          <>
            <div className={styles.sectionLabel}>Danger zone</div>
            <div className={`${styles.group} ${styles.dangerGroup}`}>
              {entry.danger.map((item, i) => (
                <div key={item.action}>
                  {i > 0 && <div className={styles.divider} />}
                  {settingsRow({
                    key: item.action,
                    icon: item.icon,
                    label: item.label,
                    onClick: () => runItemAction(item.action),
                    danger: true,
                    chevron: false,
                  })}
                </div>
              ))}
            </div>
            <p className={styles.dangerNote}>
              Deleting your account removes your profile, posts and messages.
              You have 30 days to change your mind before anything is erased.
            </p>
          </>
        )}
      </div>
    );
  };

  const profilePanel = (
    <div className={`${styles.body} animate-in`}>
      <div className={styles.group} style={{ overflow: 'visible' }}>
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
        <div className={styles.inputRow}>
          <label className={styles.inputLabel} htmlFor="settings-dob-month">Birthday</label>
          <div className={styles.dobRow}>
            <div className={styles.dobMonthWrapper}>
              <CustomSelect
                id="settings-dob-month"
                value={birthMonth}
                placement="top"
                onChange={val => {
                  setBirthMonth(val);
                  if (dobAttempted) setDobAttempted(false);
                }}
                placeholder="Month"
                options={Array.from({ length: 12 }, (_, i) => i + 1).map((m) => ({
                  value: String(m),
                  label: new Date(0, m - 1).toLocaleString('default', { month: 'short' }),
                }))}
              />
            </div>
            <input
              id="settings-dob-day"
              type="text"
              inputMode="numeric"
              maxLength={2}
              className={`${styles.dobInput} ${dobAttempted && (birthDay || birthMonth || birthYear) && !validateDOB(birthYear, birthMonth, birthDay).isValid ? styles.inputInvalid : ''}`}
              placeholder="Day"
              value={birthDay}
              onChange={(e) => {
                const raw = e.target.value.replace(/\D/g, '').slice(0, 2);
                if (raw === '') {
                  setBirthDay('');
                  return;
                }
                const num = parseInt(raw, 10);
                if (num > 31) return;
                setBirthDay(raw);
                if (dobAttempted) setDobAttempted(false);
              }}
              aria-label="Day"
            />
            <input
              id="settings-dob-year"
              type="text"
              inputMode="numeric"
              maxLength={4}
              className={`${styles.dobInput} ${dobAttempted && (birthDay || birthMonth || birthYear) && !validateDOB(birthYear, birthMonth, birthDay).isValid ? styles.inputInvalid : ''}`}
              placeholder="Year"
              value={birthYear}
              onChange={(e) => {
                const val = e.target.value.replace(/\D/g, '').slice(0, 4);
                setBirthYear(val);
                if (dobAttempted) setDobAttempted(false);
              }}
              aria-label="Year"
            />
          </div>
          {dobAttempted && (birthYear || birthMonth || birthDay) && !validateDOB(birthYear, birthMonth, birthDay).isValid && (
            <div className={styles.errorText}>
              <AlertCircle size={12} /> {validateDOB(birthYear, birthMonth, birthDay).error}
            </div>
          )}
        </div>
      </div>
      <button className={styles.saveBtn} onClick={handleSave}>Save Changes</button>
    </div>
  );

  const academicPanel = (
    <div className={`${styles.body} animate-in`}>
      <div className={styles.lockedInfoCard}>
        <div className={styles.lockedField}>
          <span className={styles.lockedLabel}>College Name</span>
          <span className={styles.lockedValue}>{collegeName || 'Not specified'}</span>
        </div>
        <div className={styles.lockedFieldDivider} />
        <div className={styles.lockedField}>
          <span className={styles.lockedLabel}>College Email</span>
          <span className={styles.lockedValue}>
            {currentUser?.collegeEmail ||
              (currentUser?.email && !currentUser.email.endsWith('@meetifyy.user') ? currentUser.email : null) ||
              session?.user?.email ||
              'Not specified'}
          </span>
        </div>
      </div>

      <div className={styles.group} style={{ overflow: 'visible', marginTop: '12px' }}>
        <AcademicSelection
          value={academic}
          onChange={setAcademic}
          Select={CustomSelect}
          showErrors={academicAttempted}
          coursePlacement="top"
          branchPlacement="top"
          yearPlacement="top"
          errors={{
            course: !academic.course ? 'Please select your course.' : null,
            branch: !academic.branch ? 'Please select your branch.' : null,
            passingYear:
              !Number.isInteger(academic.passingYear)
                ? 'Please select your passing year.'
                : null,
          }}
          classes={{
            selectGroup: styles.inputRow,
            selectLabel: styles.inputLabel,
            messageSlot: styles.selectErrorSlot,
            messageError: styles.errorText,
            divider: styles.nestedDivider,
          }}
        />
      </div>
      <button className={styles.saveBtn} onClick={handleSave}>Save Academic Info</button>
    </div>
  );

  /**
   * Enter submits the change-password fields.
   *
   * This panel is a div rather than a <form> — the whole settings tree is, and
   * each panel's Save is an onClick — so it got none of the implicit submit
   * behaviour every other password screen in the app has. Typing a password and
   * pressing Enter did nothing at all, which on a three-field password form
   * reads as the page being broken rather than as a missing shortcut.
   *
   * Bound to the inputs rather than the container so it cannot fire from the
   * toggle buttons beside them.
   */
  const submitPasswordOnEnter = (e) => {
    if (e.key !== 'Enter' || isSavingPassword) return;
    e.preventDefault();
    handleSave();
  };

  const securityPanel = (
    <div className={`${styles.body} animate-in`}>
      <div className={styles.group}>
        {/* Current password */}
        <div className={styles.inputRow}>
          <label className={styles.inputLabel} htmlFor="currentPasswordInput">Current Password</label>
          <div className={styles.passwordInputWrapper}>
            <input
              id="currentPasswordInput"
              name="currentPassword"
              className={styles.input}
              ref={currentPw.inputRef}
              type={currentPw.inputType}
              value={currentPassword}
              autoComplete="new-password"
              onChange={e => {
                setCurrentPassword(e.target.value);
                if (passwordErrors.current) setPasswordErrors(prev => ({ ...prev, current: null }));
              }}
              onKeyDown={submitPasswordOnEnter}
            />
            <PasswordToggle
              {...currentPw.toggleProps}
              className={styles.eyeBtn}
              label={currentPw.visible ? 'Hide current password' : 'Show current password'}
            />
          </div>
          {passwordErrors.current && (
            <div className={styles.errorText}>
              <AlertCircle size={12} /> {passwordErrors.current}
            </div>
          )}
        </div>

        {/* New password */}
        <div className={styles.inputRow}>
          <label className={styles.inputLabel} htmlFor="newPasswordInput">New Password</label>
          <div className={styles.passwordInputWrapper}>
            <input
              id="newPasswordInput"
              name="newPassword"
              className={styles.input}
              ref={newPw.inputRef}
              type={newPw.inputType}
              value={newPassword}
              autoComplete="new-password"
              onChange={e => {
                setNewPassword(e.target.value);
                if (passwordErrors.new) setPasswordErrors(prev => ({ ...prev, new: null }));
              }}
              onKeyDown={submitPasswordOnEnter}
            />
            <PasswordToggle
              {...newPw.toggleProps}
              className={styles.eyeBtn}
              label={newPw.visible ? 'Hide new password' : 'Show new password'}
            />
          </div>
          {passwordErrors.new && (
            <div className={styles.errorText}>
              <AlertCircle size={12} /> {passwordErrors.new}
            </div>
          )}
        </div>

        {/* Confirm password */}
        <div className={styles.inputRow}>
          <label className={styles.inputLabel} htmlFor="confirmPasswordInput">Confirm New Password</label>
          <div className={styles.passwordInputWrapper}>
            <input
              id="confirmPasswordInput"
              name="confirmPassword"
              className={styles.input}
              ref={confirmPw.inputRef}
              type={confirmPw.inputType}
              value={confirmPassword}
              autoComplete="new-password"
              onChange={e => {
                setConfirmPassword(e.target.value);
                if (passwordErrors.confirm) setPasswordErrors(prev => ({ ...prev, confirm: null }));
              }}
              onKeyDown={submitPasswordOnEnter}
            />
            <PasswordToggle
              {...confirmPw.toggleProps}
              className={styles.eyeBtn}
              label={confirmPw.visible ? 'Hide confirm password' : 'Show confirm password'}
            />
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
      <div className={styles.sectionLabel}>Blocked</div>
      <div className={styles.group}>
        <button className={styles.row} onClick={() => openPanel('blocked-contacts')}>
          <span className={styles.rowIcon}>
            <Ban size={20} strokeWidth={2} />
          </span>
          <span className={styles.rowLabel}>Blocked Contacts</span>
          <span className={styles.rowChev}><ChevronRight size={18} strokeWidth={2.25} /></span>
        </button>
      </div>

      <button className={styles.saveBtn} onClick={handleSave}>Save Visibility Settings</button>
    </div>
  );

  // Self-contained: it owns its own fetching and needs nothing from the
  // settings form state around it.
  const blockedContactsPanel = <BlockedContacts />;
  const verificationPanel = <SettingsVerificationPanel />;
  const helpPanel = <SettingsHelpPanel />;

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
    <div className={styles.interestsContainer}>
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
      <div className={styles.floatingSaveWrapper}>
        <button 
          type="button"
          className={styles.floatingSaveBtn} 
          onClick={handleSave}
        >
          Save Interests
        </button>
      </div>
    </div>
  );

  // Address hygiene, after every hook has run so the order stays stable.
  // An unknown segment is neither a category nor a panel, so it is not a valid
  // address: send it to the settings root rather than render the list under a
  // URL that means nothing.
  if (panelParam && !isKnownPanel && !activeCategory) {
    return <Navigate to="/settings" replace />;
  }
  // Aliases canonicalise, so each destination has exactly one URL.
  if (panelParam && canonicalSlug !== panelParam) {
    return <Navigate to={`/settings/${canonicalSlug}`} replace />;
  }

  return (
    <main className="centre centre-wide centre--sheet animate-in">
      <div className={styles.page}>
        {/* ── Sticky header ── */}
      <header className={styles.topBar}>
        <button
          className={styles.backBtn}
          aria-label="Go back"
          onClick={goUp}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="19" y1="12" x2="5" y2="12" />
            <polyline points="12 19 5 12 12 5" />
          </svg>
        </button>

        <span className={styles.topBarTitle}>
          {activePanel
            ? panelTitle[activePanel]
            : activeCategory
              ? SETTINGS_TREE.find((e) => e.slug === activeCategory)?.label
              : 'Settings'}
        </span>

        {/* Spacer to keep title centred — matches backBtn's own width exactly */}
        <div style={{ width: 40 }} />
      </header>

      {/* ── List + detail: split side-by-side on large screens (>=1024px),
           single-pane swap on mobile/tablet (unchanged) ── */}
      {isLargeScreen ? (
        <div className={styles.splitBody}>
          <div className={styles.splitListPane}>
            {/* The root list, always. It used to be replaced by the open
                category's list, which meant opening anything cost you the
                navigation you opened it from — on the one layout with room to
                keep both. The category's own list moved to the pane on the
                right, where there is space for it. */}
            {listPanel}
          </div>
          <div className={styles.splitDetailPane}>
            {/* A category shows its settings here; choosing one swaps this pane
                for the panel, with the root list on the left unmoved. */}
            {!activePanel && activeCategory && categoryPanel(activeCategory)}
            {activePanel === 'profile' && profilePanel}
            {activePanel === 'academic' && academicPanel}
            {activePanel === 'security' && securityPanel}
            {activePanel === 'privacy' && privacyPanel}
            {activePanel === 'notifications' && notificationsPanel}
            {activePanel === 'interests' && interestsPanel}
            {activePanel === 'blocked-contacts' && blockedContactsPanel}
            {activePanel === 'verification' && verificationPanel}
            {activePanel === 'help' && helpPanel}
            {/* Only when nothing at all is open. `activeCategory` has to be
                tested too: a category with no leaf panel selected renders its
                own list in this pane above, and checking `!activePanel` alone
                let the placeholder render underneath it — so opening Privacy &
                Security showed the brand wordmark, the legal links and the
                version string stacked below the Danger zone. */}
            {!activePanel && !activeCategory && <SettingsWelcomePanel />}
          </div>
        </div>
      ) : (
        <>
          {!activePanel && !activeCategory && listPanel}
          {!activePanel && activeCategory && categoryPanel(activeCategory)}
          {activePanel === 'profile' && profilePanel}
          {activePanel === 'academic' && academicPanel}
          {activePanel === 'security' && securityPanel}
          {activePanel === 'privacy' && privacyPanel}
          {activePanel === 'notifications' && notificationsPanel}
          {activePanel === 'interests' && interestsPanel}
          {activePanel === 'blocked-contacts' && blockedContactsPanel}
          {activePanel === 'verification' && verificationPanel}
          {activePanel === 'help' && helpPanel}
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
              Are you sure you want to delete your account?
            </p>
            <div className={styles.modalButtons}>
              <button 
                type="button" 
                className={styles.modalCancelBtn}
                onClick={() => setShowDeleteConfirm(false)}
                disabled={deleting}
              >
                Cancel
              </button>
              <button 
                type="button" 
                className={styles.modalDeleteBtn}
                disabled={deleting}
                onClick={async () => {
                  if (deleting) return;
                  setDeleting(true);
                  try {
                    // Sends a code. Schedules NOTHING — the account is only
                    // touched once that code comes back verified.
                    const challenge = await apiClient.post(
                      '/api/account/delete/request-otp'
                    );
                    setShowDeleteConfirm(false);
                    setDeletionChallenge(challenge);
                  } catch (err) {
                    showToast(
                      err?.message || "Couldn't start account deletion",
                      'error'
                    );
                  } finally {
                    setDeleting(false);
                  }
                }}
              >
                {deleting ? 'Sending code…' : 'Delete account'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Step 2 — prove it's the account owner. Nothing is scheduled yet. */}
      {deletionChallenge && (
        <OtpDialog
          title="Confirm account deletion"
          description="To continue with the deletion process, you need to verify your email."
          maskedEmail={deletionChallenge.maskedEmail}
          submitLabel="Delete my account"
          tone="danger"
          challenge={deletionChallenge}
          onClose={() => setDeletionChallenge(null)}
          onResend={async () => {
            const next = await apiClient.post('/api/account/delete/request-otp');
            setDeletionChallenge(next);
          }}
          onSubmit={async (otp) => {
            // Throws on a bad code; OtpDialog surfaces the server's message and
            // this step stays open, so a typo costs nothing but a retry.
            const status = await apiClient.post('/api/account/delete/confirm', {
              otp,
            });
            setDeletionChallenge(null);
            // Claims the screen for this tab before the status correction can
            // mount the recovery gate over the confirmation below.
            beginDeletionCountdown();
            // Persisted before the countdown starts — closing the tab now
            // leaves the deletion scheduled, which is the correct outcome.
            setDeletionScheduled(status);
          }}
        />
      )}

      {/* Step 3 — already persisted. This is only the sign-out countdown. */}
      {deletionScheduled && (
        <DeletionScheduledNotice
          scheduledPurgeAt={deletionScheduled.scheduledPurgeAt}
          onLogout={() => {
            // Released before signing out, so a session restored into this tab
            // sees the recovery gate rather than a suppressed one.
            endDeletionCountdown();
            logout();
          }}
        />
      )}
      </div>
    </main>
  );
}
