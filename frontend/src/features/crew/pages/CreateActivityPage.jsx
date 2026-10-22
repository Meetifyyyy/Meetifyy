import { useState, useEffect, useLayoutEffect, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate, useLocation } from 'react-router-dom';
import { useSmartBack } from '@shared/hooks/useSmartBack';
import { useOverlayBack } from '@shared/hooks/useOverlayBack';
import { useScrollLock } from '@shared/hooks/useScrollLock';
import styles from './CreateActivityPage.module.css';

import ImageSearchModal from '@shared/components/modals/ImageSearchModal';
import InviteFriendsModal from '@shared/components/modals/InviteFriendsModal';
import { openVerificationModal } from '@shared/stores/verificationModalStore';
import { commitDraftImage, removeDraftImage } from '@shared/utils/draftImageCache';
import { useAmbientTint } from '@shared/hooks/useAmbientTint';
import { useSystemBars } from '@shared/hooks/useSystemBars';

import {
  Send,
  MapPin,
  Users,
  Pencil,
  CalendarClock,
  ChevronLeft,
  ChevronRight,
  X,
  ChevronsUpDown,
  Eye,
  Loader2,
} from '@shared/components/icons';
import { useQueryClient } from '@tanstack/react-query';
import { activitiesApi } from '@shared/api/apiClient';
import { useAuth } from '@shared/context/AuthContext';
import { showToast } from '@shared/utils/toast';
import { insertActivityIntoCache, replaceActivityInCache } from '@shared/utils/mapActivity';
import { idbDelete } from '@shared/lib/idb';
import { createSubmissionKey } from '@shared/lib/idempotencyKey';
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const DAYS_OF_WEEK = ['S','M','T','W','T','F','S'];

function buildTimeSlots() {
  const slots = [];
  for (let h = 0; h < 24; h++) {
    for (let m = 0; m < 60; m += 5) {
      const hour12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
      const ampm = h < 12 ? 'am' : 'pm';
      slots.push({ h, m, label: `${hour12}:${String(m).padStart(2, '0')}${ampm}` });
    }
  }
  return slots;
}
const TIME_SLOTS = buildTimeSlots();


/**
 * The three activity visibility modes, in the order they are offered.
 *
 * These labels are presentation only — the backend stores and enforces the
 * corresponding `visibility` value, which is the single authority on who can
 * discover, view or join an activity.
 */
const VISIBILITY_OPTIONS = [
  {
    value: 'Anyone',
    label: 'Anyone',
    description: 'Anyone can discover, view, and join this activity.',
  },
  {
    value: 'College',
    label: 'College',
    description:
      'Only people from your college can discover and join. Invited people from other colleges can also join.',
  },
  {
    value: 'Private',
    label: 'Private',
    description: 'Only people you invite can view and join this activity.',
  },
];

const VISIBILITY_BY_OPTION = {
  Anyone: 'PUBLIC',
  College: 'COLLEGE_ONLY',
  Private: 'PRIVATE',
  // Retired label, still mapped: an unrecognised option falls back to PUBLIC,
  // and silently publishing a would-be private activity to everyone is the one
  // failure mode this selector must not have.
  'No one': 'PRIVATE',
};

