import { useState, useEffect, useLayoutEffect, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import OtpDialog from '@shared/components/OtpDialog';
import DeletionScheduledNotice from '../components/DeletionScheduledNotice';
import {
  beginDeletionCountdown,
  endDeletionCountdown,
} from '@shared/lib/deletionHandoff';
import { useNavigate, useParams, useSearchParams, Navigate, Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@shared/context/AuthContext';
import ActionDot from '@shared/components/ActionDot';
import { useProfileActionNeeded } from '@shared/hooks/useProfileActionNeeded';
import { showToast } from '@shared/utils/toast';
import { apiClient } from '@shared/api/apiClient';
import { useOverlayBack } from '@shared/hooks/useOverlayBack';
import { useScrollLock } from '@shared/hooks/useScrollLock';
import { useSettingsBack } from './useSettingsBack';
import { usePageTransition } from '@shared/hooks/usePageTransition';
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
  LockKeyhole, Cookie, Sparkles, Eye, Devices, Mail, Smartphone,
  ChevronLeft,
} from '@shared/components/icons';
import wordmark from '@assets/images/meetifyy_wordmark.svg';
import PasswordToggle, { usePasswordVisibility } from '@shared/components/forms/PasswordToggle';
import styles from './SettingsRoute.module.css';
import useDevToolsStore from '@shared/stores/devToolsStore';
import BlockedContacts from '../panels/BlockedContacts';
import SettingsVerificationPanel from '../panels/SettingsVerificationPanel';
import SettingsEmailPanel from '../panels/SettingsEmailPanel';
import { GENDER_OPTIONS } from '@shared/constants/gender';
import SettingsHelpPanel from '../panels/SettingsHelpPanel';
import DevicesPanel from '../panels/DevicesPanel';
import PushNotificationsSettings from '../panels/PushNotificationsSettings';
import { IS_DEV_BUILD, IS_MOBILE_BUILD } from '@config';
import { useCookieConsent } from '@shared/context/CookieConsentContext';
import { visibleViewportBottom } from '@shared/utils/visibleViewport';
import { dismissKeyboardThen, shouldAutoFocusSearch } from '@shared/utils/textFocus';
import { isAffiliationActive } from '@shared/lib/campusAccess';
import { clearCachedData, estimateCacheUsage } from '@shared/lib/clearCachedData';
import ConfirmModal from '@shared/components/modals/ConfirmModal';
import { overlayManager } from '@shared/services/OverlayManager';
import { viewFromParams } from '@features/info/help/hub/helpHub';
import { VIEW_TITLES as HELP_VIEW_TITLES } from '@features/info/help/hub/HelpView';

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
    icon: User,
    items: [
      { panel: 'profile', label: 'Edit Profile', icon: Pencil },
      { panel: 'email', label: 'Email', icon: Mail },
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
    icon: Sparkles,
    panel: 'interests',
  },
  {
    slug: 'privacy-security',
    label: 'Privacy & Security',
    icon: LockKeyhole,
    items: [
      { panel: 'blocked-contacts', label: 'Blocked Contacts', icon: Ban },
      { panel: 'security', label: 'Change Password', icon: Lock },
      // Where a signed-in device is ended. Sits beside Change Password because
      // the two are the same job — deciding who still has access.
      { panel: 'devices', label: 'Devices', icon: Devices },
      // The app has no cookie banner and keeps its sign-in in the device keystore, so
      // "Cookie Preferences" would name something it does not do.
      { action: 'cookies', label: IS_MOBILE_BUILD ? 'Storage & Privacy' : 'Cookie Preferences', icon: Cookie },
      // Not destructive — the session and anything unsent survive it — so it
      // sits with the ordinary rows, beside the other "what this device keeps".
      { action: 'clear-cache', label: 'Clear cached data', icon: Smartphone },
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
    icon: Eye,
    panel: 'privacy',
  },
  {
    slug: 'notifications',
    label: 'Notifications',
    icon: Bell,
    panel: 'notifications',
  },
  {
    slug: 'help',
    label: 'Help & Support',
    icon: HelpCircle,
    panel: 'help',
  },
];

/**
 * "About 12 MB" from whatever `estimateCacheUsage` reports — a byte count, or
 * an object carrying one. Null when the platform cannot say, so the row shows
 * no line rather than a wrong one.
 */
export function formatCacheUsage(usage) {
  const bytes = typeof usage === 'number'
    ? usage
    : usage && typeof usage === 'object'
      ? (usage.bytes ?? usage.usage ?? usage.total ?? null)
      : null;
  if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes < 0) return null;
  if (bytes < 1024 * 1024) return 'Uses less than 1 MB on this device';
  const mb = bytes / (1024 * 1024);
  // "Uses", not "frees": the figure is everything the app stores on the
  // device, signed-in session and unsent messages included, not what a clear
  // will release.
  if (mb < 1024) return `Uses about ${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB on this device`;
  return `Uses about ${(mb / 1024).toFixed(1)} GB on this device`;
}

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
        {!IS_MOBILE_BUILD && (
          <Link to="/cookie-policy" className={styles.welcomeLink}>Cookie Policy</Link>
        )}
      </nav>

      <p className={styles.version}>Meetifyy · v1.0.0</p>
    </div>
  );
}

