import { useState, useEffect, useLayoutEffect, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate, useLocation } from 'react-router-dom';
import { useSmartBack } from '@shared/hooks/useSmartBack';
import { useOverlayBack } from '@shared/hooks/useOverlayBack';
import { useScrollLock } from '@shared/hooks/useScrollLock';
import styles from './CreateActivityPage.module.css';

import ImageSearchModal from '@shared/components/modals/ImageSearchModal';
import { commitDraftImage, removeDraftImage } from '@shared/utils/draftImageCache';

import { getRelativeDateLabel } from '@shared/utils/time';
import {
  ArrowLeft, Send, ImageIcon,
  MapPin, Users, Pencil, Bell, CalendarClock,
  ChevronLeft, ChevronRight, ChevronDown, X, Search, GraduationCap,
  BellOff, ChevronsUpDown, Eye, Link, Check, Loader2
} from 'lucide-react';
import { useQueryClient, useQuery } from '@tanstack/react-query';
import { activitiesApi, usersApi, getMediaUrl } from '@shared/api/apiClient';
import { useAuth } from '@shared/context/AuthContext';
import { showToast } from '@shared/utils/toast';
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

const REMINDER_OPTIONS = [
  { value: 'None', label: 'None' },
  { value: '5 min', label: '5 min before' },
  { value: '15 min', label: '15 min before' },
  { value: '30 min', label: '30 min before' },
  { value: '1 hour', label: '1 hour before' },
  { value: '1 day', label: '1 day before' },
];

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

  const pickDay = (day) => {
    if (isStart) {
      const newStart = getParsedDate(viewYear, viewMonth + 1, day, formData.startTimeHour, formData.startTimeMinute, formData.startTimeAmPm);
      if (newStart) updateStartDate(newStart);
    } else {
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
      const newStart = getParsedDate(formData.startDateYear, formData.startDateMonth, formData.startDateDay, hourStr, minuteStr, ampmStr);
      if (newStart) updateStartDate(newStart);
    } else {
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
  if (!d) return null;
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

const getInitialDates = () => {
  const now = new Date();
  const remainder = 5 - (now.getMinutes() % 5);
  const start = new Date(now.getTime() + (remainder === 5 ? 0 : remainder) * 60000);
  const end = new Date(start.getTime() + 60 * 60000); // +1 hour

  const s = formatToState(start), e = formatToState(end);
  return {
    startDateYear: s.y, startDateMonth: s.m, startDateDay: s.d,
    startTimeHour: s.h, startTimeMinute: s.min, startTimeAmPm: s.ap,
    endDateYear: e.y, endDateMonth: e.m, endDateDay: e.d,
    endTimeHour: e.h, endTimeMinute: e.min, endTimeAmPm: e.ap,
  };
};

const RANDOM_COVERS = [
  'https://images.unsplash.com/photo-1540575467063-178a50c2df87?q=80&w=800&auto=format&fit=crop', // Event crowd
  'https://images.unsplash.com/photo-1492684223066-81342ee5ff30?q=80&w=800&auto=format&fit=crop', // Concert
  'https://images.unsplash.com/photo-1511556532299-8f662fc26c06?q=80&w=800&auto=format&fit=crop', // Tech setup
  'https://images.unsplash.com/photo-1505373877841-8d25f7d46678?q=80&w=800&auto=format&fit=crop', // Meetup
  'https://images.unsplash.com/photo-1528605248644-14dd04022da1?q=80&w=800&auto=format&fit=crop', // Workshop
  'https://images.unsplash.com/photo-1551818255-e6e10975bc17?q=80&w=800&auto=format&fit=crop', // Tech event
];
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

/* ─── Post-publish Invite Modal ─── */
function ActivityCreatedModal({ activityTitle, coverImage, activityDate, creationPromise, onDone }) {
  const { currentUser } = useAuth();
  const [selectedIds, setSelectedIds] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [copied, setCopied] = useState(false);

  useScrollLock(true);

  const { data: friendsList = [], isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ['user-following-friends', currentUser?.username],
    queryFn: () => usersApi.getFollowing(currentUser?.username, 100, 0),
    enabled: !!currentUser?.username,
    staleTime: 30_000,
  });

  // Without an explicit username the query never runs, so it would otherwise sit
  // on the empty state forever with no explanation.
  const cannotLoadFriends = !currentUser?.username;

  const filtered = useMemo(() => {
    if (!Array.isArray(friendsList)) return [];
    const q = searchQuery.trim().toLowerCase();
    if (!q) return friendsList;
    return friendsList.filter(u =>
      (u.displayName || '').toLowerCase().includes(q) ||
      (u.username || '').toLowerCase().includes(q)
    );
  }, [friendsList, searchQuery]);

  const toggle = (id) => setSelectedIds(prev =>
    prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
  );

  // Awaits the in-flight creation promise, then sends invites
  // Creation failure and invite failure are different outcomes and must not both
  // report success. The previous version toasted "Activity published" from every
  // branch — including the catch — so a rolled-back creation still told the user
  // it worked, and invite errors were swallowed by a bare `.catch(() => {})`.
  const handleSend = async () => {
    if (isSending) return; // guard against double-submit
    setIsSending(true);

    let activity;
    try {
      activity = await creationPromise;
    } catch {
      setIsSending(false);
      showToast('Could not publish the activity. Please try again.', 'error');
      return; // stay open so the user keeps their selection
    }

    if (selectedIds.length > 0 && activity?.id) {
      try {
        const res = await activitiesApi.inviteFriends(activity.id, selectedIds);
        const results = res?.results ?? [];
        const sent = results.filter((r) => r.status === 'INVITED').length;
        const skipped = results.length - sent;
        showToast(
          skipped > 0
            ? `Activity published · ${sent} invite${sent === 1 ? '' : 's'} sent, ${skipped} skipped`
            : 'Activity published · invites sent',
          'success',
        );
      } catch {
        // The activity exists — only the invites failed. Say so accurately.
        showToast('Activity published, but invites could not be sent.', 'error');
      }
    } else {
      showToast('Activity published', 'success');
    }

    onDone();
  };

  const handleSkip = async () => {
    // still await so the cache is populated before we navigate
    try {
      await creationPromise;
      showToast('Activity published', 'success');
    } catch {
      showToast('Could not publish the activity. Please try again.', 'error');
    }
    onDone();
  };

  const handleCopy = async () => {
    try {
      const activity = await creationPromise;
      const url = `${window.location.origin}/crew/${activity?.id || ''}`;
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  };

  return createPortal(
    <div className={styles.inviteOverlay} onClick={handleSkip}>
      <div
        className={styles.inviteSheet}
        role="dialog"
        aria-modal="true"
        aria-label="Invite friends"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ padding: '1.25rem 1.5rem 1rem', borderBottom: '1px solid var(--color-border-light)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem', marginBottom: '0.75rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', minWidth: 0, flex: 1 }}>
              {coverImage ? (
                <img
                  src={getMediaUrl(coverImage) || coverImage}
                  alt=""
                  style={{
                    width: 44, height: 44, borderRadius: '10px',
                    objectFit: 'cover', flexShrink: 0,
                    background: 'var(--color-bg-soft)',
                    border: '1px solid var(--color-border-light)',
                  }}
                  onError={(e) => { e.target.style.display = 'none'; }}
                />
              ) : (
                <div style={{
                  width: 44, height: 44, borderRadius: '10px',
                  background: 'linear-gradient(135deg, #3b82f6, #2563eb)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                }}>
                  <Check size={22} color="#ffffff" strokeWidth={2.5} />
                </div>
              )}
              <div style={{ minWidth: 0, flex: 1 }}>
                <p style={{
                  margin: 0, fontWeight: 700, fontSize: '1rem',
                  color: 'var(--color-text-main)',
                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                }}>
                  {activityTitle || 'Untitled Activity'}
                </p>
                {activityDate && (
                  <p style={{
                    margin: '2px 0 0', fontSize: '0.78rem',
                    color: 'var(--color-text-muted)',
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                  }}>
                    {activityDate}
                  </p>
                )}
              </div>
            </div>
            <button
              onClick={handleSkip}
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                color: 'var(--color-text-muted)', padding: '4px', borderRadius: '50%',
                flexShrink: 0,
              }}
              aria-label="Close"
            >
              <X size={20} />
            </button>
          </div>
        </div>

        {/* Friends list header + Copy link button */}
        <div style={{ padding: '1rem 1.5rem 0.5rem', flexShrink: 0 }}>
          <p style={{ margin: '0 0 0.6rem', fontWeight: 600, fontSize: '0.88rem', color: 'var(--color-text-main)' }}>
            Invite friends
          </p>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            <div style={{
              flex: 1,
              display: 'flex', alignItems: 'center', gap: '0.6rem',
              background: 'var(--color-bg-soft)',
              borderRadius: '12px', padding: '0.55rem 0.85rem',
              border: '1px solid var(--color-border)',
            }}>
              <Search size={16} color="var(--color-text-light)" />
              <input
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Search friends…"
                style={{
                  flex: 1, background: 'none', border: 'none', outline: 'none',
                  color: 'var(--color-text-main)', fontSize: '0.88rem',
                }}
              />
            </div>
            <button
              type="button"
              onClick={handleCopy}
              title={copied ? 'Link copied!' : 'Copy activity link'}
              style={{
                width: 38, height: 38, borderRadius: '12px',
                border: '1px solid var(--color-border)',
                background: copied ? 'rgba(16, 185, 129, 0.15)' : 'var(--color-bg-soft)',
                color: copied ? '#10b981' : 'var(--color-text-main)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                cursor: 'pointer', flexShrink: 0,
                transition: 'all 0.2s ease',
              }}
              aria-label="Copy activity link"
            >
              {copied ? <Check size={18} /> : <Link size={18} />}
            </button>
          </div>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '0.5rem 1.5rem', display: 'flex', flexDirection: 'column' }}>
          {isLoading ? (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '120px' }}>
              <p style={{ textAlign: 'center', color: 'var(--color-text-muted)', fontSize: '0.85rem', margin: 0 }}>Loading…</p>
            </div>
          ) : (isError || cannotLoadFriends) ? (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '0.6rem', alignItems: 'center', justifyContent: 'center', minHeight: '120px' }}>
              <p style={{ textAlign: 'center', color: 'var(--color-text-muted)', fontSize: '0.85rem', margin: 0 }}>
                Couldn't load your friends
              </p>
              {!cannotLoadFriends && (
                <button
                  type="button"
                  onClick={() => refetch()}
                  disabled={isFetching}
                  style={{
                    background: 'var(--color-bg-soft)', color: 'var(--color-text-main)',
                    border: '1px solid var(--color-border)', borderRadius: '999px',
                    padding: '0.35rem 0.9rem', fontSize: '0.8rem', fontWeight: 600,
                    cursor: isFetching ? 'default' : 'pointer', opacity: isFetching ? 0.6 : 1,
                  }}
                >
                  {isFetching ? 'Retrying…' : 'Retry'}
                </button>
              )}
              <p style={{ textAlign: 'center', color: 'var(--color-text-light)', fontSize: '0.75rem', margin: 0 }}>
                You can still publish and share the link.
              </p>
            </div>
          ) : filtered.length === 0 ? (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '120px' }}>
              <p style={{ textAlign: 'center', color: 'var(--color-text-muted)', fontSize: '0.85rem', margin: 0 }}>No friends found</p>
            </div>
          ) : filtered.map(u => {
            const sel = selectedIds.includes(u.id);
            return (
              <button
                key={u.id}
                onClick={() => toggle(u.id)}
                style={{
                  width: '100%', display: 'flex', alignItems: 'center', gap: '0.75rem',
                  padding: '0.65rem 0', background: 'none', border: 'none', cursor: 'pointer',
                  borderBottom: '1px solid var(--color-border-light)',
                  transform: 'none',
                  transition: 'none',
                }}
              >
                <div style={{ position: 'relative', flexShrink: 0 }}>
                  <img
                    src={getMediaUrl(u.avatar) || '/default_avatar.webp'}
                    alt=""
                    style={{ width: 38, height: 38, borderRadius: '50%', objectFit: 'cover', background: 'var(--color-bg-soft)' }}
                    onError={(e) => { e.target.onerror = null; e.target.src = '/default_avatar.webp'; }}
                  />
                  {sel && (
                    <span style={{
                      position: 'absolute', bottom: -2, right: -2,
                      width: 16, height: 16, borderRadius: '50%',
                      background: 'var(--color-primary, #2563eb)', border: '2px solid var(--color-bg-white)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                      <Check size={9} color="#fff" strokeWidth={3} />
                    </span>
                  )}
                </div>
                <div style={{ flex: 1, textAlign: 'left' }}>
                  <p style={{ margin: 0, fontWeight: 600, fontSize: '0.88rem', color: 'var(--color-text-main)' }}>{u.displayName || u.username}</p>
                  <p style={{ margin: 0, fontSize: '0.78rem', color: 'var(--color-text-muted)' }}>@{u.username}</p>
                </div>
                <div style={{
                  width: 22, height: 22, borderRadius: '6px', flexShrink: 0,
                  border: sel ? 'none' : '1.5px solid var(--color-border)',
                  background: sel ? 'var(--color-primary, #2563eb)' : 'transparent',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  transform: 'none',
                  transition: 'none',
                }}>
                  {sel && <Check size={12} color="#fff" strokeWidth={2.5} />}
                </div>
              </button>
            );
          })}
        </div>

        {/* Footer */}
        <div style={{
          padding: '1rem 1.5rem 1.5rem',
          borderTop: '1px solid var(--color-border-light)',
          display: 'flex', gap: '0.75rem',
        }}>
          <button
            onClick={handleSkip}
            style={{
              flex: 1, height: '42px', borderRadius: '9999px',
              border: '1px solid var(--color-border)',
              background: 'var(--color-bg-soft)', color: 'var(--color-text-main)',
              fontSize: '0.88rem', fontWeight: 600, cursor: 'pointer',
              transition: 'all 0.2s ease',
            }}
          >
            Skip
          </button>
          <button
            onClick={handleSend}
            disabled={isSending}
            style={{
              flex: 2, height: '42px', borderRadius: '9999px',
              border: 'none',
              background: selectedIds.length > 0
                ? 'var(--color-primary, #2563eb)'
                : 'rgba(37, 99, 235, 0.25)',
              color: selectedIds.length > 0 ? '#ffffff' : 'var(--color-text-muted)',
              fontSize: '0.88rem', fontWeight: 700, cursor: isSending ? 'not-allowed' : 'pointer',
              transition: 'all 0.2s ease',
            }}
          >
            {isSending ? 'Sending…' : selectedIds.length > 0 ? `Invite ${selectedIds.length} friend${selectedIds.length > 1 ? 's' : ''}` : 'Invite friends'}
          </button>
        </div>

      </div>
    </div>,
    document.body
  );
}