/* ─── Date & Time Modal ─── */
function DateTimeModal({ formData, set, onClose }) {
  const [activeTab, setActiveTab] = useState('start'); // 'start' or 'end'
  const isStart = activeTab === 'start';

  // Previously unwired: hardware/browser Back navigated away from the page
  // instead of dismissing the sheet, and Escape did nothing.
  useOverlayBack(true, onClose);
  useScrollLock(true);
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const today = new Date();
  const [viewYear, setViewYear] = useState(isStart ? (formData.startDateYear || today.getFullYear()) : (formData.endDateYear || today.getFullYear()));
  const [viewMonth, setViewMonth] = useState((isStart ? (formData.startDateMonth || (today.getMonth() + 1)) : (formData.endDateMonth || (today.getMonth() + 1))) - 1);
  const timeListRef = useRef(null);

  useEffect(() => {
    const today = new Date();
    if (isStart) {
      setViewYear(formData.startDateYear || today.getFullYear());
      setViewMonth((formData.startDateMonth || (today.getMonth() + 1)) - 1);
    } else {
      setViewYear(formData.endDateYear || today.getFullYear());
      setViewMonth((formData.endDateMonth || (today.getMonth() + 1)) - 1);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only sync view month/year when switching tabs, not while user navigates months
  }, [activeTab]);

  const selectedHour = isStart ? formData.startTimeHour : formData.endTimeHour;
  const selectedMinute = isStart ? formData.startTimeMinute : formData.endTimeMinute;
  const selectedAmPm = isStart ? formData.startTimeAmPm : formData.endTimeAmPm;

  const hasTimeSelected = !!selectedHour;

  const selectedH = hasTimeSelected
    ? (selectedAmPm === 'PM'
      ? (parseInt(selectedHour, 10) === 12 ? 12 : parseInt(selectedHour, 10) + 12)
      : (parseInt(selectedHour, 10) === 12 ? 0 : parseInt(selectedHour, 10)))
    : null;
  const selectedM = hasTimeSelected ? parseInt(selectedMinute, 10) : null;
  const selectedSlotIdx = hasTimeSelected ? TIME_SLOTS.findIndex(s => s.h === selectedH && s.m === selectedM) : -1;

  useLayoutEffect(() => {
    if (timeListRef.current && selectedSlotIdx >= 0) {
      const el = timeListRef.current.children[selectedSlotIdx];
      if (el) el.scrollIntoView({ block: 'center', behavior: 'auto' });
    }
  }, [activeTab, selectedSlotIdx]);

  const firstDay = new Date(viewYear, viewMonth, 1).getDay();
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();

  const prevMonth = () => {
    if (viewMonth === 0) { setViewMonth(11); setViewYear(y => y - 1); }
    else setViewMonth(m => m - 1);
  };
  const nextMonth = () => {
    if (viewMonth === 11) { setViewMonth(0); setViewYear(y => y + 1); }
    else setViewMonth(m => m + 1);
  };

  const updateStartDate = (newStart) => {
    const currentStart = getParsedDate(formData.startDateYear, formData.startDateMonth, formData.startDateDay, formData.startTimeHour, formData.startTimeMinute, formData.startTimeAmPm);
    const currentEnd   = getParsedDate(formData.endDateYear,   formData.endDateMonth,   formData.endDateDay,   formData.endTimeHour,   formData.endTimeMinute,   formData.endTimeAmPm);

    const MIN_MS  = 5  * 60 * 1000;   // 5 minutes
    const DEF_MS  = 60 * 60 * 1000;   // 1 hour (used when end would be invalid)
    const MAX_MS  = 30 * 24 * 60 * 60 * 1000;

    // Preserve existing duration — only reset to 1 hr if new start overtakes end
    let duration = (currentEnd && currentStart) ? currentEnd.getTime() - currentStart.getTime() : DEF_MS;
    const newEndCandidate = new Date(newStart.getTime() + duration);

    let newEnd;
    if (currentEnd && newEndCandidate.getTime() - newStart.getTime() >= MIN_MS) {
      // End is still safely ahead — keep the same duration
      newEnd = newEndCandidate;
    } else {
      // New start overtook (or nearly overtook) end — push end 1 hr ahead
      newEnd = new Date(newStart.getTime() + DEF_MS);
    }

    // Cap at 30-day maximum
    if (newEnd.getTime() - newStart.getTime() > MAX_MS) {
      newEnd = new Date(newStart.getTime() + MAX_MS);
    }

    const s = formatToState(newStart);
    const e = formatToState(newEnd);

    set({
      startDateYear: s.y, startDateMonth: s.m, startDateDay: s.d,
      startTimeHour: s.h, startTimeMinute: s.min, startTimeAmPm: s.ap,
      endDateYear: e.y, endDateMonth: e.m, endDateDay: e.d,
      endTimeHour: e.h, endTimeMinute: e.min, endTimeAmPm: e.ap,
    });
  };

  const updateEndDate = (newEnd) => {
    const currentStart = getParsedDate(formData.startDateYear, formData.startDateMonth, formData.startDateDay, formData.startTimeHour, formData.startTimeMinute, formData.startTimeAmPm);
    if (currentStart) {
      const MIN_MS = 5 * 60 * 1000;
      if (newEnd.getTime() < currentStart.getTime() + MIN_MS) {
        newEnd = new Date(currentStart.getTime() + MIN_MS); // minimum 5 min gap
      }
      const maxEnd = new Date(currentStart.getTime() + 30 * 24 * 60 * 60 * 1000);
      if (newEnd.getTime() > maxEnd.getTime()) {
        newEnd = maxEnd;
      }
    }
    const e = formatToState(newEnd);
    set({
      endDateYear: e.y, endDateMonth: e.m, endDateDay: e.d,
      endTimeHour: e.h, endTimeMinute: e.min, endTimeAmPm: e.ap,
    });
  };

  // A day and a time can be chosen in either order, and neither implies the
  // other. When only one half exists it is recorded on its own and nothing is
  // derived from it — inventing the missing half is precisely the pre-filling
  // this form is not supposed to do. The coupling below (end follows start,
  // 5-minute minimum, 30-day cap) needs two real datetimes, so it only runs
  // once the second half arrives.
  const pickDay = (day) => {
    if (isStart) {
      if (!formData.startTimeHour) {
        set({ startDateYear: viewYear, startDateMonth: viewMonth + 1, startDateDay: day });
        return;
      }
      const newStart = getParsedDate(viewYear, viewMonth + 1, day, formData.startTimeHour, formData.startTimeMinute, formData.startTimeAmPm);
      if (newStart) updateStartDate(newStart);
    } else {
      if (!formData.endTimeHour) {
        set({ endDateYear: viewYear, endDateMonth: viewMonth + 1, endDateDay: day });
        return;
      }
      const newEnd = getParsedDate(viewYear, viewMonth + 1, day, formData.endTimeHour, formData.endTimeMinute, formData.endTimeAmPm);
      if (newEnd) updateEndDate(newEnd);
    }
  };

  const pickSlot = (slot) => {
    const h12 = slot.h === 0 ? 12 : slot.h > 12 ? slot.h - 12 : slot.h;
    const hourStr = String(h12).padStart(2, '0');
    const minuteStr = String(slot.m).padStart(2, '0');
    const ampmStr = slot.h < 12 ? 'AM' : 'PM';
    
    if (isStart) {
      if (!formData.startDateDay) {
        set({ startTimeHour: hourStr, startTimeMinute: minuteStr, startTimeAmPm: ampmStr });
        return;
      }
      const newStart = getParsedDate(formData.startDateYear, formData.startDateMonth, formData.startDateDay, hourStr, minuteStr, ampmStr);
      if (newStart) updateStartDate(newStart);
    } else {
      if (!formData.endDateDay) {
        set({ endTimeHour: hourStr, endTimeMinute: minuteStr, endTimeAmPm: ampmStr });
        return;
      }
      const newEnd = getParsedDate(formData.endDateYear, formData.endDateMonth, formData.endDateDay, hourStr, minuteStr, ampmStr);
      if (newEnd) updateEndDate(newEnd);
    }
  };

  const isDayDisabled = (day) => {
    const d = new Date(viewYear, viewMonth, day); d.setHours(0,0,0,0);
    const t = new Date(); t.setHours(0,0,0,0);
    if (isStart) {
      return d < t;
    } else {
      const currentStart = getParsedDate(formData.startDateYear, formData.startDateMonth, formData.startDateDay, formData.startTimeHour, formData.startTimeMinute, formData.startTimeAmPm);
      if (!currentStart) return d < t;
      const startDay = new Date(currentStart); startDay.setHours(0,0,0,0);
      const maxEndDay = new Date(currentStart.getTime() + 30 * 24 * 60 * 60000); maxEndDay.setHours(23,59,59,999);
      return d < startDay || d > maxEndDay;
    }
  };

  const isSelected = (day) => {
    if (isStart) {
      return formData.startDateYear === viewYear && formData.startDateMonth === viewMonth + 1 && formData.startDateDay === day;
    } else {
      return formData.endDateYear === viewYear && formData.endDateMonth === viewMonth + 1 && formData.endDateDay === day;
    }
  };

  const fmtDate = (isStartVal) => {
    const y = isStartVal ? formData.startDateYear : formData.endDateYear;
    const m = isStartVal ? formData.startDateMonth : formData.endDateMonth;
    const d = isStartVal ? formData.startDateDay : formData.endDateDay;
    if (!d) return 'Select date';
    return new Date(y, m - 1, d)
      .toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  };
  const fmtTime = (isStartVal) => {
    const h = isStartVal ? formData.startTimeHour : formData.endTimeHour;
    const min = isStartVal ? formData.startTimeMinute : formData.endTimeMinute;
    const ampm = isStartVal ? formData.startTimeAmPm : formData.endTimeAmPm;
    if (!h) return 'Select time';
    return `${h}:${min} ${ampm}`;
  };

  const cells = [];
  for (let i = 0; i < firstDay; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  return createPortal(
    <div data-theme="dark" className={styles.modalOverlay} onClick={onClose}>
      <div className={styles.dateTimeModal} onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Date and time">
        <div className={styles.dtHeader}>
          <span className={styles.dtTitle}>Date &amp; Time</span>
          <button type="button" className={styles.dtClose} onClick={onClose}><X size={16} /></button>
        </div>

        <div className={styles.dtRangeRow}>
          <button type="button" className={`${styles.dtRangeBox} ${isStart ? styles.dtRangeBoxActive : ''}`} onClick={() => setActiveTab('start')}>
            <span className={styles.dtRangeDate}>{fmtDate(true)}</span>
            <span className={styles.dtRangeTime}>{fmtTime(true)}</span>
          </button>
          
          <ChevronRight size={16} className={styles.dtRangeArrow} />
          
          <button type="button" className={`${styles.dtRangeBox} ${!isStart ? styles.dtRangeBoxActive : ''}`} onClick={() => setActiveTab('end')}>
            <span className={styles.dtRangeDate}>{fmtDate(false)}</span>
            <span className={styles.dtRangeTime}>{fmtTime(false)}</span>
          </button>
        </div>

        <div className={styles.dtBody}>
          <div className={styles.calSection}>
            <div className={styles.calNav}>
              <span className={styles.calLabel}>{MONTHS[viewMonth]} {viewYear}</span>
              <div className={styles.calBtns}>
                <button type="button" className={styles.calBtn} onClick={prevMonth}><ChevronLeft size={14} /></button>
                <button type="button" className={styles.calBtn} onClick={nextMonth}><ChevronRight size={14} /></button>
              </div>
            </div>
            <div className={styles.calGrid}>
              {DAYS_OF_WEEK.map((d, i) => <span key={i} className={styles.calDow}>{d}</span>)}
              {cells.map((day, i) => (
                <button key={i} type="button"
                  className={`${styles.calDay} ${day && isSelected(day) ? styles.calDaySel : ''} ${day && isDayDisabled(day) ? styles.calDayOff : ''}`}
                  onClick={() => day && !isDayDisabled(day) && pickDay(day)}
                  disabled={!day || isDayDisabled(day)}
                >{day || ''}</button>
              ))}
            </div>
          </div>

          <div className={styles.timeCol}>
            <div className={styles.timeList} ref={timeListRef}>
              {TIME_SLOTS.map((slot, i) => (
                <button key={i} type="button"
                  className={`${styles.timeSlot} ${hasTimeSelected && slot.h === selectedH && slot.m === selectedM ? styles.timeSlotOn : ''}`}
                  onClick={() => pickSlot(slot)}
                >{slot.label}</button>
              ))}
            </div>
          </div>
        </div>

        <div className={styles.dtFooter}>
          <button type="button" className={styles.dtDone} onClick={onClose}>Done</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/* ─── Capacity Modal ─── */
function CapacityModal({ value, onSave, onClose }) {
  const [input, setInput] = useState(value === 999 ? '' : String(value));
  const inputRef = useRef(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  useOverlayBack(true, onClose);
  useScrollLock(true);
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const save = () => {
    const n = parseInt(input, 10);
    onSave((!n || n <= 0) ? 999 : n);
    onClose();
  };

  return createPortal(
    <div data-theme="dark" className={styles.modalOverlay} onClick={onClose}>
      <div className={styles.capModal} onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Capacity">
        <div className={styles.dtHeader}>
          <span className={styles.dtTitle}>Capacity</span>
          <button type="button" className={styles.dtClose} onClick={onClose}><X size={16} /></button>
        </div>
        <div className={styles.capBody}>
          <p className={styles.capHint}>Leave empty for unlimited</p>
          <input
            ref={inputRef}
            type="number"
            min="1"
            className={styles.capInput}
            value={input}
            onChange={e => setInput(e.target.value)}
            placeholder="∞"
            onKeyDown={e => e.key === 'Enter' && save()}
          />
        </div>
        <div className={styles.dtFooter}>
          <button type="button" className={styles.capResetBtn} onClick={() => { onSave(2); onClose(); }}>One-on-one</button>
          <button type="button" className={styles.dtDone} onClick={save}>Save</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}



/* ═══════════════════════════════
   Main Page
═══════════════════════════════ */
const getParsedDate = (y, m, d, hStr, minStr, ampm) => {
  // Half a selection is not a datetime. Without the `hStr` guard a date picked
  // before a time parsed to `new Date(y, m, d, NaN, NaN)` — an Invalid Date
  // that is still truthy, so every caller's `if (parsed)` check waved it
  // through and the whole form filled with NaN.
  if (!d || !hStr) return null;
  let h = parseInt(hStr, 10);
  if (ampm === 'PM' && h !== 12) h += 12;
  if (ampm === 'AM' && h === 12) h = 0;
  return new Date(y, m - 1, d, h, parseInt(minStr, 10));
};

const formatToState = (d) => {
  let h12 = d.getHours() % 12 || 12;
  return {
    y: d.getFullYear(), m: d.getMonth() + 1, d: d.getDate(),
    h: String(h12).padStart(2, '0'), min: String(d.getMinutes()).padStart(2, '0'),
    ap: d.getHours() < 12 ? 'AM' : 'PM'
  };
};

/**
 * The date and time a new activity opens with: nothing.
 *
 * This used to seed "now, rounded up to the next five minutes" as the start
 * and an hour later as the end. It read as a helpful default and behaved as a
 * trap — the form opened already showing a complete, publishable date and
 * time that the user had never chosen, so the quickest path through the flow
 * published an activity starting within the next five minutes. A date is a
 * decision, and a decision nobody made must not be pre-made for them.
 *
 * Everything downstream already understood the empty state: `fmtDate` and
 * `fmtTime` render "Select date"/"Select time", `canPublish` requires a
 * resolved start AND end, and `publishBlockReason` says "Choose a date and
 * time". Only the seeding was wrong.
 */
const EMPTY_DATE_TIME = {
  startDateYear: null, startDateMonth: null, startDateDay: null,
  startTimeHour: '', startTimeMinute: '', startTimeAmPm: '',
  endDateYear: null, endDateMonth: null, endDateDay: null,
  endTimeHour: '', endTimeMinute: '', endTimeAmPm: '',
};
import { DEFAULT_ACTIVITY_COVERS as RANDOM_COVERS } from '@shared/constants/activityCovers';

/**
 * Solid-colour covers used when the user explicitly removes the cover image.
 * Mid-tone hues that stay legible under the white overlay text.
 */
const COVER_COLORS = [
  '#2563eb', '#7c3aed', '#db2777', '#dc2626',
  '#ea580c', '#ca8a04', '#16a34a', '#0d9488',
  '#0284c7', '#4f46e5',
];

/**
 * Picks a random entry, avoiding an immediate repeat of `previous` whenever the
 * list has an alternative. `lastCoverPick` persists for the tab so consecutive
 * Create Activity sessions don't open on the same image twice in a row.
 */
function pickRandom(list, previous) {
  if (!list.length) return undefined;
  if (list.length === 1) return list[0];
  const pool = list.filter((item) => item !== previous);
  return pool[Math.floor(Math.random() * pool.length)];
}

const LAST_COVER_KEY = 'meetifyy_last_cover_pick';

const readLastCover = () => {
  try { return sessionStorage.getItem(LAST_COVER_KEY) || undefined; } catch (_) { return undefined; }
};

const getRandomCover = () => {
  const picked = pickRandom(RANDOM_COVERS, readLastCover());
  try { sessionStorage.setItem(LAST_COVER_KEY, picked); } catch (_) {}
  return picked;
};

const getRandomCoverColor = (previous) => pickRandom(COVER_COLORS, previous);

/**
 * Shown the moment Publish is pressed, while the activity is still being
 * created in the background. The same picker as the activity page; sending
 * waits for the creation to land, so nobody is invited to an activity that
 * then fails to exist.
 */
function ActivityCreatedModal({ creationPromise, onDone, onFailed }) {
  const invited = useRef(false);

  // The failure toast and the cache rollback already happened where the
  // promise was created; all that is left is to put the form back.
  useEffect(() => {
    let alive = true;
    creationPromise.catch(() => {
      if (alive) onFailed();
    });
    return () => { alive = false; };
  }, [creationPromise, onFailed]);

  const sendInvites = async (userIds) => {
    const activity = await creationPromise;
    const { results = [] } = (await activitiesApi.inviteFriends(activity.id, userIds)) || {};
    const sent = results.filter((r) => r.status === 'INVITED').length;
    const skipped = results.length - sent;
    invited.current = true;
    showToast(
      skipped > 0
        ? `Activity published · ${sent} invite${sent === 1 ? '' : 's'} sent, ${skipped} skipped`
        : 'Activity published · invites sent',
      'success',
    );
  };

  // Leaving without inviting still waits for the creation, so the new activity
  // is in the cache before the list behind this is shown.
  const close = async () => {
    try {
      await creationPromise;
    } catch {
      return; // onFailed is already putting the form back
    }
    if (!invited.current) showToast('Activity published', 'success');
    onDone();
  };

  return <InviteFriendsModal onSendInvites={sendInvites} onClose={close} />;
}

export default function CreateActivityPage() {
  // Fixed edge to edge on a phone, over a dark canvas in either theme: the
  // status bar and the navigation bar are drawn over by the page, with light
  // icons. (Its top bar and last field clear them; see the stylesheet.)
  useSystemBars({ status: 'transparent', statusIcons: 'light', navigation: 'transparent', navigationIcons: 'light', canvas: true });
  const navigate = useNavigate();
  const goBack = useSmartBack();
  const location = useLocation();
  const prefill = location.state?.prefill || {};
  const returnTo = location.state?.returnTo || '/crew';
  const isFromCampus = returnTo.includes('/campus') || !!location.state?.fromCampus || !!prefill.fromCampus;
  const { currentUser, collegeName } = useAuth();
  const queryClient = useQueryClient();

  const [showImageSearch, setShowImageSearch] = useState(false);
  const [showDT, setShowDT] = useState(false);
  const [showCapacity, setShowCapacity] = useState(false);
  const [showWhoCanJoin, setShowWhoCanJoin] = useState(false);
  // Starts false: with nothing pre-selected there is no value to show on the
  // Date & Time button until the user has actually been into the picker.
  const [hasInteractedWithDT, setHasInteractedWithDT] = useState(false);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [nowTs, setNowTs] = useState(() => Date.now());
  const [publishHint, setPublishHint] = useState('');
  const creationPromiseRef = useRef(null); // holds the in-flight create promise
  // One idempotency key per activity, kept across "Publish" retries after an
  // error, so a retry whose first response was lost cannot create it twice.
  const [createKey] = useState(createSubmissionKey);
  const whoCanJoinRef = useRef(null);
  // The College mode restricts an activity to the host's own college, so it is
  // only offered to users who actually have one — otherwise the activity would
  // be publishable but unreachable for everyone except the host.
  const visibilityOptions = useMemo(
    () => VISIBILITY_OPTIONS.filter(o => o.value !== 'College' || Boolean(collegeName)),
    [collegeName],
  );
  const containerRef = useRef(null);

  // Cover state is split by concern rather than crammed into one string:
  //   coverMode   — 'image' | 'color', the single source of truth for which branch renders
  //   coverImage  — the URL currently previewed (default asset, picker URL, or blob: draft)
  //   coverColor  — solid-colour fallback, only meaningful in 'color' mode
  //   coverStatus — 'idle' | 'processing' | 'error', drives the spinner/error affordance
  // A lazy initialiser keeps the random pick to one per mount: re-renders never
  // re-roll it, and a fresh navigation to the page mounts a new component.
  const [formData, setFormData] = useState(() => ({
    title: prefill.title || '',
    description: '',
    coverImage: prefill.coverImage || getRandomCover() || '',
    coverMode: 'image',
    coverColor: '',
    coverStatus: 'idle',
    coverIsDefaultAsset: !prefill.coverImage,
    ...EMPTY_DATE_TIME,
    location: '',
    slotsNeeded: 999,
    // 'No one' is the retired label for 'Private' — a persisted draft or an
    // older prefill can still carry it, so it is normalised on the way in.
    whoCanJoin: (prefill.whoCanJoin === 'No one' ? 'Private' : prefill.whoCanJoin)
      || (isFromCampus ? 'College' : 'Anyone'),
  }));

  const set = p => setFormData(prev => ({ ...prev, ...p }));

  // Monotonic token for cover selection. Every user action that changes the
  // cover bumps it; any async result carrying a stale token is discarded. This
  // is what stops a slow Image A from overwriting a later Image B, and stops a
  // completing upload from resurrecting a cover the user already removed.
  const coverTokenRef = useRef(0);
  // blob: previews we minted and still owe a revoke to.
  const ownedPreviewsRef = useRef(new Set());

  const releasePreview = (url) => {
    if (url && ownedPreviewsRef.current.has(url)) {
      ownedPreviewsRef.current.delete(url);
      removeDraftImage(url);
    }
  };

  // Revoke any outstanding blob previews when the page unmounts.
  useEffect(() => {
    const owned = ownedPreviewsRef.current;
    return () => { owned.forEach((url) => removeDraftImage(url)); owned.clear(); };
  }, []);

  const handleCoverSelect = (url) => {
    coverTokenRef.current += 1;
    setFormData((prev) => {
      // Drop the previous draft preview so blob URLs don't accumulate.
      if (prev.coverImage && prev.coverImage !== url) releasePreview(prev.coverImage);
      return {
        ...prev,
        coverMode: 'image',
        coverImage: url,
        coverColor: '',
        coverStatus: 'idle',
        coverIsDefaultAsset: RANDOM_COVERS.includes(url),
      };
    });
    if (typeof url === 'string' && url.startsWith('blob:')) ownedPreviewsRef.current.add(url);
    setShowImageSearch(false);
  };

  const handleCoverRemove = () => {
    // Bumping the token invalidates any in-flight processing for the image
    // being removed, so a late result can't restore it.
    coverTokenRef.current += 1;
    setFormData((prev) => {
      releasePreview(prev.coverImage);
      return {
        ...prev,
        coverMode: 'color',
        coverImage: '',
        coverColor: getRandomCoverColor(prev.coverColor) || COVER_COLORS[0],
        coverStatus: 'idle',
        coverIsDefaultAsset: false,
      };
    });
  };

  useAmbientTint(containerRef, {
    coverImage: formData.coverImage,
    coverColor: formData.coverColor,
    coverMode: formData.coverMode,
  });

  // Re-evaluate "is the start time in the past" on a timer, and immediately on
  // tab focus — a form left open for a while would otherwise keep offering a
  // Publish button for a slot that has already lapsed.
  useEffect(() => {
    const tick = () => setNowTs(Date.now());
    const id = setInterval(tick, 20_000);
    const onVisible = () => { if (!document.hidden) tick(); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', tick);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', tick);
    };
  }, []);

  // The hint is transient; it also clears as soon as the blocking issue is fixed.
  useEffect(() => {
    if (!publishHint) return undefined;
    const id = setTimeout(() => setPublishHint(''), 4000);
    return () => clearTimeout(id);
  }, [publishHint]);


  // close who can join dropdown on outside click
  useEffect(() => {
    if (!showWhoCanJoin) return;
    const handler = (e) => { if (whoCanJoinRef.current && !whoCanJoinRef.current.contains(e.target)) setShowWhoCanJoin(false); };
    const onKey = (e) => { if (e.key === 'Escape') setShowWhoCanJoin(false); };
    document.addEventListener('mousedown', handler);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('keydown', onKey);
    };
  }, [showWhoCanJoin]);

  const getStartDateTime = () => {
    return getParsedDate(formData.startDateYear, formData.startDateMonth, formData.startDateDay, formData.startTimeHour, formData.startTimeMinute, formData.startTimeAmPm);
  };

  const getEndDateTime = () => {
    return getParsedDate(formData.endDateYear, formData.endDateMonth, formData.endDateDay, formData.endTimeHour, formData.endTimeMinute, formData.endTimeAmPm);
  };

  const getCorrectedDates = () => {
    let currentStart = getStartDateTime();
    let currentEnd = getEndDateTime();
    const now = new Date();
    
    if (currentStart && currentStart <= now) {
      let duration = (currentEnd && currentStart) ? currentEnd.getTime() - currentStart.getTime() : 60 * 60000;
      if (duration < 60 * 60000) duration = 60 * 60000;

      const remainder = 5 - (now.getMinutes() % 5);
      currentStart = new Date(now.getTime() + (remainder === 5 ? 0 : remainder) * 60000);
      currentEnd = new Date(currentStart.getTime() + duration);

      const s = formatToState(currentStart);
      const e = formatToState(currentEnd);

      const updates = {
        startDateYear: s.y, startDateMonth: s.m, startDateDay: s.d,
        startTimeHour: s.h, startTimeMinute: s.min, startTimeAmPm: s.ap,
        endDateYear: e.y, endDateMonth: e.m, endDateDay: e.d,
        endTimeHour: e.h, endTimeMinute: e.min, endTimeAmPm: e.ap,
      };
      set(updates);
      return { startD: currentStart, endD: currentEnd, fd: { ...formData, ...updates } };
    }

    if (currentStart && currentEnd && (currentEnd.getTime() - currentStart.getTime() > 30 * 24 * 60 * 60000)) {
      currentEnd = new Date(currentStart.getTime() + 30 * 24 * 60 * 60000);
      const e = formatToState(currentEnd);
      const updates = {
        endDateYear: e.y, endDateMonth: e.m, endDateDay: e.d,
        endTimeHour: e.h, endTimeMinute: e.min, endTimeAmPm: e.ap,
      };
      set(updates);
      return { startD: currentStart, endD: currentEnd, fd: { ...formData, ...updates } };
    }

    return { startD: currentStart, endD: currentEnd, fd: formData };
  };

  const startD = getStartDateTime();
  const endD = getEndDateTime();
  const isEndBeforeStart = (startD && endD) ? endD <= startD : false;
  const isDurationOver30Days = (startD && endD) ? (endD.getTime() - startD.getTime() > 30 * 24 * 60 * 60000) : false;
  const isTitleValid = formData.title.trim().length > 0 && formData.title.trim().length <= 30;
  const isDescriptionValid = formData.description.length <= 500;
  const isLocationValid = formData.location.trim().length > 0 && formData.location.length <= 100;
  // `nowTs` ticks so a start time that lapses while the form sits open disables
  // Publish on its own, rather than only being caught on the next render.
  const isStartInPast = !!(startD && startD.getTime() <= nowTs);

  const canPublish = !!(
    isTitleValid && isDescriptionValid && isLocationValid &&
    hasInteractedWithDT && startD && endD &&
    !isStartInPast && !isEndBeforeStart && !isDurationOver30Days
  );

  // First failing rule, in the order a user would naturally fix them.
  const publishBlockReason = (() => {
    if (canPublish) return '';
    if (!formData.title.trim()) return 'Add a title to publish';
    if (formData.title.trim().length > 30) return 'Title must be 30 characters or less';
    if (!formData.location.trim()) return 'Add a location to publish';
    if (formData.location.length > 100) return 'Location must be 100 characters or less';
    if (!isDescriptionValid) return 'Description must be 500 characters or less';
    if (!hasInteractedWithDT || !startD || !endD) return 'Choose a date and time';
    if (isStartInPast) return 'Start time has passed - pick a new time';
    if (isEndBeforeStart) return 'End time must be after the start time';
    if (isDurationOver30Days) return 'An activity can run for at most 30 days';
    return 'Complete the form to publish';
  })();

  // Clear a stale hint as soon as the blocking issue is resolved. Declared here,
  // after canPublish — a dep array referencing it earlier would hit the TDZ,
  // because dep arrays are evaluated during render, not deferred like the body.
  useEffect(() => {
    if (canPublish) setPublishHint('');
  }, [canPublish]);

  const handlePublish = () => {
    if (!canPublish) {
      // The button stays clickable (aria-disabled, not disabled) so tapping it
      // can explain itself — a truly disabled button swallows the event.
      setPublishHint(publishBlockReason);
      return;
    }
    const { startD: finalStart, endD: finalEnd, fd } = getCorrectedDates();
    if (finalEnd <= finalStart) return;

    // ── Optimistic update (Twitter/Instagram pattern) ──────────────────────
    // Inject a fake activity into the cache RIGHT NOW so it appears instantly
    // everywhere in the app. No loading, no waiting.
    const tempId = `optimistic_${Date.now()}`;
    const optimisticActivity = {
      id: tempId,
      _isOptimistic: true,
      title: formData.title,
      description: formData.description,
      location: fd.location,
      coverImage: formData.coverMode === 'color' ? null : formData.coverImage,
      coverColor: formData.coverMode === 'color' ? formData.coverColor : null,
      startDate: finalStart.toISOString(),
      endDate: finalEnd.toISOString(),
      createdAt: new Date().toISOString(),
      creatorId: currentUser?.id,
      creator: currentUser,
      members: [{ userId: currentUser?.id, status: 'MEMBER', role: 'HOST', user: currentUser }],
      status: 'UPCOMING',
      maxMembers: fd.slotsNeeded === 999 ? null : fd.slotsNeeded,
    };

    // Snapshot every activities cache for rollback, not just the public feed:
    // the Crew page renders the composed discover payload
    // (['activities','discover']) and the per-scope lists
    // (['activities','for_you'|'college'|'one_on_one']), so patching only
    // ['activities'] left the new activity invisible on the page the user
    // lands on right after publishing.
    const previousCaches = queryClient.getQueriesData({ queryKey: ['activities'] });

    queryClient.setQueriesData({ queryKey: ['activities'] }, (old) =>
      insertActivityIntoCache(old, optimisticActivity));

    // Show modal immediately — user browses friends while API runs in background
    setShowInviteModal(true);

    // ── Background API call ─────────────────────────────────────────────────
    creationPromiseRef.current = (async () => {
      // Solid-colour covers carry no media at all; image covers must resolve to a
      // durable storage URL before the payload is built. A failed commit is fatal
      // to the publish — previously it fell through and persisted the blob: URL,
      // which produced activities whose cover 404'd on the next page load.
      let coverPayload;
      if (formData.coverMode === 'color') {
        coverPayload = { coverColor: formData.coverColor };
      } else if (formData.coverIsDefaultAsset && RANDOM_COVERS.includes(formData.coverImage)) {
        // Built-in default cover the user never replaced. It's already a stable
        // remote asset URL, so re-uploading it would just duplicate a shipped
        // asset into user storage on every activity created.
        coverPayload = { coverImage: formData.coverImage };
      } else if (formData.coverImage) {
        const committed = await commitDraftImage(formData.coverImage, 'activities');
        if (!committed || String(committed).startsWith('blob:')) {
          throw new Error('Cover image upload did not return a durable URL');
        }
        coverPayload = { coverImage: committed };
      } else {
        coverPayload = {};
      }

      const body = {
        title: formData.title,
        description: formData.description,
        location: fd.location,
        maxMembers: fd.slotsNeeded === 999 ? null : fd.slotsNeeded,
        ...coverPayload,
        visibility: VISIBILITY_BY_OPTION[fd.whoCanJoin] || 'PUBLIC',
        shareToCampus: fd.whoCanJoin === 'College',
        startDate: finalStart.toISOString(),
        endDate: finalEnd.toISOString(),
      };
      const created = await activitiesApi.create(body, { idempotencyKey: createKey.keyFor(body) });
      createKey.done();
      return created;
    })().then((realActivity) => {
      // Swap the optimistic entry for the real one everywhere it was inserted.
      queryClient.setQueriesData({ queryKey: ['activities'] }, (old) =>
        replaceActivityInCache(old, tempId, realActivity));

      // The optimistic entry keeps the page from looking empty; the server is
      // the authority on which section an activity belongs to under its
      // visibility settings, so refetch rather than try to reproduce that
      // scoping here. This covers every scope and the discover payload at once.
      idbDelete('activities', 'all_page1');
      queryClient.invalidateQueries({ queryKey: ['activities'] });
      return realActivity;
    }).catch((err) => {
      // Rollback — restore every cache the optimistic entry was written into
      previousCaches.forEach(([key, data]) => queryClient.setQueryData(key, data));
      console.error('Failed to create activity', err);
      const raw = String(err?.message || '');
      // Surface the server's own validation text (e.g. "Start date must be in
      // the future") instead of burying it under a generic message — these are
      // exactly the conditions the user can act on.
      const isValidationError = /must be|cannot exceed|Invalid |not open|already/i.test(raw);
      showToast(
        raw.includes('durable URL')
          ? 'Cover image upload failed. Please reselect the image and try again.'
          : isValidationError
            ? raw
            : 'Could not create the activity. Please try again.',
        'error',
      );
      throw err;
    });
  };

  const fmtDateTime = () => {
    const startD = getStartDateTime();
    const endD = getEndDateTime();
    if (!startD) return 'Select date & time';
    
    const formatTime = (h, m, ampm) => `${parseInt(h, 10)}:${m} ${ampm}`;
    const formatMonthDay = (date) => date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const formatFullDate = (date) => date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

    const startTimeStr = formatTime(formData.startTimeHour, formData.startTimeMinute, formData.startTimeAmPm);
    if (!endD) return `${formatFullDate(startD)} • ${startTimeStr}`;

    const endTimeStr = formatTime(formData.endTimeHour, formData.endTimeMinute, formData.endTimeAmPm);

    const isSameDay = startD.toDateString() === endD.toDateString();
    const isSameYear = startD.getFullYear() === endD.getFullYear();

    if (isSameDay) {
      return `${formatMonthDay(startD)} • ${startTimeStr} – ${endTimeStr}`;
    } else if (isSameYear) {
      return `${formatMonthDay(startD)} • ${startTimeStr} → ${formatMonthDay(endD)} • ${endTimeStr}`;
    } else {
      return `${formatFullDate(startD)} • ${startTimeStr} → ${formatFullDate(endD)} • ${endTimeStr}`;
    }
  };

  // Hoisted above the `showInviteModal` early return below: as a hook it must
  // run on every render, and it previously sat after that return.
  useEffect(() => {
    if (currentUser && currentUser.verificationStatus !== 'VERIFIED') {
      openVerificationModal('Verify with a live selfie to create activities.');
      navigate(returnTo || '/crew', { replace: true });
    }
  }, [currentUser, navigate, returnTo]);

  const isColorCover = formData.coverMode === 'color';
  const hasCoverImage = formData.coverMode === 'image' && !!formData.coverImage;

  if (showInviteModal) {
    return (
      <ActivityCreatedModal
        creationPromise={creationPromiseRef.current}
        onFailed={() => setShowInviteModal(false)}
        onDone={() => navigate(returnTo, { replace: true })}
      />
    );
  }


  if (currentUser?.verificationStatus !== 'VERIFIED') {
    return null;
  }

  return (
    <main ref={containerRef} data-theme="dark" className={styles.root}>
        {/* Blurred ambient background from cover image */}
        {/* Ambient cover wash. Renders in both cover modes so the page always
            reflects the current cover — a solid colour bleeds into the backdrop
            exactly the way an image does, instead of falling back to flat black. */}
        <div className={styles.ambientBg} aria-hidden="true">
          {hasCoverImage ? (
            <img
              src={formData.coverImage}
              alt=""
              className={styles.ambientImg}
              onError={(e) => {
                e.currentTarget.style.display = 'none';
              }}
            />
          ) : isColorCover ? (
            <div className={styles.ambientColor} style={{ background: formData.coverColor }} />
          ) : null}
          <div className={styles.ambientGlass} />
        </div>
        
        <div className={styles.glass}>
        {/* ── Top bar ── */}
        <header className={styles.topBar}>
          <div className={styles.headerLeft}>
            <button className={styles.backBtn} onClick={() => goBack(returnTo)} aria-label="Go back">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                <line x1="19" y1="12" x2="5" y2="12" />
                <polyline points="12 19 5 12 12 5" />
              </svg>
            </button>
            <span className={styles.headerTitle}>New activity</span>
          </div>

          <div className={styles.rightActions}>
            <button
              className={`${styles.publishBtn} ${canPublish ? styles.publishOn : ''}`}
              onClick={handlePublish}
              aria-disabled={!canPublish}
              aria-describedby={publishHint ? 'publish-hint' : undefined}
            >
              <Send size={13} />
              <span>Publish</span>
            </button>
            {publishHint && (
              <span id="publish-hint" className={styles.publishHint} role="status">
                {publishHint}
              </span>
            )}
          </div>
        </header>

        {/* ── Content ── */}
        <div className={styles.body}>

          {/* Mobile Title (hidden on desktop) */}
          <div className={styles.mobileTitle}>
            <input
              type="text"
              className={styles.fieldInput}
              value={formData.title}
              onChange={e => set({ title: e.target.value })}
              placeholder="Untitled activity"
              maxLength={30}
            />
          </div>

          {/* LEFT — 1:1 image */}
          <div className={styles.imgCol}>
            <div
              className={styles.imgSquare}
              style={isColorCover ? { background: formData.coverColor } : undefined}
            >
              {hasCoverImage && (
                <img
                  src={formData.coverImage}
                  alt="Cover"
                  className={styles.coverImg}
                  onError={(e) => {
                    e.currentTarget.style.display = 'none';
                  }}
                />
              )}
              {formData.coverStatus === 'processing' && (
                <div className={styles.coverBusy} role="status" aria-live="polite">
                  <Loader2 size={20} className={styles.coverSpinner} />
                </div>
              )}
              <div className={styles.coverActions}>
                <button
                  type="button"
                  className={styles.changeBtn}
                  onClick={() => setShowImageSearch(true)}
                >
                  <Pencil size={11} />
                  <span>{hasCoverImage ? 'Change' : 'Add'}</span>
                </button>
                {hasCoverImage && (
                  <button
                    type="button"
                    className={styles.removeBtn}
                    onClick={handleCoverRemove}
                    aria-label="Remove cover image"
                    title="Remove cover image"
                  >
                    <X size={13} />
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* RIGHT — form fields */}
          <div className={styles.formCol}>

            {/* Desktop Title (hidden on mobile) */}
            <div className={styles.desktopTitle}>
              <input
                type="text"
                className={styles.fieldInput}
                value={formData.title}
                onChange={e => set({ title: e.target.value })}
                placeholder="Untitled activity"
                maxLength={30}
              />
            </div>

            {/* Description */}
            <textarea
              className={styles.fieldTextarea}
              value={formData.description}
              onChange={e => set({ description: e.target.value })}
              placeholder="Add a description"
              rows={4}
              maxLength={200}
            />

            {/* Date & Time button */}
            <button className={styles.fieldBtn} onClick={() => { getCorrectedDates(); setShowDT(true); setHasInteractedWithDT(true); }}>
              <CalendarClock size={15} />
              {!hasInteractedWithDT ? (
                <span className={styles.fieldBtnLabel}>Date &amp; Time</span>
              ) : (
                <span className={styles.fieldBtnValue} style={{ marginLeft: 0, textAlign: 'left', flex: 1, color: '#ffffff' }}>{fmtDateTime()}</span>
              )}
              <ChevronRight size={14} style={{ marginLeft: 'auto' }} />
            </button>
            {isEndBeforeStart && (
              <div style={{ color: 'rgba(255, 100, 100, 0.9)', fontSize: '0.75rem', marginTop: '0.2rem', paddingLeft: '0.5rem', marginBottom: '0.2rem' }}>
                End time must be after start time.
              </div>
            )}

            {/* Location */}
            <div className={styles.locRow}>
              <MapPin size={15} className={styles.locIcon} />
              <input
                type="text"
                className={styles.locInput}
                value={formData.location}
                onChange={e => set({ location: e.target.value })}
                placeholder="Add location"
                maxLength={100}
              />
            </div>


            {/* Share to University */}
            <div style={{ position: 'relative', width: '100%' }} ref={whoCanJoinRef}>
              <button 
                type="button"
                className={styles.reminderRow} 
                onClick={() => setShowWhoCanJoin(!showWhoCanJoin)}
                aria-haspopup="listbox"
                aria-expanded={showWhoCanJoin}
              >
                <div className={styles.rowLeft}>
                  <Eye size={16} className={styles.rowIcon} />
                  <span className={styles.rowTitle}>Who can see this activity</span>
                </div>
                <div className={styles.rowRight}>
                  <span>{formData.whoCanJoin === 'College' ? (collegeName || 'College') : formData.whoCanJoin}</span>
                  <ChevronsUpDown size={14} className={styles.selectIcon} />
                </div>
              </button>
              {showWhoCanJoin && (
                <div className={`${styles.reminderDrop} ${styles.visibilityDrop}`} role="listbox" aria-label="Who can see this activity">
                  {visibilityOptions.map(opt => {
                    const isOn = formData.whoCanJoin === opt.value;
                    // The College option shows the user's actual college name,
                    // but its description still explains the rule generically.
                    const label = opt.value === 'College' ? (collegeName || opt.label) : opt.label;
                    return (
                      <button key={opt.value} type="button" role="option"
                        aria-selected={isOn}
                        className={`${styles.reminderOpt} ${styles.visibilityOpt} ${isOn ? styles.reminderOptOn : ''}`}
                        onClick={() => { set({ whoCanJoin: opt.value }); setShowWhoCanJoin(false); }}
                      >
                        <span className={styles.visibilityOptLabel}>{label}</span>
                        <span className={styles.visibilityOptDesc}>{opt.description}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Capacity Card */}
            <div style={{ width: '100%' }}>
              <button type="button" className={styles.reminderRow} onClick={() => setShowCapacity(true)}>
                <div className={styles.rowLeft}>
                  <Users size={16} className={styles.rowIcon} />
                  <span className={styles.rowTitle}>Capacity</span>
                </div>
                <div className={styles.rowRight}>
                  <span>{formData.slotsNeeded === 999 ? 'Unlimited' : (formData.slotsNeeded === 2 ? 'One-on-one' : `Total ${formData.slotsNeeded} people`)}</span>
                  <ChevronRight size={15} />
                </div>
              </button>
            </div>


          </div>
        </div>
      </div>

      {/* Modals */}
      {showImageSearch && (
        <ImageSearchModal 
          theme="dark"
          onClose={() => setShowImageSearch(false)}
          onSelect={handleCoverSelect}
        />
      )}
      {showDT && <DateTimeModal formData={formData} set={set} onClose={() => setShowDT(false)} />}
      {showCapacity && (
        <CapacityModal
          value={formData.slotsNeeded}
          onSave={n => set({ slotsNeeded: n })}
          onClose={() => setShowCapacity(false)}
        />
      )}
      </main>
  );
}