/** "2004-03-07" as the three form fields: year, month and day without zero padding. */
export function birthdayParts(birthday) {
  const parts = (typeof birthday === 'string' ? birthday : '').split('-');
  return {
    birthYear: parts[0] || '',
    birthMonth: parts[1] ? String(parseInt(parts[1], 10)) : '',
    birthDay: parts[2] ? String(parseInt(parts[2], 10)) : '',
  };
}

/** The Edit Profile form as the saved account describes it. */
export function profileFormFromUser(user) {
  return {
    displayName: user?.displayName || '',
    bio: user?.bio || '',
    gender: user?.gender || '',
    ...birthdayParts(user?.birthday),
  };
}

/** The Academic Info form as the saved account describes it. */
export function academicFromUser(user) {
  const year = user?.passingYear ?? user?.currentYear;
  return {
    course: user?.course || '',
    branch: user?.branch || '',
    passingYear: Number.isInteger(year) ? year : null,
  };
}

const dobPart = (v) => (v === '' || v == null ? '' : String(parseInt(v, 10)));

/**
 * Whether the Edit Profile form differs from what is saved. Compared as the
 * server keeps it: names and bios without surrounding spaces, "07" as "7".
 */
export function isProfileFormDirty(form, saved) {
  return (form.displayName || '').trim() !== (saved.displayName || '').trim()
    || (form.bio || '').trim() !== (saved.bio || '').trim()
    || (form.gender || '') !== (saved.gender || '')
    || (form.birthYear || '') !== (saved.birthYear || '')
    || dobPart(form.birthMonth) !== dobPart(saved.birthMonth)
    || dobPart(form.birthDay) !== dobPart(saved.birthDay);
}

function sameSet(a = [], b = []) {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((x) => set.has(x));
}

/**
 * Runs `fn` once no dialog is open and the browser has left the history entry
 * the dialog pushed. Leaving a page from a confirmation's own button otherwise
 * races the dialog's cleanup: Back would close the (already closing) dialog
 * instead of navigating, or step from the dialog's entry and land one short.
 */
function runWhenOverlaysSettled(fn, tries = 40) {
  const state = typeof window !== 'undefined' ? window.history.state : null;
  const onOverlayEntry = (state?.usr?.__overlayId ?? state?.__overlayId ?? null) !== null;
  if ((!overlayManager.hasOpenOverlays() && !onOverlayEntry) || tries <= 0) {
    fn();
    return;
  }
  setTimeout(() => runWhenOverlaysSettled(fn, tries - 1), 25);
}