export default function CreateActivityPage() {
  const navigate = useNavigate();
  const goBack = useSmartBack();
  const location = useLocation();
  const prefill = location.state?.prefill || {};
  const returnTo = location.state?.returnTo || '/crew';
  const isFromCampus = returnTo.includes('/campus') || !!location.state?.fromCampus || !!prefill.fromCampus;
  const { currentUser, collegeName } = useAuth();
  const queryClient = useQueryClient();
  const today = new Date();

  const [showImageSearch, setShowImageSearch] = useState(false);
  const [showDT, setShowDT] = useState(false);
  const [showReminder, setShowReminder] = useState(false);
  const [showCapacity, setShowCapacity] = useState(false);
  const [showWhoCanJoin, setShowWhoCanJoin] = useState(false);
  const [hasInteractedWithDT, setHasInteractedWithDT] = useState(true);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [nowTs, setNowTs] = useState(() => Date.now());
  const [publishHint, setPublishHint] = useState('');
  const creationPromiseRef = useRef(null); // holds the in-flight create promise
  const reminderRef = useRef(null);
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
    ...getInitialDates(),
    location: '',
    slotsNeeded: 999,
    reminder: 'None',
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

  useEffect(() => {
    // Solid-colour mode feeds the ambient tint directly — no decode needed.
    if (formData.coverMode === 'color') {
      const hex = formData.coverColor || '';
      const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
      if (m && containerRef.current) {
        containerRef.current.style.setProperty(
          '--extracted-rgb',
          `${parseInt(m[1], 16)}, ${parseInt(m[2], 16)}, ${parseInt(m[3], 16)}`,
        );
      }
      return;
    }

    const coverImage = formData.coverImage;
    if (!coverImage) return;

    let active = true;
    const timer = setTimeout(() => {
      const img = new Image();
      img.crossOrigin = 'Anonymous';
      img.src = coverImage;
      img.onload = () => {
        if (!active) return;
        try {
          const canvas = document.createElement('canvas');
          canvas.width = 10;
          canvas.height = 10;
          const ctx = canvas.getContext('2d');
          if (!ctx) return;
          ctx.drawImage(img, 0, 0, 10, 10);
          const data = ctx.getImageData(0, 0, 10, 10).data;

          let r = 0, g = 0, b = 0, count = 0;
          for (let i = 0; i < data.length; i += 4) {
            r += data[i];
            g += data[i+1];
            b += data[i+2];
            count++;
          }
          r = Math.round(r / count);
          g = Math.round(g / count);
          b = Math.round(b / count);

          if (containerRef.current) {
            containerRef.current.style.setProperty('--extracted-rgb', `${r}, ${g}, ${b}`);
          }
        } catch (e) {
          console.warn('Failed to extract dominant color from cover image:', e);
        }
      };
    }, 50);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [formData.coverImage, formData.coverMode, formData.coverColor]);

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

  // close reminder dropdown on outside click
  useEffect(() => {
    if (!showReminder) return;
    const handler = (e) => { if (reminderRef.current && !reminderRef.current.contains(e.target)) setShowReminder(false); };
    const onKey = (e) => { if (e.key === 'Escape') setShowReminder(false); };
    document.addEventListener('mousedown', handler);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('keydown', onKey);
    };
  }, [showReminder]);

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

  const getDurationString = (start, end) => {
    if (!start || !end) return '';
    const diffMs = end - start;
    if (diffMs <= 0) return '0 mins';
    const diffMins = Math.round(diffMs / 60000);
    const hrs = Math.floor(diffMins / 60);
    const mins = diffMins % 60;
    if (hrs === 0) return `${mins} min${mins !== 1 ? 's' : ''}`;
    if (mins === 0) return `${hrs} hour${hrs !== 1 ? 's' : ''}`;
    return `${hrs}h ${mins}m`;
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

    // Snapshot current cache for rollback
    const previousCache = queryClient.getQueryData(['activities']);

    queryClient.setQueryData(['activities'], (old) => {
      if (!old?.pages) return old;
      const newPages = old.pages.map((page, i) => {
        if (i !== 0) return page;
        const acts = page?.activities ?? page ?? [];
        return Array.isArray(page?.activities)
          ? { ...page, activities: [optimisticActivity, ...acts] }
          : [optimisticActivity, ...acts];
      });
      return { ...old, pages: newPages };
    });

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

      return await activitiesApi.create({
        title: formData.title,
        description: formData.description,
        location: fd.location,
        maxMembers: fd.slotsNeeded === 999 ? null : fd.slotsNeeded,
        ...coverPayload,
        visibility: VISIBILITY_BY_OPTION[fd.whoCanJoin] || 'PUBLIC',
        shareToCampus: fd.whoCanJoin === 'College',
        startDate: finalStart.toISOString(),
        endDate: finalEnd.toISOString(),
      });
    })().then((realActivity) => {
      // Swap optimistic entry with real server data
      queryClient.setQueryData(['activities'], (old) => {
        if (!old?.pages) return old;
        return {
          ...old,
          pages: old.pages.map((page) => {
            const acts = page?.activities ?? page ?? [];
            const replaced = acts.map((a) => a.id === tempId ? realActivity : a);
            return Array.isArray(page?.activities)
              ? { ...page, activities: replaced }
              : replaced;
          }),
        };
      });
      return realActivity;
    }).catch((err) => {
      // Rollback — remove the optimistic entry
      queryClient.setQueryData(['activities'], previousCache);
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

  const isColorCover = formData.coverMode === 'color';
  const hasCoverImage = formData.coverMode === 'image' && !!formData.coverImage;

  if (showInviteModal) {
    return (
      <ActivityCreatedModal
        activityTitle={formData.title}
        coverImage={formData.coverImage}
        activityDate={`${MONTHS[(formData.startDateMonth || 1) - 1] || ''} ${formData.startDateDay || ''}, ${formData.startTimeHour}:${formData.startTimeMinute} ${formData.startTimeAmPm}`}
        creationPromise={creationPromiseRef.current}
        onDone={() => navigate(returnTo, { replace: true })}
      />
    );
  }

  return (
    <main ref={containerRef} data-theme="dark" className={styles.root}>
      {/* Blurred ambient background from cover image */}
      {/* Ambient cover wash. Renders in both cover modes so the page always
          reflects the current cover — a solid colour bleeds into the backdrop
          exactly the way an image does, instead of falling back to flat black. */}
      <div className={styles.ambientBg} aria-hidden="true">
        {hasCoverImage ? (
          <img src={formData.coverImage} alt="" className={styles.ambientImg} />
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
                <img src={formData.coverImage} alt="Cover" className={styles.coverImg} />
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

            {/* Reminder Row */}
            <div className={styles.reminderWrap} ref={reminderRef}>
              <button 
                type="button"
                className={styles.reminderRow} 
                onClick={() => setShowReminder(!showReminder)}
                aria-haspopup="listbox"
                aria-expanded={showReminder}
              >
                <div className={styles.rowLeft}>
                  {formData.reminder === 'None' ? (
                    <BellOff size={16} className={styles.rowIcon} />
                  ) : (
                    <Bell size={16} className={styles.rowIcon} />
                  )}
                  <span className={styles.rowTitle}>Reminder</span>
                </div>
                <div className={styles.rowRight}>
                  <span>{formData.reminder === 'None' ? 'None' : formData.reminder}</span>
                  <ChevronsUpDown size={14} className={styles.selectIcon} />
                </div>
              </button>
              {showReminder && (
                <div className={styles.reminderDrop} role="listbox" aria-label="Reminder">
                  {REMINDER_OPTIONS.map(o => (
                    <button key={o.value} type="button" role="option"
                      aria-selected={formData.reminder === o.value}
                      className={`${styles.reminderOpt} ${formData.reminder === o.value ? styles.reminderOptOn : ''}`}
                      onClick={() => { set({ reminder: o.value }); setShowReminder(false); }}
                    >{o.label}</button>
                  ))}
                </div>
              )}
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