function CustomSelect({ value, onChange, options = [], disabled, placeholder, searchable, placement = 'bottom', id }) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const containerRef = useRef(null);
  const menuRef = useRef(null);
  const [menuBox, setMenuBox] = useState(null);
  // Whether the menu's own search box takes focus (see @shared/utils/textFocus),
  // and a pending open waiting for the keyboard to finish closing.
  const autoFocusSearchRef = useRef(false);
  const cancelOpenRef = useRef(null);
  useEffect(() => () => cancelOpenRef.current?.(), []);

  /*
   * The menu is portalled to <body> and positioned `fixed` against the
   * viewport. Inside the page it was clipped: `.page` has `overflow: hidden`
   * and the panel body scrolls. It opens on the preferred side when that side
   * has room, flips otherwise, is capped to the space it gets (scrolling
   * inside), and follows the trigger every frame while open, so a scrolling
   * panel or a resizing viewport cannot leave it behind. Same behaviour as
   * the signup dropdown.
   */
  useLayoutEffect(() => {
    if (!isOpen) return undefined;
    let raf;
    let last = '';
    const place = () => {
      const el = containerRef.current;
      if (el) {
        const r = el.getBoundingClientRect();
        const vw = window.innerWidth;
        // Space below ends at the keyboard: in the app it overlays the page
        // and shrinks no viewport, and a searchable menu raises it on open.
        const vh = visibleViewportBottom() || window.innerHeight;
        const key = `${Math.round(r.top)}:${Math.round(r.left)}:${Math.round(r.width)}:${vw}:${Math.round(vh)}`;
        if (key !== last) {
          last = key;
          const GAP = 6;
          const EDGE = 8;
          const IDEAL = searchable ? 300 : 260;
          const below = vh - r.bottom - GAP - EDGE;
          const above = r.top - GAP - EDGE;
          const fits = Math.min(IDEAL, 180);
          const up = placement === 'top'
            ? above >= fits || above > below
            : below < fits && above > below;
          // Exactly the trigger's width, so the menu lines up with its field.
          const width = Math.min(r.width, vw - EDGE * 2);
          const left = Math.min(Math.max(r.left, EDGE), vw - EDGE - width);
          const maxHeight = Math.max(120, Math.min(IDEAL, up ? above : below));
          setMenuBox(up
            // A fixed-position offset, from the layout viewport's bottom edge.
            ? { up, left, width, maxHeight, bottom: window.innerHeight - r.top + GAP }
            : { up, left, width, maxHeight, top: r.bottom + GAP });
        }
      }
      raf = requestAnimationFrame(place);
    };
    place();
    return () => cancelAnimationFrame(raf);
  }, [isOpen, placement, searchable]);

  useEffect(() => {
    if (!isOpen) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') {
        setIsOpen(false);
        setSearchQuery('');
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [isOpen]);

  useEffect(() => {
    const handleOutsideClick = (e) => {
      // The menu lives in a portal, outside the container.
      if (menuRef.current && menuRef.current.contains(e.target)) return;
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
        onClick={() => {
          if (disabled) return;
          cancelOpenRef.current?.();
          cancelOpenRef.current = null;
          if (isOpen) {
            setIsOpen(false);
            return;
          }
          // Close the keyboard first; the menu is placed after, once, against
          // the layout it will keep (no opening above and dropping down).
          cancelOpenRef.current = dismissKeyboardThen(() => {
            cancelOpenRef.current = null;
            autoFocusSearchRef.current = shouldAutoFocusSearch();
            setIsOpen(true);
          });
        }}
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

      {isOpen && menuBox && createPortal(
        <div
          ref={menuRef}
          className={`${styles.selectDropdown} ${styles.selectPortal} ${menuBox.up ? styles.selectDropdownTop : ''}`}
          role="listbox"
          style={{
            left: menuBox.left,
            width: menuBox.width,
            maxHeight: menuBox.maxHeight,
            top: menuBox.up ? 'auto' : menuBox.top,
            bottom: menuBox.up ? menuBox.bottom : 'auto',
          }}
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
                autoFocus={autoFocusSearchRef.current}
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
        </div>,
        document.body,
      )}
    </div>
  );
}

export default function SettingsRoute() {
  const notificationLabEnabled = useDevToolsStore((s) => s.notificationLabEnabled);
  const setNotificationLabEnabled = useDevToolsStore((s) => s.setNotificationLabEnabled);
  const { currentUser, updateProfile, updateSettings, updateCurrentUser, changePassword, logout } = useAuth();
  const profileAction = useProfileActionNeeded();
  const { openPreferences: openCookiePreferences } = useCookieConsent();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { open: openPage } = usePageTransition();
  const { panel: panelParam } = useParams();
  const [searchParams] = useSearchParams();
  const isLargeScreen = useIsLargeScreen();

  // The latest signed-in user, for work that finishes after the render that
  // started it (a toggle's save failing, a panel re-reading its saved values).
  const currentUserRef = useRef(currentUser);
  const updateCurrentUserRef = useRef(updateCurrentUser);
  useEffect(() => {
    currentUserRef.current = currentUser;
    updateCurrentUserRef.current = updateCurrentUser;
  }, [currentUser, updateCurrentUser]);

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
  // Help & Support's own pages (?view=requests, ?view=safety). They are a level
  // below the hub, so the header names them and Back returns to the hub.
  const helpView = activePanel === 'help' ? viewFromParams(searchParams) : null;

  // The category whose list belongs behind whatever is open. A panel shows its
  // parent's list, so the left pane on desktop keeps its context and Back has
  // somewhere to go that is not the root.
  const openCategory = activeCategory || (activePanel ? PANEL_PARENT[activePanel] : null) || null;

  // Back. See useSettingsBack for why it pops history instead of navigating
  // up the tree whenever the page behind is the right one — navigating up is
  // what used to loop.
  const { goUp } = useSettingsBack({
    activePanel,
    activeCategory,
    subView: helpView,
    parentOf: (panel) => PANEL_PARENT[panel] || null,
    isLargeScreen,
  });

  // Account & Profile state
  const initialProfile = profileFormFromUser(currentUser);
  const [displayName, setDisplayName] = useState(initialProfile.displayName);
  const [bio, setBio] = useState(initialProfile.bio);
  const [gender, setGender] = useState(initialProfile.gender);

  // Birthday state broken down like signup (Month dropdown, Day input, Year input)
  const [birthYear, setBirthYear] = useState(initialProfile.birthYear);
  const [birthMonth, setBirthMonth] = useState(initialProfile.birthMonth);
  const [birthDay, setBirthDay] = useState(initialProfile.birthDay);
  const [dobAttempted, setDobAttempted] = useState(false);

  // Single controlled object, same shape the signup step uses.
  const [academic, setAcademic] = useState(() => academicFromUser(currentUser));
  const [academicAttempted, setAcademicAttempted] = useState(false);
  const { courses: academicCourses } = useAcademicCatalog();

  // Interests state
  const [selectedInterests, setSelectedInterests] = useState(currentUser?.interests || []);
  const [showCollegeOnProfile, setShowCollegeOnProfile] = useState(
    currentUser?.settings?.showCollegeOnProfile !== false,
  );
  const [initialPanelInterests, setInitialPanelInterests] = useState(currentUser?.interests || []);

  // Which form's Save is in flight; the panel stays open while it is.
  const [savingPanel, setSavingPanel] = useState(null);

  // Security state
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  // The same show/hide behaviour every other password field in the app uses —
  // one implementation, including the caret preservation across the type swap.
  const currentPw = usePasswordVisibility();
  const newPw = usePasswordVisibility();
  const confirmPw = usePasswordVisibility();
  const hidePasswords = [currentPw.hide, newPw.hide, confirmPw.hide];
  const hidePasswordsRef = useRef(hidePasswords);
  useEffect(() => {
    hidePasswordsRef.current = hidePasswords;
  });
  const [passwordErrors, setPasswordErrors] = useState({});
  const [isSavingPassword, setIsSavingPassword] = useState(false);

  /**
   * Opening a form shows what is saved, every time.
   *
   * Settings stays mounted across /settings/:panel, so a form's state outlived
   * the panel: an edit abandoned without saving was still in the fields when
   * the panel was opened again, looking saved until a reload put the real
   * value back. Each form is now re-read from the account when it opens.
   * The password fields, and anything they revealed, are simply cleared.
   */
  useEffect(() => {
    const user = currentUserRef.current;
    if (activePanel === 'profile') {
      const form = profileFormFromUser(user);
      setDisplayName(form.displayName);
      setBio(form.bio);
      setGender(form.gender);
      setBirthYear(form.birthYear);
      setBirthMonth(form.birthMonth);
      setBirthDay(form.birthDay);
      setDobAttempted(false);
    } else if (activePanel === 'academic') {
      setAcademic(academicFromUser(user));
      setAcademicAttempted(false);
    } else if (activePanel === 'interests') {
      const saved = user?.interests || [];
      setSelectedInterests(saved);
      // The order the pills are laid out in: saved choices first, fixed while
      // the panel is open so a tap does not move the pill under the finger.
      setInitialPanelInterests(saved);
      // Re-read the saved value on opening, so a switch initialised before the
      // account's settings arrived cannot show the wrong state.
      setShowCollegeOnProfile(user?.settings?.showCollegeOnProfile !== false);
    }
    if (activePanel !== 'security') {
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setPasswordErrors({});
      hidePasswordsRef.current.forEach((hide) => hide());
    }
  }, [activePanel]);

  // Privacy & notifications state
  const settingsObj = currentUser?.settings || currentUser?.preferences || {};
  const [emailNotifs, setEmailNotifs] = useState(settingsObj.emailNotifs ?? true);
  const [privateProfile, setPrivateProfile] = useState(settingsObj.privateProfile ?? false);

  // Presence settings
  const [showOnlineStatus, setShowOnlineStatus] = useState(settingsObj.showOnlineStatus ?? true);
  const [readReceipts, setReadReceipts] = useState(settingsObj.readReceipts ?? true);

  // Clear cached data: the row's usage line, and its confirmation.
  const [cacheUsage, setCacheUsage] = useState(null);
  const [showClearCache, setShowClearCache] = useState(false);
  const [clearingCache, setClearingCache] = useState(false);

  const refreshCacheUsage = async () => {
    try {
      setCacheUsage(formatCacheUsage(await estimateCacheUsage()));
    } catch {
      setCacheUsage(null);
    }
  };

  // Measured when the list holding the row opens, not on every settings visit.
  useEffect(() => {
    if (openCategory !== 'privacy-security') return undefined;
    let live = true;
    estimateCacheUsage()
      .then((usage) => { if (live) setCacheUsage(formatCacheUsage(usage)); })
      .catch(() => { if (live) setCacheUsage(null); });
    return () => { live = false; };
  }, [openCategory]);

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
            const form = profileFormFromUser(user);
            setDisplayName(form.displayName);
            setBio(form.bio);
            setGender(form.gender);
            if (user.birthday) {
              setBirthYear(form.birthYear);
              setBirthMonth(form.birthMonth);
              setBirthDay(form.birthDay);
            }
            setAcademic(academicFromUser(user));
            setSelectedInterests(user.interests || []);
            updateCurrentUserRef.current?.({ ...currentUserRef.current, ...user });
          }
          const s = settingsRes || user?.settings || user?.preferences;
          if (s) {
            setEmailNotifs(s.emailNotifs ?? true);
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
    // Runs once on mount, to seed fresh data without re-fetching on user
    // updates; what it needs from the account is read through refs.
  }, []);

  /**
   * An on/off preference saves the moment it is switched, the way the push
   * switches beside it always have. These used to wait for a Save button the
   * user had to find, so a switch could sit flipped on screen, unsaved, and
   * flip back on the next reload. There is no unsaved switch any more.
   *
   * Optimistic: the switch moves at once, and moves back with an error if the
   * server refuses. Only the latest change to a setting may put it back, so a
   * slow failure cannot undo a later tap.
   */
  const toggleSeq = useRef({});
  const toggleConfirmed = useRef({});
  const saveToggle = (key, next, setLocal, { invalidate = [], errorText }) => {
    if (!(key in toggleConfirmed.current)) toggleConfirmed.current[key] = !next;
    const seq = (toggleSeq.current[key] || 0) + 1;
    toggleSeq.current[key] = seq;
    setLocal(next);

    const fail = (err) => {
      if (toggleSeq.current[key] !== seq) return;
      const saved = toggleConfirmed.current[key];
      setLocal(saved);
      // updateSettings writes the account before the request and keeps it on a
      // failure; put the saved value back so nothing else reads the refused one.
      const user = currentUserRef.current;
      if (user && updateCurrentUser) {
        const settings = { ...(user.settings || {}), [key]: saved };
        updateCurrentUser({ ...user, settings, preferences: { ...(user.preferences || {}), [key]: saved } });
      }
      if (err) console.error(`Failed to save ${key}:`, err);
      showToast((err && err.message) || errorText, 'error');
    };

    Promise.resolve(updateSettings({ [key]: next }))
      .then((ok) => {
        // AuthContext reports a refused save as `false` rather than throwing.
        if (ok === false) return fail(null);
        toggleConfirmed.current[key] = next;
        for (const queryKey of invalidate) queryClient.invalidateQueries({ queryKey });
        return undefined;
      })
      .catch(fail);
  };

  // Who can see you: profiles, the campus directory (['users', 'campus', limit])
  // and chats all show it.
  const VISIBILITY_QUERIES = [['profile'], ['users'], ['conversations']];

  /** Has the open form been edited away from what is saved? */
  const profileDirty = isProfileFormDirty(
    { displayName, bio, gender, birthYear, birthMonth, birthDay },
    profileFormFromUser(currentUser),
  );
  const savedAcademic = academicFromUser(currentUser);
  const academicDirty = academic.course !== savedAcademic.course
    || academic.branch !== savedAcademic.branch
    || academic.passingYear !== savedAcademic.passingYear;
  const interestsDirty = !sameSet(selectedInterests, currentUser?.interests || []);
  const passwordDirty = Boolean(currentPassword || newPassword || confirmPassword);
  const hasUnsavedChanges = (activePanel === 'profile' && profileDirty)
    || (activePanel === 'academic' && academicDirty)
    || (activePanel === 'interests' && interestsDirty)
    || (activePanel === 'security' && passwordDirty);

  /**
   * Leaving a form with unsaved edits asks first: the header's Back, and any
   * row in the list (on the desktop split the list stays beside the form, one
   * click from throwing the edits away). Hardware and browser Back are not
   * intercepted; they belong to the system.
   */
  const [pendingLeave, setPendingLeave] = useState(null);
  const requestLeave = (leave) => {
    if (hasUnsavedChanges) {
      setPendingLeave(() => leave);
      return;
    }
    leave();
  };

  // On a phone each level is its own screen, so it slides in over the one it
  // was opened from and back out on Back, exactly as Settings itself, a chat
  // and a profile do (shared/lib/navigation/pageTransition.js); it used to
  // swap in place with no motion. The split view keeps both levels on screen,
  // so there it stays a plain navigation.
  const openPanel = (next) => requestLeave(() => (isLargeScreen
    ? navigate(`/settings/${next}`)
    : openPage(`/settings/${next}`)));

  /**
   * Save keeps you where you are.
   *
   * Every branch here used to close the panel, sending the user up to its
   * category or out to the root as if the page were done with them. The panel
   * now stays open, shows the saved values, and says so with a toast. The
   * request is awaited, so "saved" is only said once it is true; a refusal
   * leaves the edits in the form to try again.
   */
  const handleSave = async () => {
    if (savingPanel) return;
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
      // Gender is only sent when chosen: clearing it is not offered, and an
      // API that predates the field must not receive it unasked.
      const genderPatch = gender ? { gender } : {};
      setSavingPanel('profile');
      try {
        await updateProfile({ displayName, bio, birthday: finalBirthday, ...genderPatch });
        // The form now shows exactly what was stored ("07" reads back as "7").
        const stored = birthdayParts(finalBirthday);
        setBirthYear(stored.birthYear);
        setBirthMonth(stored.birthMonth);
        setBirthDay(stored.birthDay);
        if (gender && currentUser?.profileCompletion?.needsGender && updateCurrentUser) {
          updateCurrentUser({
            ...currentUser,
            displayName,
            bio,
            birthday: finalBirthday,
            ...genderPatch,
            profileCompletion: { ...currentUser.profileCompletion, needsGender: false },
          });
        }
        queryClient.invalidateQueries({ queryKey: ['profile'] });
        showToast('Profile updated', 'success');
      } catch (err) {
        console.error('Failed to update profile:', err);
        showToast(err?.message || "Couldn't save profile", 'error');
      } finally {
        setSavingPanel(null);
      }
    } else if (activePanel === 'academic') {
      // The panel stays open on an incomplete selection so the user can see
      // which field is wrong. The server re-validates regardless.
      setAcademicAttempted(true);
      const academicError = validateAcademicSelection(academicCourses, academic);
      if (academicError) {
        showToast(academicError, 'error');
        return;
      }

      setSavingPanel('academic');
      try {
        await updateProfile({
          course: academic.course,
          branch: academic.branch,
          passingYear: academic.passingYear,
        });
        queryClient.invalidateQueries({ queryKey: ['profile'] });
        showToast('Academic details updated', 'success');
      } catch (err) {
        console.error('Failed to update academic info:', err);
        showToast(err?.message || "Couldn't save academic details", 'error');
      } finally {
        setSavingPanel(null);
      }
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
        hidePasswordsRef.current.forEach((hide) => hide());
        showToast('Password changed', 'success');
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
    } else if (activePanel === 'interests') {
      setSavingPanel('interests');
      try {
        await updateProfile({ interests: selectedInterests });
        queryClient.invalidateQueries({ queryKey: ['profile'] });
        showToast('Interests saved', 'success');
      } catch (err) {
        console.error('Failed to update interests:', err);
        showToast(err?.message || "Couldn't save interests", 'error');
      } finally {
        setSavingPanel(null);
      }
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
    email: 'Email',
    academic: 'Academic Info',
    security: 'Change Password',
    privacy: 'Visibility Settings',
    notifications: 'Notifications',
    interests: 'Interests & Topics',
    'blocked-contacts': 'Blocked Contacts',
    devices: 'Devices',
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
  const settingsRow = ({ key, icon: Icon, label, description, dot, onClick, active, danger, chevron = true }) => (
    <button
      key={key}
      className={`${styles.row} ${active ? styles.rowActive : ''} ${danger ? styles.rowDanger : ''}`}
      onClick={onClick}
    >
      <span className={styles.rowIcon}>
        <Icon size={20} strokeWidth={2} />
      </span>
      <span className={styles.rowText}>
        <span className={styles.rowLabel}>
          {label}
          {dot && <ActionDot />}
        </span>
        {description && <span className={styles.rowDesc}>{description}</span>}
      </span>
      {chevron && (
        <span className={styles.rowChev}><ChevronRight size={18} strokeWidth={2.25} /></span>
      )}
    </button>
  );

  const handleClearCache = async () => {
    if (clearingCache) return;
    setClearingCache(true);
    try {
      // Reports a partial failure rather than throwing; either way is a failure.
      const result = await clearCachedData(queryClient);
      if (result && result.ok === false) throw new Error('partial');
      showToast('Cached data cleared', 'success');
      setShowClearCache(false);
      void refreshCacheUsage();
    } catch {
      showToast("Couldn't clear cached data", 'error');
    } finally {
      setClearingCache(false);
    }
  };

  /** The one-line prompt under a row inside Account, or null. */
  const rowAction = (panel) => {
    if (panel === 'email' && profileAction.needsPersonalEmail) return 'Add a personal email';
    if (panel === 'profile' && profileAction.needsGender) return 'Add your gender';
    return null;
  };

  const runItemAction = (action) => {
    if (action === 'cookies') return openCookiePreferences();
    if (action === 'clear-cache') return setShowClearCache(true);
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
              // Account carries the dot when anything inside it is waiting.
              dot: entry.slug === 'account' && profileAction.any,
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
                dot: Boolean(rowAction(item.panel)),
                description: item.action === 'clear-cache'
                  ? cacheUsage
                  : rowAction(item.panel),
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
          <label className={styles.inputLabel} htmlFor="settings-gender">Gender</label>
          <CustomSelect
            id="settings-gender"
            value={gender}
            onChange={setGender}
            placeholder="Select gender"
            options={GENDER_OPTIONS}
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
      <button className={styles.saveBtn} onClick={handleSave} disabled={savingPanel === 'profile'}>
        {savingPanel === 'profile' ? 'Saving…' : 'Save Changes'}
      </button>
    </div>
  );

  const campusActive = isAffiliationActive(currentUser?.campusAffiliation);

  const academicPanel = (
    <div className={`${styles.body} animate-in`}>
      <div className={styles.lockedInfoCard}>
        <div className={styles.lockedField}>
          <span className={styles.lockedLabel}>College Name</span>
          {/* The college a verified college email ties this account to, and
              only while that affiliation is active: a removed or revoked one,
              or a college typed at signup, is not a verified college. */}
          <span className={styles.lockedValue}>
            {(campusActive && currentUser?.campusAffiliation?.collegeName) || 'Not verified'}
          </span>
        </div>
        <div className={styles.lockedFieldDivider} />
        <div className={styles.lockedField}>
          <span className={styles.lockedLabel}>College Email</span>
          <span className={styles.lockedValue}>
            {/* The verified college email (masked by the server), never the
                login email: since personal emails exist the two can differ. */}
            {(campusActive && (currentUser?.campusAffiliation?.email || currentUser?.collegeEmail)) ||
              'Not verified'}
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
      <button className={styles.saveBtn} onClick={handleSave} disabled={savingPanel === 'academic'}>
        {savingPanel === 'academic' ? 'Saving…' : 'Save Academic Info'}
      </button>
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
            <input type="checkbox" checked={privateProfile} onChange={e => saveToggle('privateProfile', e.target.checked, setPrivateProfile, { invalidate: VISIBILITY_QUERIES, errorText: "Couldn't save privacy settings" })} />
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
            <input type="checkbox" checked={showOnlineStatus} onChange={e => saveToggle('showOnlineStatus', e.target.checked, setShowOnlineStatus, { invalidate: VISIBILITY_QUERIES, errorText: "Couldn't save privacy settings" })} />
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
            <input type="checkbox" checked={readReceipts} onChange={e => saveToggle('readReceipts', e.target.checked, setReadReceipts, { invalidate: VISIBILITY_QUERIES, errorText: "Couldn't save privacy settings" })} />
            <span className={styles.slider} />
          </label>
        </div>
      </div>
    </div>
  );

  // Self-contained: it owns its own fetching and needs nothing from the
  // settings form state around it.
  const blockedContactsPanel = <BlockedContacts />;
  const verificationPanel = <SettingsVerificationPanel />;
  const emailPanel = <SettingsEmailPanel />;
  const helpPanel = <SettingsHelpPanel />;

  // Wrapped in the same body/group scaffolding every other panel uses, so it
  // scrolls and gutters identically.
  const devicesPanel = (
    <div className={`${styles.body} animate-in`}>
      <DevicesPanel />
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
            <input type="checkbox" checked={emailNotifs} onChange={e => saveToggle('emailNotifs', e.target.checked, setEmailNotifs, { errorText: "Couldn't save notification settings" })} />
            <span className={styles.slider} />
          </label>
        </div>
        <div className={styles.nestedDivider} />
        {/* Saves itself as it changes, like the switch above. */}
        <PushNotificationsSettings />
      </div>
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

        <label className={styles.collegeTagToggle}>
          <span className={styles.collegeTagText}>
            <span className={styles.collegeTagTitle}>Show college and course</span>
            <span className={styles.collegeTagHint}>Display them as tags on your profile</span>
          </span>
          <input
            type="checkbox"
            role="switch"
            checked={showCollegeOnProfile}
            onChange={(e) => saveToggle('showCollegeOnProfile', e.target.checked, setShowCollegeOnProfile, { invalidate: [['profile']], errorText: "Couldn't save the college tag setting" })}
          />
        </label>

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
          disabled={savingPanel === 'interests'}
        >
          {savingPanel === 'interests' ? 'Saving…' : 'Save Interests'}
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
          onClick={() => requestLeave(goUp)}
        >
          <ChevronLeft size={20} />
        </button>

        <span className={styles.topBarTitle}>
          {helpView
            ? HELP_VIEW_TITLES[helpView]
            : activePanel
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
            {activePanel === 'email' && emailPanel}
            {activePanel === 'academic' && academicPanel}
            {activePanel === 'security' && securityPanel}
            {activePanel === 'privacy' && privacyPanel}
            {activePanel === 'notifications' && notificationsPanel}
            {activePanel === 'interests' && interestsPanel}
            {activePanel === 'blocked-contacts' && blockedContactsPanel}
            {activePanel === 'verification' && verificationPanel}
            {activePanel === 'devices' && devicesPanel}
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
          {activePanel === 'email' && emailPanel}
          {activePanel === 'academic' && academicPanel}
          {activePanel === 'security' && securityPanel}
          {activePanel === 'privacy' && privacyPanel}
          {activePanel === 'notifications' && notificationsPanel}
          {activePanel === 'interests' && interestsPanel}
          {activePanel === 'blocked-contacts' && blockedContactsPanel}
          {activePanel === 'verification' && verificationPanel}
          {activePanel === 'devices' && devicesPanel}
          {activePanel === 'help' && helpPanel}
        </>
      )}

      {showClearCache && (
        <ConfirmModal
          centered
          title="Clear cached data?"
          desc="Frees space on this device. You stay signed in and nothing you haven't sent is lost."
          onCancel={() => { if (!clearingCache) setShowClearCache(false); }}
          onConfirm={handleClearCache}
          confirmText={clearingCache ? 'Clearing…' : 'Clear'}
          cancelText="Cancel"
          icon={<Smartphone size={24} strokeWidth={2} />}
        />
      )}

      {pendingLeave && (
        <ConfirmModal
          centered
          isDestructive
          title="Discard changes?"
          desc="You have unsaved changes. If you leave now, they won't be saved."
          confirmText="Discard"
          cancelText="Keep editing"
          onCancel={() => setPendingLeave(null)}
          onConfirm={() => {
            const leave = pendingLeave;
            setPendingLeave(null);
            runWhenOverlaysSettled(leave);
          }}
        />
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
